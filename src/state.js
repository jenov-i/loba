// ---------------------------------------------------------------------------
// État en mémoire du serveur : qui est connecté en ce moment ?
//
// Un même utilisateur peut avoir plusieurs onglets ouverts : on garde donc
// l'ensemble de ses sockets. Il est "en ligne" tant qu'il en reste au moins un.
// ---------------------------------------------------------------------------

const onlineSockets = new Map(); // userId -> Set<socketId>

function addSocket(userId, socketId) {
  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
  onlineSockets.get(userId).add(socketId);
}

function removeSocket(userId, socketId) {
  const sockets = onlineSockets.get(userId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineSockets.delete(userId);
    return true; // l'utilisateur vient de passer hors ligne
  }
  return false;
}

function isOnline(userId) {
  return onlineSockets.has(userId);
}

module.exports = { addSocket, removeSocket, isOnline };
