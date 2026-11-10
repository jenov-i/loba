// ---------------------------------------------------------------------------
// Appels audio / vidéo avec PeerJS.
//
// Rappel important :
//   - Socket.IO transporte les INVITATIONS (sonnerie, accepter, raccrocher).
//   - PeerJS/WebRTC transporte le SON et L'IMAGE, directement entre navigateurs.
//
// Un appel de groupe utilise une topologie "maillée" (mesh) : chaque
// participant est connecté directement à chacun des autres. C'est parfait
// pour 2 à 4 personnes. Au-delà, il faudrait un serveur SFU (voir la doc).
// ---------------------------------------------------------------------------
import { state, activeConversation, conversationTitle } from './state.js';
import {
  $,
  escapeHtml,
  avatarHtml,
  initials,
  toast,
  openModal,
  closeModal,
  formatDuration,
} from './ui.js';
import { startRingtone, startRingback, stopSounds } from './sounds.js';

const els = {};
let incomingTimeout = null;
let retryCount = 0;

// ===========================================================================
// INITIALISATION
// ===========================================================================

export function initCalls() {
  els.callScreen = $('#callScreen');
  els.videoGrid = $('#videoGrid');
  els.callTitle = $('#callTitle');
  els.callStatus = $('#callStatus');
  els.callAvatar = $('#callAvatar');
  els.callTimer = $('#callTimer');
  els.muteBtn = $('#muteBtn');
  els.cameraBtn = $('#cameraBtn');
  els.hangupBtn = $('#hangupBtn');
  els.incomingAvatar = $('#incomingAvatar');

  $('#acceptCallBtn').addEventListener('click', acceptIncomingCall);
  $('#declineCallBtn').addEventListener('click', () => declineIncomingCall());

  $('#audioCallBtn').addEventListener('click', () => startCall('audio'));
  $('#videoCallBtn').addEventListener('click', () => startCall('video'));

  els.hangupBtn.addEventListener('click', endCall);
  els.muteBtn.addEventListener('click', toggleMute);
  els.cameraBtn.addEventListener('click', toggleCamera);

  // Cliquer sur l'indicateur de signalisation permet de réessayer.
  $('#peerStatus').addEventListener('click', () => {
    if (!state.peerId) initPeer().catch(() => {});
  });
}

export function setPeerStatus(ok, detail = '') {
  const dot = $('#peerDot');
  const label = $('#peerStatus');
  if (!dot || !label) return;

  dot.classList.toggle('online', ok);
  dot.classList.toggle('offline', !ok && Boolean(detail));
  label.textContent = ok
    ? 'Signalisation prête'
    : detail || 'Signalisation en cours…';
}

/** Crée (une seule fois) l'objet Peer de PeerJS. */
export function initPeer() {
  if (state.peer && !state.peer.destroyed) return Promise.resolve(state.peer);

  return new Promise((resolve, reject) => {
    setPeerStatus(false, 'Connexion à la signalisation…');

    const peer = new Peer(undefined, {
      host: window.location.hostname,
      port: Number(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80),
      path: '/peer',
      secure: window.location.protocol === 'https:',
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    state.peer = peer;

    peer.on('open', (id) => {
      state.peerId = id;
      retryCount = 0;
      setPeerStatus(true);
      resolve(peer);
    });

    peer.on('error', (error) => {
      console.warn('[PeerJS]', error.type, error.message);

      if (error.type === 'peer-unavailable') {
        toast("L'autre participant n'est plus joignable.", 'warn');
        if (state.call) cleanupCall();
        return;
      }

      if (error.type === 'unavailable-id' && retryCount < 2) {
        retryCount += 1;
        peer.destroy();
        state.peer = null;
        setTimeout(() => initPeer().catch(() => {}), 800);
        return;
      }

      setPeerStatus(false, 'Signalisation indisponible');
      state.peer = null;
      reject(error);
    });

    peer.on('disconnected', () => {
      setPeerStatus(false, 'Reconnexion…');
      if (!peer.destroyed) {
        try {
          peer.reconnect();
        } catch {
          // On ignore : le prochain appel recréera un Peer.
        }
      }
    });

    // Appel média entrant (une fois l'appel accepté).
    peer.on('call', onIncomingMedia);
  });
}

// ===========================================================================
// LANCER UN APPEL
// ===========================================================================

export async function startCall(kind) {
  const conversation = activeConversation();
  if (!conversation) return;
  if (state.call) return toast('Un appel est déjà en cours.', 'warn');
  if (!state.peerId) {
    try {
      await initPeer();
    } catch {
      return toast("La signalisation n'est pas disponible. Réessaie dans un instant.", 'error');
    }
  }

  let stream;
  try {
    stream = await getUserMedia(kind);
  } catch (error) {
    return toast(error.message, 'error');
  }

  const call = createCall({
    id: null,
    conversationId: conversation.id,
    kind,
    isGroup: conversation.type === 'group',
    role: 'caller',
    title: conversationTitle(conversation),
  });
  call.localStream = stream;
  addParticipant(call, state.peerId, state.me, state.me.id, true);
  state.call = call;

  showCallScreen();
  setCallStatus('Sonnerie…');
  startRingback();

  state.socket.emit(
    'call:invite',
    { conversationId: conversation.id, kind, peerId: state.peerId },
    (response) => {
      if (!response?.ok) {
        toast(response?.error || "L'appel n'a pas pu être lancé.", 'error');
        cleanupCall();
        return;
      }
      call.id = response.callId;

      // L'utilisateur a raccroché avant la réponse du serveur.
      if (call.cancelled) {
        state.socket.emit('call:end', { callId: call.id });
        cleanupCall();
        return;
      }

      // Personne ne répond au bout de 45 secondes.
      call.answerTimeout = setTimeout(() => {
        if (state.call !== call) return;
        toast("Personne n'a répondu.");
        state.socket.emit(call.isGroup ? 'call:leave' : 'call:end', {
          callId: call.id,
        });
        cleanupCall();
      }, 45000);
    }
  );
}

/** Demande l'accès au micro (et à la caméra pour un appel vidéo). */
async function getUserMedia(kind) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Ton navigateur ne supporte pas les appels WebRTC.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia(
      kind === 'video'
        ? {
            audio: true,
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          }
        : { audio: true, video: false }
    );
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      throw new Error('Accès refusé au micro/caméra. Autorise-le dans le navigateur.');
    }
    if (error.name === 'NotFoundError') {
      throw new Error('Aucun micro ou aucune caméra détecté sur cet appareil.');
    }
    throw new Error("Impossible d'accéder au micro/caméra.");
  }
}

// ===========================================================================
// APPEL ENTRANT
// ===========================================================================

export function handleIncomingCall(payload) {
  // Déjà en communication : on signale "occupé".
  if (state.call || state.incomingCall) {
    state.socket.emit('call:decline', { callId: payload.callId });
    return;
  }

  state.incomingCall = payload;
  renderIncomingCall(payload);
  openModal('incomingCallModal');
  startRingtone();

  clearTimeout(incomingTimeout);
  incomingTimeout = setTimeout(() => declineIncomingCall(), 45000);
}

function renderIncomingCall(payload) {
  const isGroup = payload.conversationType === 'group';
  els.incomingAvatar.innerHTML = avatarHtml(
    isGroup ? payload.conversationName : payload.from.displayName,
    isGroup ? '#4a6d7e' : payload.from.avatarColor,
    'lg'
  );
  $('#incomingKind').textContent =
    payload.kind === 'video' ? 'Appel vidéo entrant' : 'Appel audio entrant';
  $('#incomingName').textContent = isGroup
    ? payload.conversationName
    : payload.from.displayName;
  $('#incomingSub').textContent = isGroup
    ? `Appel de groupe de ${payload.from.displayName}`
    : 'Appel entrant…';
}

async function acceptIncomingCall() {
  const incoming = state.incomingCall;
  if (!incoming) return;

  clearTimeout(incomingTimeout);
  stopSounds();
  closeModal('incomingCallModal');

  // S'assurer que PeerJS est prêt avant d'annoncer notre identifiant.
  if (!state.peerId) {
    try {
      await initPeer();
    } catch {
      toast("La signalisation n'est pas disponible. Impossible de répondre.", 'error');
      state.socket.emit('call:decline', { callId: incoming.callId });
      state.incomingCall = null;
      return;
    }
  }

  let stream;
  try {
    stream = await getUserMedia(incoming.kind);
  } catch (error) {
    toast(error.message, 'error');
    state.socket.emit('call:decline', { callId: incoming.callId });
    state.incomingCall = null;
    return;
  }

  const call = createCall({
    id: incoming.callId,
    conversationId: incoming.conversationId,
    kind: incoming.kind,
    isGroup: incoming.conversationType === 'group',
    role: 'callee',
    title: incoming.conversationName,
  });
  call.localStream = stream;
  addParticipant(call, state.peerId, state.me, state.me.id, true);
  state.call = call;
  state.incomingCall = null;

  showCallScreen();
  setCallStatus('Connexion…');
  startTimer(call);

  state.socket.emit(
    'call:accept',
    { callId: call.id, peerId: state.peerId },
    (response) => {
      if (!response?.ok) {
        toast(response?.error || "Impossible de rejoindre l'appel.", 'error');
        cleanupCall();
        return;
      }

      // On appelle tous les participants déjà présents.
      for (const participant of response.participants || []) {
        addParticipant(
          call,
          participant.peerId,
          participant.user,
          participant.userId
        );
        callPeer(call, participant.peerId);
      }
      renderCallUI();
      setCallStatus('En communication');
    }
  );
}

function declineIncomingCall() {
  const incoming = state.incomingCall;
  clearTimeout(incomingTimeout);
  stopSounds();
  closeModal('incomingCallModal');

  if (incoming) {
    state.socket.emit('call:decline', { callId: incoming.callId });
    state.incomingCall = null;
  }
}

// ===========================================================================
// ÉVÉNEMENTS SERVEUR (appelés depuis app.js)
// ===========================================================================

export function handleCallPeerJoined(payload) {
  const call = state.call;
  if (!call) return;
  if (call.id && call.id !== payload.callId) return;
  call.id = call.id || payload.callId;

  clearTimeout(call.answerTimeout);
  stopSounds();
  addParticipant(call, payload.peerId, payload.user, payload.userId);
  startTimer(call);
  setCallStatus('En communication');
  renderCallUI();

  // En appel privé, l'appelant reçoit l'acceptation : c'est le participant
  // qui accepte qui lance la connexion WebRTC, donc on attend son appel.
}

export function handleCallPeerLeft(payload) {
  const call = state.call;
  if (!call || call.id !== payload.callId) return;

  // Le serveur envoie l'identifiant utilisateur ; on retrouve le peerId.
  const participant = [...call.participants.values()].find(
    (p) => p.userId === payload.userId
  );
  if (participant) call.participants.delete(participant.peerId);
  const remoteCount = [...call.participants.values()].filter((p) => !p.isSelf).length;

  if (!call.isGroup) {
    toast('Appel terminé.');
    cleanupCall();
    return;
  }

  if (remoteCount === 0) {
    setCallStatus('En attente de participants…');
  }
  renderCallUI();
}

export function handleCallEnded(payload) {
  const call = state.call;
  if (call && (!call.id || call.id === payload.callId)) {
    toast('Appel terminé.');
    cleanupCall();
  }
}

export function handleCallDeclined(payload) {
  const call = state.call;
  if (!call || (call.id && call.id !== payload.callId)) return;

  toast(`${payload.displayName} a refusé l'appel.`, 'warn');
  if (!call.isGroup) cleanupCall();
}

// ===========================================================================
// MÉDIA (PeerJS)
// ===========================================================================

/** Appel WebRTC entrant : on répond avec notre flux local. */
function onIncomingMedia(mediaConnection) {
  const call = state.call;
  if (!call || !call.localStream) {
    mediaConnection.close();
    return;
  }

  mediaConnection.answer(call.localStream);
  registerConnection(call, mediaConnection, mediaConnection.peer);
}

function callPeer(call, peerId) {
  if (!state.peer || peerId === state.peerId) return;
  const connection = state.peer.call(peerId, call.localStream);
  if (!connection) return;
  registerConnection(call, connection, peerId);
}

function registerConnection(call, connection, peerId) {
  const participant = call.participants.get(peerId);
  if (!participant) return;

  // Évite les doubles connexions si les deux côtés appellent en même temps.
  if (participant.connection) {
    connection.close();
    return;
  }
  participant.connection = connection;

  connection.on('stream', (stream) => {
    participant.stream = stream;
    startTimer(call);
    setCallStatus('En communication');
    renderCallUI();
  });

  connection.on('close', () => {
    if (!state.call) return;
    call.participants.delete(peerId);
    renderCallUI();
  });

  connection.on('error', (error) => {
    console.warn('[PeerJS media]', error);
  });
}

// ===========================================================================
// AFFICHAGE DE L'APPEL
// ===========================================================================

function createCall({ id, conversationId, kind, isGroup, role, title }) {
  return {
    id,
    conversationId,
    kind,
    isGroup,
    role,
    title,
    localStream: null,
    participants: new Map(), // peerId -> participant
    startedAt: null,
    timerId: null,
    answerTimeout: null,
  };
}

function addParticipant(call, peerId, user, userId, isSelf = false) {
  if (!call.participants.has(peerId)) {
    call.participants.set(peerId, {
      peerId,
      userId,
      user: user || { id: userId, displayName: 'Participant', avatarColor: '#4a6d7e' },
      stream: null,
      connection: null,
      isSelf,
    });
  }
  return call.participants.get(peerId);
}

function showCallScreen() {
  const call = state.call;
  els.callScreen.hidden = false;
  els.callTitle.textContent = call.title;
  els.callAvatar.textContent = initials(call.title);
  els.callAvatar.style.background = call.isGroup
    ? '#4a6d7e'
    : activeConversation()?.members.find((m) => m.id !== state.me.id)?.avatarColor ||
      '#00a884';
  els.callTimer.textContent = '00:00';
  els.callStatus.textContent = 'Connexion…';

  els.cameraBtn.hidden = call.kind !== 'video';
  els.muteBtn.classList.remove('off');
  els.cameraBtn.classList.remove('off');
  renderCallUI();
}

function renderCallUI() {
  const call = state.call;
  if (!call || els.callScreen.hidden) return;

  const participants = [...call.participants.values()];
  const audioOnly = call.kind !== 'video';

  els.videoGrid.classList.toggle('audio-only', audioOnly);

  els.videoGrid.innerHTML = participants
    .map((participant) => {
      const name = participant.isSelf ? `${participant.user.displayName} (toi)` : participant.user.displayName;
      const avatar = avatarHtml(
        participant.user.displayName,
        participant.user.avatarColor,
        ''
      );

      if (audioOnly) {
        return `
          <div class="tile audio" data-peer-id="${escapeHtml(participant.peerId)}">
            ${avatar}
            <span class="tile-name">${escapeHtml(name)}</span>
            <audio autoplay ${participant.isSelf ? 'muted' : ''}></audio>
          </div>`;
      }

      return `
        <div class="tile ${participant.isSelf ? 'self' : ''}" data-peer-id="${escapeHtml(participant.peerId)}">
          <video autoplay playsinline ${participant.isSelf ? 'muted' : ''}></video>
          <span class="tile-name">${escapeHtml(name)}</span>
        </div>`;
    })
    .join('');

  // Attache les flux aux balises <video>/<audio> qui viennent d'être créées.
  for (const participant of participants) {
    const tile = els.videoGrid.querySelector(
      `[data-peer-id="${CSS.escape(participant.peerId)}"]`
    );
    if (!tile) continue;

    const media = participant.isSelf
      ? call.localStream
      : participant.stream;
    if (!media) continue;

    const element = tile.querySelector('video, audio');
    if (element) {
      element.srcObject = media;
      element.play?.().catch(() => {});
    }
  }
}

function setCallStatus(text) {
  els.callStatus.textContent = text;
}

function startTimer(call) {
  if (call.startedAt) return;
  call.startedAt = Date.now();
  clearInterval(call.timerId);
  call.timerId = setInterval(() => {
    els.callTimer.textContent = formatDuration(Date.now() - call.startedAt);
  }, 1000);
  els.callTimer.textContent = '00:00';
}

// ===========================================================================
// CONTRÔLES
// ===========================================================================

function toggleMute() {
  const call = state.call;
  if (!call?.localStream) return;
  const tracks = call.localStream.getAudioTracks();
  if (tracks.length === 0) return;
  const enabled = !tracks[0].enabled;
  tracks.forEach((track) => (track.enabled = enabled));
  els.muteBtn.classList.toggle('off', !enabled);
  els.muteBtn.title = enabled ? 'Couper le micro' : 'Réactiver le micro';
}

function toggleCamera() {
  const call = state.call;
  if (!call?.localStream) return;
  const tracks = call.localStream.getVideoTracks();
  if (tracks.length === 0) return;
  const enabled = !tracks[0].enabled;
  tracks.forEach((track) => (track.enabled = enabled));
  els.cameraBtn.classList.toggle('off', !enabled);
  els.cameraBtn.title = enabled ? 'Couper la caméra' : 'Réactiver la caméra';
}

function endCall() {
  const call = state.call;
  if (!call) return;

  if (call.id) {
    state.socket.emit(call.isGroup ? 'call:leave' : 'call:end', {
      callId: call.id,
    });
  } else {
    // L'invitation n'a pas encore reçu de réponse : on annule dès qu'elle arrive.
    call.cancelled = true;
  }
  cleanupCall();
}

function cleanupCall() {
  const call = state.call;
  stopSounds();
  clearTimeout(incomingTimeout);

  if (call) {
    clearTimeout(call.answerTimeout);
    clearInterval(call.timerId);

    for (const participant of call.participants.values()) {
      try {
        participant.connection?.close();
      } catch {
        // ignore
      }
    }
    call.localStream?.getTracks().forEach((track) => track.stop());
  }

  state.call = null;
  els.callScreen.hidden = true;
  els.videoGrid.innerHTML = '';
  els.callTimer.textContent = '00:00';
  els.muteBtn.classList.remove('off');
  els.cameraBtn.classList.remove('off');
  els.muteBtn.title = 'Couper le micro';
  els.cameraBtn.title = 'Couper la caméra';
}
