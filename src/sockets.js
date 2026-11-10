// ---------------------------------------------------------------------------
// Socket.IO : le "temps réel".
//
// Socket.IO maintient une connexion permanente (WebSocket) entre le
// navigateur et le serveur. C'est grâce à elle que :
//   - les messages arrivent instantanément ;
//   - on voit "X est en train d'écrire" ;
//   - la sonnerie d'un appel retentit chez l'autre personne.
//
// Important : la vidéo et l'audio des appels NE passent PAS par ici.
// Ils passent directement de navigateur à navigateur via WebRTC/PeerJS.
// Socket.IO sert uniquement à échanger les "invitations" d'appel.
// ---------------------------------------------------------------------------
const crypto = require('node:crypto');
const db = require('./db');
const auth = require('./auth');
const state = require('./state');
const { publicUser } = require('./serialize');

// Appels en cours, en mémoire : callId -> objet appel.
// (L'historique des appels est aussi écrit dans la table SQL "calls".)
const calls = new Map();

function findCallForConversation(conversationId) {
  for (const call of calls.values()) {
    if (call.conversationId === conversationId &&
        (call.status === 'ringing' || call.status === 'active')) {
      return call;
    }
  }
  return null;
}

async function finishCall(io, call, status = 'ended') {
  if (!call) return;
  calls.delete(call.id);

  await db
    .query(
      `UPDATE calls
       SET status = CASE WHEN status = 'ringing' THEN $2 ELSE 'ended' END,
           ended_at = now()
       WHERE id = $1`,
      [call.dbId, status === 'declined' ? 'declined' : status]
    )
    .catch(() => {});

  io.to(`conv:${call.conversationId}`).emit('call:ended', {
    callId: call.id,
    conversationId: call.conversationId,
  });
}

function removeParticipant(io, call, userId) {
  call.participants.delete(userId);
  io.to(`call:${call.id}`).emit('call:peer-left', { callId: call.id, userId });
}

module.exports = function initSockets(io) {
  // -------------------------------------------------------------------------
  // Authentification de la connexion Socket.IO
  // -------------------------------------------------------------------------
  io.use(async (socket, next) => {
    try {
      const user = await auth.userFromSocket(socket);
      if (!user) return next(new Error('Non connecté'));
      socket.data.user = user;
      next();
    } catch (error) {
      next(error);
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    state.addSocket(user.id, socket.id);

    socket.join(`user:${user.id}`);

    // On rejoint une "room" par conversation pour recevoir ses messages.
    const conversations = await db.many(
      'SELECT conversation_id FROM conversation_members WHERE user_id = $1',
      [user.id]
    );
    socket.data.conversationIds = new Set();
    for (const row of conversations) {
      socket.join(`conv:${row.conversation_id}`);
      socket.data.conversationIds.add(row.conversation_id);
    }

    await db.query('UPDATE users SET last_seen = now() WHERE id = $1', [user.id]);
    io.emit('presence:update', { userId: user.id, online: true });

    // -----------------------------------------------------------------------
    // "X est en train d'écrire..."
    // -----------------------------------------------------------------------
    socket.on('typing', (payload = {}) => {
      const conversationId = Number(payload.conversationId);
      if (!socket.data.conversationIds.has(conversationId)) return;

      socket.to(`conv:${conversationId}`).emit('typing', {
        conversationId,
        userId: user.id,
        displayName: user.display_name,
        isTyping: Boolean(payload.isTyping),
      });
    });

    // -----------------------------------------------------------------------
    // APPELS : invitation
    // -----------------------------------------------------------------------
    socket.on('call:invite', async (payload = {}, ack = () => {}) => {
      try {
        const conversationId = Number(payload.conversationId);
        const kind = payload.kind === 'audio' ? 'audio' : 'video';
        const peerId = String(payload.peerId || '');

        if (!socket.data.conversationIds.has(conversationId)) {
          return ack({ ok: false, error: 'Conversation introuvable.' });
        }
        if (!peerId) {
          return ack({ ok: false, error: 'Identité WebRTC manquante.' });
        }
        if (findCallForConversation(conversationId)) {
          return ack({ ok: false, error: 'Un appel est déjà en cours dans cette discussion.' });
        }

        const conversation = await db.one(
          'SELECT id, type, name FROM conversations WHERE id = $1',
          [conversationId]
        );
        if (!conversation) {
          return ack({ ok: false, error: 'Conversation introuvable.' });
        }

        const members = await db.many(
          `SELECT u.id, u.username, u.display_name, u.avatar_color
           FROM conversation_members cm
           JOIN users u ON u.id = cm.user_id
           WHERE cm.conversation_id = $1 AND cm.user_id <> $2`,
          [conversationId, user.id]
        );

        const onlineMembers = members.filter((m) => state.isOnline(m.id));
        if (onlineMembers.length === 0) {
          return ack({
            ok: false,
            error:
              conversation.type === 'direct'
                ? "Cette personne n'est pas en ligne pour le moment."
                : "Aucun membre du groupe n'est en ligne pour le moment.",
          });
        }

        const callId = crypto.randomUUID();
        const dbCall = await db.one(
          `INSERT INTO calls (conversation_id, started_by, kind)
           VALUES ($1, $2, $3) RETURNING id`,
          [conversationId, user.id, kind]
        );

        const call = {
          id: callId,
          dbId: dbCall.id,
          conversationId,
          kind,
          isGroup: conversation.type === 'group',
          initiatorId: user.id,
          status: 'ringing',
          participants: new Map(),
          createdAt: Date.now(),
        };
        call.participants.set(user.id, {
          peerId,
          socketId: socket.id,
          user: publicUser(user),
        });
        calls.set(callId, call);
        socket.data.callId = callId;
        socket.join(`call:${callId}`);

        const from = publicUser(user);
        for (const member of onlineMembers) {
          io.to(`user:${member.id}`).emit('call:incoming', {
            callId,
            conversationId,
            conversationName:
              conversation.type === 'group' ? conversation.name : user.display_name,
            conversationType: conversation.type,
            kind,
            from,
          });
        }

        ack({ ok: true, callId });
      } catch (error) {
        console.error('[Socket call:invite]', error);
        ack({ ok: false, error: "Impossible de lancer l'appel." });
      }
    });

    // -----------------------------------------------------------------------
    // APPELS : acceptation
    // -----------------------------------------------------------------------
    socket.on('call:accept', async (payload = {}, ack = () => {}) => {
      try {
        const call = calls.get(String(payload.callId || ''));
        if (!call) return ack({ ok: false, error: "Cet appel n'existe plus." });

        const membership = await db.one(
          'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
          [call.conversationId, user.id]
        );
        if (!membership) return ack({ ok: false, error: 'Accès refusé.' });

        const peerId = String(payload.peerId || '');
        if (!peerId) return ack({ ok: false, error: 'Identité WebRTC manquante.' });

        // Participants déjà présents : le nouvel arrivant va les appeler.
        const existing = [...call.participants.entries()]
          .filter(([userId]) => userId !== user.id)
          .map(([userId, p]) => ({
            userId,
            peerId: p.peerId,
            user: p.user,
          }));

        if (call.status === 'ringing') {
          call.status = 'active';
          await db.query(`UPDATE calls SET status = 'active' WHERE id = $1`, [call.dbId]);
        }

        call.participants.set(user.id, {
          peerId,
          socketId: socket.id,
          user: publicUser(user),
        });
        socket.data.callId = call.id;
        socket.join(`call:${call.id}`);

        socket.to(`call:${call.id}`).emit('call:peer-joined', {
          callId: call.id,
          userId: user.id,
          peerId,
          user: publicUser(user),
        });

        ack({ ok: true, participants: existing });
      } catch (error) {
        console.error('[Socket call:accept]', error);
        ack({ ok: false, error: "Impossible de rejoindre l'appel." });
      }
    });

    // -----------------------------------------------------------------------
    // APPELS : refus
    // -----------------------------------------------------------------------
    socket.on('call:decline', async (payload = {}) => {
      const call = calls.get(String(payload.callId || ''));
      if (!call) return;

      io.to(`conv:${call.conversationId}`).emit('call:declined', {
        callId: call.id,
        userId: user.id,
        displayName: user.display_name,
      });

      // Pour un appel privé, le refus termine l'appel.
      if (!call.isGroup) await finishCall(io, call, 'declined');
    });

    // -----------------------------------------------------------------------
    // APPELS : quitter (utile en groupe, l'appel continue pour les autres)
    // -----------------------------------------------------------------------
    socket.on('call:leave', async (payload = {}) => {
      const call = calls.get(String(payload.callId || ''));
      if (!call) return;

      removeParticipant(io, call, user.id);
      socket.leave(`call:${call.id}`);
      socket.data.callId = null;

      if (call.participants.size === 0) {
        await finishCall(io, call);
      }
    });

    // -----------------------------------------------------------------------
    // APPELS : raccrocher / terminer pour tout le monde
    // -----------------------------------------------------------------------
    socket.on('call:end', async (payload = {}) => {
      const call = calls.get(String(payload.callId || ''));
      if (!call) return;
      await finishCall(io, call);
    });

    // -----------------------------------------------------------------------
    // Déconnexion (fermeture de l'onglet, perte réseau...)
    // -----------------------------------------------------------------------
    socket.on('disconnect', async () => {
      const callId = socket.data.callId;
      const call = callId ? calls.get(callId) : null;
      if (call) {
        removeParticipant(io, call, user.id);
        if (call.participants.size === 0) await finishCall(io, call);
      }

      const becameOffline = state.removeSocket(user.id, socket.id);
      if (becameOffline) {
        await db.query('UPDATE users SET last_seen = now() WHERE id = $1', [user.id]);
        io.emit('presence:update', { userId: user.id, online: false });
      }
    });
  });
};
