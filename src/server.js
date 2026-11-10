// ---------------------------------------------------------------------------
// Point d'entrée du serveur.
//
// Il fait 4 choses :
//   1. prépare la base PostgreSQL (tables) et le bucket MinIO ;
//   2. crée le serveur HTTPS (Express + API + fichiers statiques) ;
//   3. y branche Socket.IO (temps réel) et PeerJS (signalisation des appels) ;
//   4. écoute sur le port 3000.
//
// Lancement :  npm start
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const db = require('./db');
const storage = require('./storage');
const { ensureCertificates, localIPv4Addresses } = require('./certificates');
const createRoutes = require('./routes');
const initSockets = require('./sockets');
const { createPeerServer } = require('./peer-server');

async function main() {
  // 1. Dépendances externes ------------------------------------------------
  await db.init();
  await storage.init();

  // 2. Application Express -------------------------------------------------
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir, { extensions: ['html'] }));

  // La bibliothèque PeerJS est servie localement (pas de CDN).
  app.get('/vendor/peerjs.min.js', (req, res) => {
    res.sendFile(
      path.join(__dirname, '..', 'node_modules', 'peerjs', 'dist', 'peerjs.min.js')
    );
  });

  // 3. Serveur HTTP ou HTTPS ----------------------------------------------
  let server;
  if (config.useHttps) {
    const { keyPath, certPath } = ensureCertificates(config.certDir);
    server = https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      app
    );
  } else {
    server = http.createServer(app);
    console.warn(
      '[HTTPS] Mode HTTP activé. Les appels WebRTC ne fonctionneront que sur localhost.'
    );
  }

  // 4. Temps réel : Socket.IO + PeerJS ------------------------------------
  const io = new Server(server, {
    maxHttpBufferSize: 1e6,
    cors: { origin: true, credentials: true },
  });
  initSockets(io);
  createPeerServer(app, server);

  // 5. API REST (après Socket.IO pour que /socket.io soit déjà branché) ----
  app.use('/api', createRoutes(io));

  // 6. Page d'accueil ------------------------------------------------------
  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // 7. Démarrage -----------------------------------------------------------
  await new Promise((resolve) => server.listen(config.port, '0.0.0.0', resolve));

  const scheme = config.useHttps ? 'https' : 'http';
  console.log('');
  console.log('  LOBA est démarré !');
  console.log(`  Local   : ${scheme}://localhost:${config.port}`);
  for (const ip of localIPv4Addresses()) {
    console.log(`  Réseau  : ${scheme}://${ip}:${config.port}`);
  }
  console.log('');

  // 8. Arrêt propre (Ctrl+C) ----------------------------------------------
  const shutdown = async () => {
    console.log('\nArrêt du serveur...');
    io.close();
    server.close();
    await db.pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('\nImpossible de démarrer LOBA :');
  console.error(error.message);
  console.error(
    '\nVérifie que PostgreSQL et MinIO sont démarrés (docker compose up -d)'
  );
  process.exit(1);
});
