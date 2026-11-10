// ---------------------------------------------------------------------------
// État global du navigateur.
//
// Un seul objet partagé par tous les modules : quand une fonction modifie
// state, les autres modules voient immédiatement le changement.
// ---------------------------------------------------------------------------
export const state = {
  me: null, // utilisateur connecté
  users: [], // tous les autres utilisateurs
  conversations: [],
  activeId: null,

  messages: new Map(), // conversationId -> tableau de messages
  hasMore: new Map(), // conversationId -> booléen

  filter: 'all', // all | direct | group
  search: '',

  socket: null,
  peer: null,
  peerId: null,

  call: null, // appel en cours (voir calls.js)
  incomingCall: null, // appel entrant en attente d'acceptation
  typingTimeout: null,
};

/** Renvoie la conversation ouverte. */
export function activeConversation() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}

/** Nom affiché d'une conversation. */
export function conversationTitle(conversation) {
  if (conversation.type === 'group') return conversation.name || 'Groupe';
  const other = conversation.members.find((m) => m.id !== state.me?.id);
  return other?.displayName || 'Discussion privée';
}

/** Couleur de l'avatar d'une conversation. */
export function conversationColor(conversation) {
  if (conversation.type === 'group') return '#4a6d7e';
  const other = conversation.members.find((m) => m.id !== state.me?.id);
  return other?.avatarColor || '#00a884';
}

/** L'autre participant d'une discussion privée. */
export function otherMember(conversation) {
  return conversation.members.find((m) => m.id !== state.me?.id) || null;
}
