// ---------------------------------------------------------------------------
// Configuration centrale de l'application.
// Toutes les variables sont lues depuis le fichier .env (voir .env.example).
// ---------------------------------------------------------------------------
const path = require('node:path');
require('dotenv').config({ quiet: true });

/** Découpe une liste séparée par des virgules (vide -> []). */
function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

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

  // -------------------------------------------------------------------------
  // Serveurs ICE des appels WebRTC (STUN + TURN)
  //
  // STUN suffit quand les deux navigateurs peuvent se joindre directement.
  // TURN est indispensable dès qu'ils sont sur des réseaux différents
  // (4G, NAT d'entreprise, tunnel Cloudflare...). Voir docs/06.
  // -------------------------------------------------------------------------
  ice: {
    stunUrls: splitList(process.env.STUN_URLS).length
      ? splitList(process.env.STUN_URLS)
      : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],

    turnUrls: splitList(process.env.TURN_URLS),
    turnUsername: process.env.TURN_USERNAME || '',
    turnCredential: process.env.TURN_CREDENTIAL || '',

    // Secret partagé avec coturn (--use-auth-secret) : LOBA fabrique alors des
    // identifiants éphémères, jamais stockés dans le navigateur.
    turnSecret: process.env.TURN_SECRET || '',
    turnTtlSeconds: Number(process.env.TURN_TTL_SECONDS || 3600),

    // Cloudflare Realtime TURN (idéal derrière un NAT / cloudflared).
    cloudflare: {
      keyId: process.env.CF_TURN_KEY_ID || '',
      apiToken: process.env.CF_TURN_API_TOKEN || '',
    },
  },

  certDir: path.join(__dirname, '..', 'certs'),
};

module.exports = config;
