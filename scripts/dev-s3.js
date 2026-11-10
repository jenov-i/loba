#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Serveur S3 de développement (solution de secours sans Docker / MinIO).
//
//   npm run s3
//
// Il expose une API compatible S3 sur http://localhost:9000, exactement comme
// MinIO. LOBA utilise le SDK MinIO : le code ne change pas, seules les
// identifiants changent (S3RVER / S3RVER).
//
// ⚠️  Ce serveur est prévu pour tester en local. Pour un vrai déploiement,
//     utilise MinIO (voir docker-compose.yml) ou un autre service S3.
// ---------------------------------------------------------------------------
const path = require('node:path');
const fs = require('node:fs');
const S3rver = require('s3rver');
const config = require('../src/config');

const directory = path.join(__dirname, '..', '.data', 's3');
fs.mkdirSync(directory, { recursive: true });

const server = new S3rver({
  port: config.minio.port,
  address: '0.0.0.0',
  silent: false,
  directory,
  configureBuckets: [],
});

server
  .run()
  .then(() => {
    console.log('');
    console.log(`  Stockage S3 de développement démarré sur le port ${config.minio.port}`);
    console.log('  Identifiants à mettre dans .env :');
    console.log('    MINIO_ACCESS_KEY=S3RVER');
    console.log('    MINIO_SECRET_KEY=S3RVER');
    console.log(`  Dossier des fichiers : ${directory}`);
    console.log('');
  })
  .catch((error) => {
    console.error('Impossible de démarrer le stockage S3 :', error.message);
    process.exit(1);
  });
