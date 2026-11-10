// ---------------------------------------------------------------------------
// Point d'entrée du navigateur.
//
// 1. Demande au serveur si un utilisateur est déjà connecté (cookie).
// 2. Sinon, affiche l'écran de connexion / inscription.
// 3. Une fois connecté : charge les discussions, ouvre Socket.IO et PeerJS.
// ---------------------------------------------------------------------------
import { api } from './api.js';
import { state } from './state.js';
import {
  $,
  initials,
  toast,
  openModal,
  closeModal,
  debounce,
} from './ui.js';
import {
  initChat,
  loadConversations,
  loadUsers,
  renderConversations,
  renderUserLists,
  selectConversation,
  handleIncomingMessage,
  showTyping,
  renderHeader,
} from './chat.js';
import {
  initCalls,
  initPeer,
  handleIncomingCall,
  handleCallPeerJoined,
  handleCallPeerLeft,
  handleCallEnded,
  handleCallDeclined,
} from './calls.js';
import { unlockAudio } from './sounds.js';

// ---------------------------------------------------------------------------
// DÉMARRAGE
// ---------------------------------------------------------------------------
async function boot() {
  initAppUi();

  // Déverrouille l'audio dès le premier clic (nécessaire pour la sonnerie).
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  try {
    const { user } = await api.get('/api/me');
    await startApp(user);
  } catch {
    // Pas connecté : on laisse l'écran de connexion.
    $('#authScreen').hidden = false;
    $('#app').hidden = true;
  }
}

// ---------------------------------------------------------------------------
// CONNEXION / INSCRIPTION
// ---------------------------------------------------------------------------
function initAuthUi() {
  // Onglets
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      document
        .querySelectorAll('[data-auth-tab]')
        .forEach((b) => b.classList.toggle('active', b === button));

      const isLogin = button.dataset.authTab === 'login';
      $('#loginForm').hidden = !isLogin;
      $('#registerForm').hidden = isLogin;
    });
  });

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter || event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    unlockAudio();

    try {
      const { user } = await api.post('/api/auth/login', {
        username: $('#loginUsername').value,
        password: $('#loginPassword').value,
      });
      await startApp(user);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });

  $('#registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter || event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    unlockAudio();

    try {
      const { user } = await api.post('/api/auth/register', {
        displayName: $('#registerDisplayName').value,
        username: $('#registerUsername').value,
        password: $('#registerPassword').value,
      });
      await startApp(user);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// DÉMARRAGE DE L'APPLICATION CONNECTÉE
// ---------------------------------------------------------------------------
async function startApp(user) {
  state.me = user;

  $('#authScreen').hidden = true;
  $('#app').hidden = false;

  $('#meAvatar').textContent = initials(user.displayName);
  $('#meAvatar').style.background = user.avatarColor;
  $('#meName').textContent = user.displayName;
  $('#meUsername').textContent = `@${user.username}`;
  initChat();
  initCalls();

  try {
    await Promise.all([loadConversations(), loadUsers()]);
  } catch (error) {
    toast(error.message, 'error');
  }

  connectSocket();
  initPeer().catch(() => {
    toast(
      "La signalisation des appels n'est pas disponible. Le chat fonctionne quand même.",
      'warn'
    );
  });
}

// ---------------------------------------------------------------------------
// SOCKET.IO
// ---------------------------------------------------------------------------
function connectSocket() {
  const socket = io({ withCredentials: true });
  state.socket = socket;

  socket.on('connect', () => {
    console.log('[Socket.IO] connecté', socket.id);
  });

  socket.on('connect_error', (error) => {
    console.error('[Socket.IO]', error.message);
    toast('Connexion temps réel impossible. Recharge la page.', 'error');
  });

  // Chat
  socket.on('message:new', handleIncomingMessage);
  socket.on('typing', (payload) =>
    showTyping(payload.conversationId, payload.displayName, payload.isTyping)
  );
  socket.on('conversation:new', () => {
    loadConversations().catch(() => {});
  });

  // Présence
  socket.on('presence:update', ({ userId, online }) => {
    const user = state.users.find((u) => u.id === userId);
    if (user) user.online = online;

    for (const conversation of state.conversations) {
      for (const member of conversation.members) {
        if (member.id === userId) member.online = online;
      }
    }

    renderConversations();
    if (state.activeId) renderHeader();
  });

  // Appels
  socket.on('call:incoming', handleIncomingCall);
  socket.on('call:peer-joined', handleCallPeerJoined);
  socket.on('call:peer-left', handleCallPeerLeft);
  socket.on('call:ended', handleCallEnded);
  socket.on('call:declined', handleCallDeclined);
}

// ---------------------------------------------------------------------------
// INTERFACE (modales, déconnexion...)
// ---------------------------------------------------------------------------
let appUiReady = false;

function initAppUi() {
  initAuthUi();
  if (appUiReady) return;
  appUiReady = true;

  // Fermeture des modales
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) backdrop.hidden = true;
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach((modal) => {
        if (modal.id !== 'incomingCallModal') modal.hidden = true;
      });
    }
  });

  // --- Nouvelle discussion ---
  $('#newChatBtn').addEventListener('click', async () => {
    try {
      await loadUsers();
      fillUserLists('');
      $('#userSearch').value = '';
      $('#groupName').value = '';
      openModal('newChatModal');
      $('#userSearch').focus();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#userSearch').addEventListener(
    'input',
    debounce((event) => fillUserLists(event.target.value), 150)
  );

  // Clic sur un utilisateur = créer une discussion privée
  $('#newChatModal').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-start-chat]');
    if (!button) return;
    await createDirectConversation(Number(button.dataset.startChat));
  });

  // Création d'un groupe
  $('#groupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#groupName').value.trim();
    const memberIds = [
      ...document.querySelectorAll('#groupMemberList input[name="member"]:checked'),
    ].map((input) => Number(input.value));

    if (!name) return toast('Donne un nom au groupe.', 'error');
    if (memberIds.length === 0) {
      return toast('Choisis au moins un participant.', 'error');
    }

    try {
      const { conversation } = await api.post('/api/conversations', {
        type: 'group',
        name,
        memberIds,
      });
      closeModal('newChatModal');
      await loadConversations();
      await selectConversation(conversation.id);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  // --- Déconnexion ---
  $('#logoutBtn').addEventListener('click', async () => {
    try {
      state.socket?.disconnect();
      state.peer?.destroy();
      await api.post('/api/auth/logout');
    } finally {
      window.location.reload();
    }
  });
}

function fillUserLists(filter) {
  const { direct, group } = renderUserLists(filter);
  $('#userList').innerHTML = direct;
  $('#groupMemberList').innerHTML = group;
}

async function createDirectConversation(userId) {
  try {
    const { conversationId } = await api.post('/api/conversations', {
      type: 'direct',
      userId,
    });
    closeModal('newChatModal');
    await loadConversations();
    await selectConversation(conversationId);
  } catch (error) {
    toast(error.message, 'error');
  }
}

// C'est parti !
boot();
