// ---------------------------------------------------------------------------
// API REST de LOBA.
//
// Toutes les routes commencent par /api.
// Le navigateur utilise ces routes pour : se connecter, lister les
// discussions, envoyer un message, envoyer un fichier, etc.
// Les événements TEMPS RÉEL (nouveau message, appel...) passent par Socket.IO
// et se trouvent dans src/sockets.js.
// ---------------------------------------------------------------------------
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const db = require('./db');
const auth = require('./auth');
const storage = require('./storage');
const state = require('./state');
const config = require('./config');
const { publicUser, publicMessage } = require('./serialize');

const AVATAR_COLORS = [
  '#00a884', '#53bdeb', '#a78bfa', '#f59e0b', '#ef4444',
  '#ec4899', '#14b8a6', '#8b5cf6', '#f97316', '#22c55e',
];

// Les fichiers sont gardés en mémoire puis envoyés à MinIO.
// 25 Mo par défaut (variable MAX_UPLOAD_MB dans .env).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

const MESSAGE_SELECT = `
  SELECT m.*, u.display_name AS sender_display_name,
         u.avatar_color AS sender_avatar_color
  FROM messages m
  LEFT JOIN users u ON u.id = m.sender_id
`;

/** Vérifie que l'utilisateur appartient bien à la conversation. */
async function getMembership(conversationId, userId) {
  return db.one(
    `SELECT * FROM conversation_members
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
}

/** Charge une conversation complète (avec ses membres) pour un utilisateur. */
async function getConversation(conversationId, userId) {
  const conversation = await db.one(
    `SELECT c.* FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE c.id = $1 AND cm.user_id = $2`,
    [conversationId, userId]
  );
  if (!conversation) return null;

  const members = await db.many(
    `SELECT u.id, u.username, u.display_name, u.avatar_color, u.last_seen
     FROM conversation_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = $1
     ORDER BY u.display_name`,
    [conversationId]
  );

  return {
    id: conversation.id,
    type: conversation.type,
    name: conversation.name,
    createdAt: conversation.created_at,
    members: members.map((m) => ({
      ...publicUser(m),
      online: state.isOnline(m.id),
    })),
  };
}

/** Insère un message et le renvoie au format utilisé par le navigateur. */
async function insertMessage({ conversationId, senderId, kind, body, file }) {
  const row = await db.one(
    `INSERT INTO messages
       (conversation_id, sender_id, kind, body, file_key, file_name, file_mime, file_size, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      conversationId,
      senderId,
      kind,
      body || null,
      file?.key || null,
      file?.name || null,
      file?.mime || null,
      file?.size || null,
      file?.durationMs || null,
    ]
  );

  const withSender = await db.one(
    `${MESSAGE_SELECT} WHERE m.id = $1`,
    [row.id]
  );
  return publicMessage(withSender);
}

/** Envoie un message à tous les navigateurs de la conversation. */
function emitMessage(io, conversationId, message) {
  io.to(`conv:${conversationId}`).emit('message:new', message);
}

module.exports = function createRoutes(io) {
  const router = express.Router();

  // -------------------------------------------------------------------------
  // AUTHENTIFICATION
  // -------------------------------------------------------------------------

  // Inscription
  router.post('/auth/register', async (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const displayName = String(req.body.displayName || '').trim();
    const password = String(req.body.password || '');

    if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
      return res.status(400).json({
        error:
          "L'identifiant doit contenir 3 à 24 caractères : lettres, chiffres, point, tiret ou underscore.",
      });
    }
    if (displayName.length < 2 || displayName.length > 40) {
      return res.status(400).json({ error: 'Le nom affiché doit faire 2 à 40 caractères.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
    }

    try {
      const passwordHash = await auth.hashPassword(password);
      const color = AVATAR_COLORS[crypto.randomInt(AVATAR_COLORS.length)];
      const user = await db.one(
        `INSERT INTO users (username, display_name, password_hash, avatar_color)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, display_name, avatar_color, last_seen`,
        [username, displayName, passwordHash, color]
      );

      const token = await auth.createSession(user.id);
      auth.setSessionCookie(res, token);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Cet identifiant est déjà utilisé.' });
      }
      throw error;
    }
  });

  // Connexion
  router.post('/auth/login', async (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const user = await db.one('SELECT * FROM users WHERE username = $1', [username]);
    if (!user || !(await auth.verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }

    const token = await auth.createSession(user.id);
    auth.setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  });

  // Déconnexion
  router.post('/auth/logout', async (req, res) => {
    await auth.deleteSession(req);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Utilisateur connecté
  router.get('/me', auth.requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  // -------------------------------------------------------------------------
  // UTILISATEURS
  // -------------------------------------------------------------------------
  router.get('/users', auth.requireAuth, async (req, res) => {
    const search = String(req.query.q || '').trim();
    const rows = await db.many(
      `SELECT id, username, display_name, avatar_color, last_seen
       FROM users
       WHERE id <> $1
         AND ($2 = '' OR display_name ILIKE '%' || $2 || '%' OR username ILIKE '%' || $2 || '%')
       ORDER BY display_name
       LIMIT 200`,
      [req.user.id, search]
    );

    res.json({
      users: rows.map((u) => ({ ...publicUser(u), online: state.isOnline(u.id) })),
    });
  });

  // -------------------------------------------------------------------------
  // CONVERSATIONS
  // -------------------------------------------------------------------------
  router.get('/conversations', auth.requireAuth, async (req, res) => {
    const conversations = await db.many(
      `SELECT c.id, c.type, c.name, c.created_at, cm.last_read_at,
              lm.id AS last_id, lm.body AS last_body, lm.kind AS last_kind,
              lm.created_at AS last_at,
              lu.display_name AS last_sender,
              COALESCE(unread.count, 0) AS unread
       FROM conversations c
       JOIN conversation_members cm
         ON cm.conversation_id = c.id AND cm.user_id = $1
       LEFT JOIN LATERAL (
         SELECT m.id, m.body, m.kind, m.created_at, m.sender_id
         FROM messages m
         WHERE m.conversation_id = c.id
         ORDER BY m.id DESC
         LIMIT 1
       ) lm ON true
       LEFT JOIN users lu ON lu.id = lm.sender_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS count
         FROM messages m2
         WHERE m2.conversation_id = c.id
           AND m2.created_at > COALESCE(cm.last_read_at, TIMESTAMPTZ 'epoch')
           AND m2.sender_id <> $1
       ) unread ON true
       ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [req.user.id]
    );

    if (conversations.length === 0) return res.json({ conversations: [] });

    const ids = conversations.map((c) => c.id);
    const members = await db.many(
      `SELECT cm.conversation_id, u.id, u.username, u.display_name,
              u.avatar_color, u.last_seen
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = ANY($1::int[])
       ORDER BY u.display_name`,
      [ids]
    );

    const membersByConversation = new Map();
    for (const m of members) {
      if (!membersByConversation.has(m.conversation_id)) {
        membersByConversation.set(m.conversation_id, []);
      }
      membersByConversation.get(m.conversation_id).push({
        ...publicUser(m),
        online: state.isOnline(m.id),
      });
    }

    res.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        createdAt: c.created_at,
        unread: Number(c.unread),
        members: membersByConversation.get(c.id) || [],
        lastMessage: c.last_id
          ? {
              id: c.last_id,
              body: c.last_body,
              kind: c.last_kind,
              createdAt: c.last_at,
              senderName: c.last_sender,
            }
          : null,
      })),
    });
  });

  // Créer une discussion privée ou un groupe
  router.post('/conversations', auth.requireAuth, async (req, res) => {
    const type = req.body.type === 'group' ? 'group' : 'direct';
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');
      let conversation;

      if (type === 'direct') {
        const otherId = Number(req.body.userId);
        if (!Number.isInteger(otherId) || otherId === req.user.id) {
          throw Object.assign(new Error('Destinataire invalide.'), { status: 400 });
        }
        const other = await db.one('SELECT id FROM users WHERE id = $1', [otherId]);
        if (!other) {
          throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404 });
        }

        // Une seule discussion privée par paire d'utilisateurs.
        const existing = await client.query(
          `SELECT c.id
           FROM conversations c
           JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $1
           JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $2
           WHERE c.type = 'direct'
           LIMIT 1`,
          [req.user.id, otherId]
        );

        if (existing.rows[0]) {
          await client.query('ROLLBACK');
          return res.json({ conversationId: existing.rows[0].id, existed: true });
        }

        conversation = (
          await client.query(
            `INSERT INTO conversations (type, created_by) VALUES ('direct', $1) RETURNING *`,
            [req.user.id]
          )
        ).rows[0];

        await client.query(
          `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
           VALUES ($1, $2, now()), ($1, $3, now())`,
          [conversation.id, req.user.id, otherId]
        );
      } else {
        const name = String(req.body.name || '').trim();
        const memberIds = Array.isArray(req.body.memberIds)
          ? [...new Set(req.body.memberIds.map(Number))].filter(
              (id) => Number.isInteger(id) && id !== req.user.id
            )
          : [];

        if (name.length < 1 || name.length > 60) {
          throw Object.assign(new Error('Le nom du groupe doit faire 1 à 60 caractères.'), {
            status: 400,
          });
        }
        if (memberIds.length === 0) {
          throw Object.assign(new Error('Choisis au moins un participant.'), { status: 400 });
        }

        const found = await client.query(
          'SELECT id, display_name FROM users WHERE id = ANY($1::int[])',
          [memberIds]
        );
        if (found.rows.length !== memberIds.length) {
          throw Object.assign(new Error('Un des participants est introuvable.'), { status: 400 });
        }

        conversation = (
          await client.query(
            `INSERT INTO conversations (type, name, created_by) VALUES ('group', $1, $2) RETURNING *`,
            [name, req.user.id]
          )
        ).rows[0];

        await client.query(
          `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
           SELECT $1, unnest($2::int[]), now()`,
          [conversation.id, [req.user.id, ...memberIds]]
        );

        await client.query(
          `INSERT INTO messages (conversation_id, sender_id, kind, body)
           VALUES ($1, $2, 'system', $3)`,
          [conversation.id, req.user.id, `${req.user.display_name} a créé le groupe « ${name} »`]
        );
      }

      await client.query('COMMIT');

      // Les sockets des membres rejoignent la "room" de la conversation.
      const members = await db.many(
        'SELECT user_id FROM conversation_members WHERE conversation_id = $1',
        [conversation.id]
      );
      for (const member of members) {
        io.in(`user:${member.user_id}`).socketsJoin(`conv:${conversation.id}`);
        io.to(`user:${member.user_id}`).emit('conversation:new', {
          conversationId: conversation.id,
        });
      }

      res.status(201).json({
        conversation: await getConversation(conversation.id, req.user.id),
        conversationId: conversation.id,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    } finally {
      client.release();
    }
  });

  // Détail d'une conversation
  router.get('/conversations/:id', auth.requireAuth, async (req, res) => {
    const conversation = await getConversation(Number(req.params.id), req.user.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation introuvable.' });
    res.json({ conversation });
  });

  // Historique des messages
  router.get('/conversations/:id/messages', auth.requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!(await getMembership(conversationId, req.user.id))) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const beforeId = Number(req.query.beforeId) || null;

    const rows = await db.many(
      `${MESSAGE_SELECT}
       WHERE m.conversation_id = $1
         AND ($2::int IS NULL OR m.id < $2::int)
       ORDER BY m.id DESC
       LIMIT $3`,
      [conversationId, beforeId, limit]
    );

    res.json({
      messages: rows.reverse().map(publicMessage),
      hasMore: rows.length === limit,
    });
  });

  // Envoyer un message texte
  router.post('/conversations/:id/messages', auth.requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!(await getMembership(conversationId, req.user.id))) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Le message est vide.' });
    if (body.length > 4000) {
      return res.status(400).json({ error: 'Le message est trop long (4000 caractères max).' });
    }

    const message = await insertMessage({
      conversationId,
      senderId: req.user.id,
      kind: 'text',
      body,
    });

    emitMessage(io, conversationId, message);
    res.status(201).json({ message });
  });

  // Envoyer un fichier ou un message vocal
  router.post(
    '/conversations/:id/upload',
    auth.requireAuth,
    upload.single('file'),
    async (req, res) => {
      const conversationId = Number(req.params.id);
      if (!(await getMembership(conversationId, req.user.id))) {
        return res.status(403).json({ error: 'Accès refusé.' });
      }
      if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

      const isVoice = req.body.kind === 'voice';
      const kind = isVoice ? 'voice' : 'file';
      const extension = path.extname(storage.safeDownloadName(req.file.originalname)).slice(0, 12);
      const key = `${conversationId}/${crypto.randomUUID()}${extension}`;

      try {
        await storage.putObject(key, req.file.buffer, req.file.mimetype);
      } catch (error) {
        if (error.code === 'STORAGE_UNAVAILABLE') {
          return res.status(503).json({ error: error.message });
        }
        throw error;
      }

      const message = await insertMessage({
        conversationId,
        senderId: req.user.id,
        kind,
        body: isVoice ? null : req.file.originalname,
        file: {
          key,
          name: isVoice ? 'Message vocal' : req.file.originalname,
          mime: req.file.mimetype,
          size: req.file.size,
          durationMs: isVoice ? Number(req.body.durationMs) || null : null,
        },
      });

      emitMessage(io, conversationId, message);
      res.status(201).json({ message });
    }
  );

  // Télécharger / écouter un fichier (après vérification des droits)
  router.get('/files/:messageId', auth.requireAuth, async (req, res) => {
    const message = await db.one('SELECT * FROM messages WHERE id = $1', [
      Number(req.params.messageId),
    ]);
    if (!message || !message.file_key) {
      return res.status(404).json({ error: 'Fichier introuvable.' });
    }
    if (!(await getMembership(message.conversation_id, req.user.id))) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    let stream;
    try {
      stream = await storage.getObject(message.file_key);
    } catch (error) {
      if (error.code === 'STORAGE_UNAVAILABLE') {
        return res.status(503).json({ error: error.message });
      }
      throw error;
    }

    const mime = message.file_mime || '';
    // Les images sont affichées dans le chat. Le SVG reste en téléchargement :
    // un SVG peut contenir du JavaScript, on ne l'affiche donc pas "inline".
    const safeImage = /^image\/(png|jpe?g|gif|webp|avif)$/i.test(mime);
    const inline =
      message.kind === 'voice' ||
      safeImage ||
      /^(audio|video)\//i.test(mime);
    const disposition = inline ? 'inline' : 'attachment';
    const filename = storage.safeDownloadName(message.file_name || 'fichier');

    res.setHeader('Content-Type', mime || 'application/octet-stream');
    if (message.file_size) res.setHeader('Content-Length', String(message.file_size));
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');

    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  // Marquer une conversation comme lue
  router.post('/conversations/:id/read', auth.requireAuth, async (req, res) => {
    await db.query(
      `UPDATE conversation_members SET last_read_at = now()
       WHERE conversation_id = $1 AND user_id = $2`,
      [Number(req.params.id), req.user.id]
    );
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // ERREURS
  // -------------------------------------------------------------------------
  router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `Fichier trop volumineux (${Math.round(config.maxUploadBytes / 1024 / 1024)} Mo max).`,
        });
      }
      return res.status(400).json({ error: `Upload impossible : ${error.message}` });
    }
    console.error('[API]', error);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  return router;
};
