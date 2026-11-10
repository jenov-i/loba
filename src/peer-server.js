// ---------------------------------------------------------------------------
// Serveur de signalisation PeerJS.
//
// PeerJS a besoin d'un serveur pour que deux navigateurs se "trouvent" avant
// de se connecter directement en WebRTC. C'est ce serveur qui attribue un
// identifiant à chaque participant (ex: "Alice" ou un identifiant aléatoire).
//
// Il est monté sur le MÊME serveur HTTPS que le site, à l'adresse /peer.
// Le navigateur s'y connecte avec :
//   new Peer(undefined, { host, port, path: "/peer", secure: true })
// ---------------------------------------------------------------------------
const { ExpressPeerServer } = require('peer');
const { WebSocketServer } = require('ws');

function createPeerServer(app, server) {
  // PeerServer crée normalement son propre WebSocketServer branché sur le
  // serveur HTTPS. Problème : ce dernier refuse toutes les autres connexions
  // WebSocket, y compris celles de Socket.IO. On crée donc un serveur "noServer"
  // et on ne traite QUE le chemin /peer/peerjs, laissant /socket.io tranquille.
  const peerServer = ExpressPeerServer(server, {
    path: '/',
    proxied: true,
    allow_discovery: false, // on ne veut pas lister tous les identifiants
    createWebSocketServer: () => {
      const wss = new WebSocketServer({ noServer: true });
      server.on('upgrade', (request, socket, head) => {
        const pathname = new URL(request.url, 'https://localhost').pathname;
        if (pathname !== '/peer/peerjs') return; // Socket.IO gère les autres chemins
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      });
      return wss;
    },
  });

  app.use('/peer', peerServer);

  peerServer.on('connection', (client) => {
    console.log(`[PeerJS] client connecté : ${client.getId()}`);
  });

  peerServer.on('disconnect', (client) => {
    console.log(`[PeerJS] client déconnecté : ${client.getId()}`);
  });

  return peerServer;
}

module.exports = { createPeerServer };
