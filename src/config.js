// ---------------------------------------------------------------------------
// Configuration centrale de l'application.
// Toutes les variables sont lues depuis le fichier .env (voir .env.example).
// ---------------------------------------------------------------------------
const path = require('node:path');
require('dotenv').config({ quiet: true });

const config = {
  port: Number(process.env.PORT || 3000),
  useHttps: process.env.HTTPS !== 'false',

  // PostgreSQL
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://loba:loba@localhost:5432/loba',

  // Sessions
  sessionCookieName: process.env.SESSION_COOKIE || 'loba_session',
  sessionDurationDays: 30,

  // MinIO (stockage S3)
  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'loba',
  },

  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024,

  certDir: path.join(__dirname, '..', 'certs'),
};

module.exports = config;
