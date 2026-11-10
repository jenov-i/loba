// ---------------------------------------------------------------------------
// Gestion du chat : liste des discussions, messages, fichiers, vocaux.
//
// Ce fichier ne s'occupe PAS des appels (voir calls.js).
// ---------------------------------------------------------------------------
import { api } from './api.js';
import {
  state,
  activeConversation,
  conversationTitle,
  conversationColor,
  otherMember,
} from './state.js';
import {
  $,
  escapeHtml,
  avatarHtml,
  initials,
  formatTime,
  formatListTime,
  formatDay,
  formatSize,
  formatDuration,
  toast,
} from './ui.js';

const els = {};
let typingTimer = null;
let typingSendTimeout = null;

// Enregistrement vocal
let recorder = null;
let recChunks = [];
let recStartedAt = 0;
let recInterval = null;
let recStream = null;
let recCancelled = false;
let recConversationId = null;

// Lecteur audio unique (un seul vocal à la fois)
let voiceAudio = null;
let voiceUi = null;

export function initChat() {
  els.list = $('#conversationList');
  els.messages = $('#messages');
  els.chatView = $('#chatView');
  els.chatEmpty = $('#chatEmpty');
  els.chatName = $('#chatName');
  els.chatSubtitle = $('#chatSubtitle');
  els.chatAvatar = $('#chatAvatar');
  els.input = $('#messageInput');
  els.send = $('#sendBtn');
  els.record = $('#recordBtn');
  els.attach = $('#attachBtn');
  els.fileInput = $('#fileInput');
  els.composer = $('#composer');
  els.recorder = $('#recorder');
  els.recTimer = $('#recTimer');
  els.typingBar = $('#typingBar');
  els.typingText = $('#typingText');

  // --- Envoi de message ---
  els.send.addEventListener('click', sendMessage);
  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  els.input.addEventListener('input', onTyping);

  // --- Fichiers ---
  els.attach.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = '';
    if (file) uploadFile(file, 'file');
  });

  // --- Vocal ---
  els.record.addEventListener('click', startRecording);
  $('#recCancel').addEventListener('click', cancelRecording);
  $('#recSend').addEventListener('click', sendRecording);

  // --- Clic sur un message (lecture des vocaux) ---
  els.messages.addEventListener('click', onMessagesClick);

  // --- Recherche / filtres ---
  $('#searchInput').addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderConversations();
  });
  $('#sidebarFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    document
      .querySelectorAll('#sidebarFilters .filter')
      .forEach((b) => b.classList.toggle('active', b === button));
    renderConversations();
  });

  // --- Retour (mobile) ---
  $('#backBtn').addEventListener('click', () => {
    $('#app').classList.remove('chat-open');
  });

  // --- Nouvelle discussion depuis la liste vide ---
  els.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-conversation-id]');
    if (!button) return;
    selectConversation(Number(button.dataset.conversationId));
  });
}

// ===========================================================================
// LISTE DES DISCUSSIONS
// ===========================================================================

export async function loadConversations() {
  const { conversations } = await api.get('/api/conversations');
  state.conversations = conversations;
  renderConversations();
}

export function renderConversations() {
  const filtered = state.conversations
    .filter((conversation) => {
      if (state.filter !== 'all' && conversation.type !== state.filter) return false;
      if (!state.search) return true;
      const title = conversationTitle(conversation).toLowerCase();
      const members = conversation.members.map((m) => m.displayName.toLowerCase()).join(' ');
      return title.includes(state.search) || members.includes(state.search);
    })
    .sort((a, b) => {
      const dateA = new Date(a.lastMessage?.createdAt || a.createdAt).getTime();
      const dateB = new Date(b.lastMessage?.createdAt || b.createdAt).getTime();
      return dateB - dateA;
    });

  if (filtered.length === 0) {
    els.list.innerHTML = `<p class="list-empty">Aucune discussion.<br>Clique sur <strong>+</strong> pour commencer.</p>`;
    return;
  }

  els.list.innerHTML = filtered
    .map((conversation) => {
      const title = conversationTitle(conversation);
      const color = conversationColor(conversation);
      const last = conversation.lastMessage;
      const preview = last
        ? previewText(conversation, last)
        : 'Aucun message pour le moment';
      const unread = conversation.unread > 0 ? `<span class="badge">${conversation.unread}</span>` : '';
      const active = conversation.id === state.activeId ? 'active' : '';

      return `
        <button class="conversation-item ${active}" data-conversation-id="${conversation.id}">
          ${avatarHtml(title, color)}
          <span class="conversation-main">
            <span class="conversation-top">
              <strong>${escapeHtml(title)}</strong>
              <time>${last ? formatListTime(last.createdAt) : formatListTime(conversation.createdAt)}</time>
            </span>
            <span class="conversation-bottom">
              <span class="preview">${preview}</span>
              ${unread}
            </span>
          </span>
        </button>`;
    })
    .join('');

  updateDocumentTitle();
}

function previewText(conversation, last) {
  let text;
  if (last.kind === 'file') text = '📎 Fichier';
  else if (last.kind === 'voice') text = '🎙️ Message vocal';
  else if (last.kind === 'system') text = last.body || 'Message système';
  else text = last.body || '';

  if (conversation.type === 'group' && last.kind !== 'system' && last.senderName) {
    text = `<span class="sender">${escapeHtml(last.senderName)} : </span>${escapeHtml(text)}`;
    return text;
  }
  return escapeHtml(text);
}

function updateDocumentTitle() {
  const total = state.conversations.reduce(
    (sum, conversation) => sum + (conversation.unread || 0),
    0
  );
  document.title = total > 0 ? `(${total}) LOBA` : 'LOBA — Messagerie et appels';
}

// ===========================================================================
// OUVERTURE D'UNE DISCUSSION
// ===========================================================================

export async function selectConversation(conversationId) {
  state.activeId = conversationId;
  document.getElementById('app').classList.add('chat-open');

  const conversation = activeConversation();
  if (!conversation) return;

  els.chatEmpty.hidden = true;
  els.chatView.hidden = false;

  els.messages.innerHTML = '<p class="list-empty">Chargement…</p>';
  renderHeader();
  renderConversations();

  try {
    await loadMessages(conversationId);
    await markRead(conversationId);
  } catch (error) {
    toast(error.message, 'error');
  }

  els.input.focus();
}

async function loadMessages(conversationId, beforeId = null) {
  const query = beforeId ? `?beforeId=${beforeId}` : '';
  const { messages, hasMore } = await api.get(
    `/api/conversations/${conversationId}/messages${query}`
  );

  if (beforeId) {
    const existing = state.messages.get(conversationId) || [];
    state.messages.set(conversationId, [...messages, ...existing]);
  } else {
    state.messages.set(conversationId, messages);
  }
  state.hasMore.set(conversationId, hasMore);

  if (state.activeId === conversationId) {
    renderMessages({ keepPosition: Boolean(beforeId) });
  }
}

export function renderHeader() {
  const conversation = activeConversation();
  if (!conversation) return;

  const title = conversationTitle(conversation);
  els.chatName.textContent = title;
  els.chatAvatar.textContent = initials(title);
  els.chatAvatar.style.background = conversationColor(conversation);

  if (conversation.type === 'group') {
    const online = conversation.members.filter(
      (m) => m.id !== state.me.id && m.online
    ).length;
    els.chatSubtitle.textContent = `${conversation.members.length} membres${
      online ? ` · ${online} en ligne` : ''
    }`;
  } else {
    const other = otherMember(conversation);
    if (other?.online) {
      els.chatSubtitle.textContent = 'en ligne';
    } else if (other?.lastSeen) {
      els.chatSubtitle.textContent = lastSeenText(other.lastSeen);
    } else {
      els.chatSubtitle.textContent = 'hors ligne';
    }
  }
  els.chatSubtitle.classList.remove('typing');
}

function lastSeenText(value) {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();

  if (sameDay(date, now)) return `vu à ${formatTime(value)}`;
  if (sameDay(date, yesterday)) return `vu hier à ${formatTime(value)}`;
  return `vu le ${date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  })} à ${formatTime(value)}`;
}

async function markRead(conversationId) {  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (conversation) conversation.unread = 0;
  renderConversations();
  try {
    await api.post(`/api/conversations/${conversationId}/read`);
  } catch {
    // Silencieux : le compteur sera recalculé au prochain chargement.
  }
}

// ===========================================================================
// AFFICHAGE DES MESSAGES
// ===========================================================================

export function renderMessages({ keepPosition = false } = {}) {
  const conversation = activeConversation();
  if (!conversation) return;

  const messages = state.messages.get(conversation.id) || [];
  const previousHeight = els.messages.scrollHeight;
  const previousTop = els.messages.scrollTop;

  if (messages.length === 0) {
    els.messages.innerHTML = `<p class="list-empty">Aucun message. Dis bonjour 👋</p>`;
    return;
  }

  const parts = [];
  if (state.hasMore.get(conversation.id)) {
    parts.push(
      '<button class="load-older" data-load-older>Voir les messages plus anciens</button>'
    );
  }

  let lastDay = null;
  for (const message of messages) {
    const day = formatDay(message.createdAt);
    if (day !== lastDay) {
      parts.push(`<div class="day-separator">${escapeHtml(day)}</div>`);
      lastDay = day;
    }
    parts.push(messageHtml(message, conversation));
  }

  els.messages.innerHTML = parts.join('');

  if (keepPosition) {
    els.messages.scrollTop = els.messages.scrollHeight - previousHeight + previousTop;
  } else {
    els.messages.scrollTop = els.messages.scrollHeight;
  }
}

function messageHtml(message, conversation) {
  if (message.kind === 'system') {
    return `<div class="system-message">${escapeHtml(message.body || '')}</div>`;
  }

  const own = message.senderId === state.me.id;
  const showSender = conversation.type === 'group' && !own;

  let content = '';
  if (message.kind === 'text') {
    content = `<div class="message-text">${escapeHtml(message.body || '')}</div>`;
  } else if (message.kind === 'voice' && message.file) {
    content = voiceHtml(message);
  } else if (message.file) {
    content = fileHtml(message);
  }

  return `
    <div class="message-row ${own ? 'own' : 'other'}">
      <div class="message-bubble">
        ${showSender ? `<div class="message-sender">${escapeHtml(message.sender?.displayName || '')}</div>` : ''}
        ${content}
        <div class="message-meta">
          <span>${formatTime(message.createdAt)}</span>
          ${own ? '<span class="tick">✓</span>' : ''}
        </div>
      </div>
    </div>`;
}

function fileHtml(message) {
  const file = message.file;
  const mime = file.mime || '';
  const name = escapeHtml(file.name);
  const isImage = mime.startsWith('image/');

  const image = isImage
    ? `<a href="${file.url}" target="_blank" rel="noopener">
         <img class="message-image" src="${file.url}" alt="${name}" loading="lazy">
       </a>`
    : '';

  const icon = mime.startsWith('image/')
    ? '🖼️'
    : mime.startsWith('video/')
      ? '🎬'
      : mime.startsWith('audio/')
        ? '🎵'
        : mime.includes('pdf')
          ? '📕'
          : '📄';

  return `
    <div class="file-card">
      <span class="file-icon">${icon}</span>
      <span class="file-info">
        <span class="file-name" title="${name}">${name}</span>
        <div class="file-size">${formatSize(file.size)}</div>
        <a class="file-download" href="${file.url}" download="${name}">Télécharger</a>
      </span>
    </div>
    ${image}`;
}

function voiceHtml(message) {
  return `
    <div class="voice-card" data-url="${message.file.url}"
         data-duration="${message.file.durationMs || 0}">
      <button class="voice-play" type="button" title="Écouter">▶</button>
      <span class="voice-track"><span class="voice-progress"></span></span>
      <span class="voice-duration">${formatDuration(message.file.durationMs)}</span>
    </div>`;
}

function onMessagesClick(event) {
  const loadOlder = event.target.closest('[data-load-older]');
  if (loadOlder) {
    const conversation = activeConversation();
    const messages = state.messages.get(conversation.id) || [];
    if (messages.length > 0) {
      loadMessages(conversation.id, messages[0].id).catch((error) =>
        toast(error.message, 'error')
      );
    }
    return;
  }

  const playButton = event.target.closest('.voice-play');
  if (playButton) toggleVoice(playButton.closest('.voice-card'));
}

function toggleVoice(card) {
  const url = card.dataset.url;

  if (voiceAudio && voiceAudio.dataset.url === url) {
    if (voiceAudio.paused) voiceAudio.play();
    else voiceAudio.pause();
    return;
  }

  stopVoice();

  voiceAudio = new Audio(url);
  voiceAudio.dataset.url = url;
  voiceUi = {
    card,
    button: card.querySelector('.voice-play'),
    progress: card.querySelector('.voice-progress'),
    duration: card.querySelector('.voice-duration'),
  };

  voiceAudio.addEventListener('timeupdate', () => {
    if (!voiceUi || !voiceAudio.duration) return;
    const ratio = voiceAudio.currentTime / voiceAudio.duration;
    voiceUi.progress.style.width = `${Math.min(100, ratio * 100)}%`;
    voiceUi.duration.textContent = formatDuration(voiceAudio.currentTime * 1000);
  });

  voiceAudio.addEventListener('ended', stopVoice);
  voiceAudio.addEventListener('error', () => {
    toast("Impossible de lire ce message vocal.", 'error');
    stopVoice();
  });

  voiceAudio.play().catch(() => toast('Clique à nouveau pour autoriser le son.', 'warn'));
  voiceUi.button.textContent = '❚❚';
  card.dataset.playing = 'true';
}

function stopVoice() {
  if (voiceAudio) {
    voiceAudio.pause();
    voiceAudio = null;
  }
  if (voiceUi) {
    voiceUi.button.textContent = '▶';
    voiceUi.progress.style.width = '0%';
    const duration = Number(voiceUi.card.dataset.duration) || 0;
    voiceUi.duration.textContent = formatDuration(duration);
    voiceUi.card.dataset.playing = 'false';
    voiceUi = null;
  }
}

// ===========================================================================
// RÉCEPTION D'UN MESSAGE
// ===========================================================================

export function handleIncomingMessage(message) {
  const conversation = state.conversations.find(
    (c) => c.id === message.conversationId
  );

  // Conversation inconnue (premier message d'une nouvelle discussion)
  if (!conversation) {
    loadConversations().then(() => {
      const updated = state.conversations.find((c) => c.id === message.conversationId);
      if (updated) {
        updated.lastMessage = {
          id: message.id,
          body: message.body,
          kind: message.kind,
          createdAt: message.createdAt,
          senderName: message.sender?.displayName,
        };
      }
      renderConversations();
    });
    return;
  }

  const isActive = state.activeId === conversation.id;
  const list = state.messages.get(conversation.id) || [];

  // Anti-doublon : le message peut arriver par Socket.IO ET par la réponse HTTP.
  if (!list.some((m) => m.id === message.id)) {
    list.push(message);
    state.messages.set(conversation.id, list);
  }

  conversation.lastMessage = {
    id: message.id,
    body: message.body,
    kind: message.kind,
    createdAt: message.createdAt,
    senderName: message.sender?.displayName,
  };

  if (isActive) {
    if (message.senderId !== state.me.id) markRead(conversation.id);
    renderMessages();
  } else if (message.senderId !== state.me.id) {
    conversation.unread = (conversation.unread || 0) + 1;
  }

  renderConversations();
}

// ===========================================================================
// ENVOI DE MESSAGES
// ===========================================================================

async function sendMessage() {
  const conversation = activeConversation();
  const body = els.input.value.trim();
  if (!conversation || !body) return;

  els.input.value = '';
  els.input.style.height = 'auto';
  els.input.focus();
  emitTyping(false);

  try {
    const { message } = await api.post(
      `/api/conversations/${conversation.id}/messages`,
      { body }
    );
    handleIncomingMessage(message);
  } catch (error) {
    toast(error.message, 'error');
    els.input.value = body; // on rend le texte à l'utilisateur
  }
}

async function uploadFile(file, kind, durationMs = null, conversationId = null) {
  const conversation =
    state.conversations.find((c) => c.id === conversationId) || activeConversation();
  if (!conversation) return;

  // Limite côté navigateur (le serveur vérifie aussi).
  if (file.size > 25 * 1024 * 1024) {
    toast('Fichier trop volumineux (25 Mo maximum).', 'error');
    return;
  }

  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  if (durationMs) form.append('durationMs', String(durationMs));

  toast(kind === 'voice' ? 'Envoi du message vocal…' : 'Envoi du fichier…');
  try {
    const { message } = await api.upload(
      `/api/conversations/${conversation.id}/upload`,
      form
    );
    handleIncomingMessage(message);
  } catch (error) {
    toast(error.message, 'error');
  }
}

// --- Indicateur "en train d'écrire" ---
function onTyping() {
  // Ajuste la hauteur de la zone de saisie
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 130)}px`;

  if (!state.socket || !state.activeId) return;
  state.socket.emit('typing', { conversationId: state.activeId, isTyping: true });

  clearTimeout(typingSendTimeout);
  typingSendTimeout = setTimeout(() => emitTyping(false), 1800);
}

function emitTyping(isTyping) {
  if (state.socket && state.activeId) {
    state.socket.emit('typing', { conversationId: state.activeId, isTyping });
  }
}

export function showTyping(conversationId, displayName, isTyping) {
  if (conversationId !== state.activeId) return;

  clearTimeout(typingTimer);
  if (isTyping) {
    els.typingText.textContent = `${displayName} écrit…`;
    els.typingBar.hidden = false;
    els.chatSubtitle.textContent = `${displayName} écrit…`;
    els.chatSubtitle.classList.add('typing');
  } else {
    els.typingBar.hidden = true;
    els.chatSubtitle.classList.remove('typing');
    renderHeader();
  }

  if (isTyping) {
    typingTimer = setTimeout(() => {
      els.typingBar.hidden = true;
      els.chatSubtitle.classList.remove('typing');
      renderHeader();
    }, 3000);
  }
}

// ===========================================================================
// MESSAGES VOCAUX (enregistrement)
// ===========================================================================

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return toast("Ton navigateur ne permet pas l'enregistrement audio.", 'error');
  }
  if (!state.activeId) return;
  recConversationId = state.activeId;

  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast('Micro inaccessible. Autorise le microphone dans le navigateur.', 'error');
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : '';

  recorder = new MediaRecorder(recStream, mimeType ? { mimeType } : undefined);
  recChunks = [];
  recCancelled = false;
  recStartedAt = Date.now();

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) recChunks.push(event.data);
  });

  recorder.addEventListener('stop', () => {
    recStream?.getTracks().forEach((track) => track.stop());
    recStream = null;
    clearInterval(recInterval);
    els.recorder.hidden = true;
    els.composer.hidden = false;

    if (recCancelled) return;

    const duration = Date.now() - recStartedAt;
    const blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
    if (blob.size === 0) return toast("L'enregistrement est vide.", 'error');

    const extension = (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
    const file = new File([blob], `vocal-${Date.now()}.${extension}`, {
      type: blob.type,
    });
    uploadFile(file, 'voice', duration, recConversationId);
  });

  recorder.start(250);
  els.composer.hidden = true;
  els.recorder.hidden = false;
  els.recTimer.textContent = '0:00';

  recInterval = setInterval(() => {
    els.recTimer.textContent = formatDuration(Date.now() - recStartedAt);
    // Limite de sécurité : 3 minutes
    if (Date.now() - recStartedAt > 3 * 60 * 1000) recorder.stop();
  }, 200);
}

function cancelRecording() {
  if (!recorder) return;
  recCancelled = true;
  recorder.stop();
}

function sendRecording() {
  if (!recorder) return;
  recorder.stop();
}

// ===========================================================================
// UTILISATEURS (modale "nouvelle discussion")
// ===========================================================================

export async function loadUsers() {
  const { users } = await api.get('/api/users');
  state.users = users;
}

export function renderUserLists(filter = '') {
  const search = filter.trim().toLowerCase();
  const users = state.users.filter((user) => {
    if (!search) return true;
    return (
      user.displayName.toLowerCase().includes(search) ||
      user.username.toLowerCase().includes(search)
    );
  });

  if (users.length === 0) {
    return {
      direct: '<p class="list-empty">Aucun utilisateur trouvé.</p>',
      group: '',
    };
  }

  const direct = users
    .map(
      (user) => `
      <button class="user-item" data-start-chat="${user.id}" type="button">
        ${avatarHtml(user.displayName, user.avatarColor, 'sm')}
        <span class="meta">
          <strong>${escapeHtml(user.displayName)}</strong>
          <small>@${escapeHtml(user.username)}</small>
        </span>
        ${user.online ? '<span class="online-pill">en ligne</span>' : ''}
      </button>`
    )
    .join('');

  const group = users
    .map(
      (user) => `
      <label class="user-item">
        ${avatarHtml(user.displayName, user.avatarColor, 'sm')}
        <span class="meta">
          <strong>${escapeHtml(user.displayName)}</strong>
          <small>@${escapeHtml(user.username)}</small>
        </span>
        <input type="checkbox" name="member" value="${user.id}">
      </label>`
    )
    .join('');

  return { direct, group };
}
