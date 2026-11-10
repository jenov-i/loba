// ---------------------------------------------------------------------------
// Stockage des fichiers dans MinIO (compatible Amazon S3).
//
// Le navigateur n'accède jamais directement à MinIO : il envoie le fichier au
// serveur Node, qui le range dans un "bucket". Pour le téléchargement, le
// serveur vérifie que l'utilisateur a le droit de voir la conversation puis
// relaie le fichier. Les fichiers restent donc privés.
// ---------------------------------------------------------------------------
const Minio = require('minio');
const config = require('./config');

const client = new Minio.Client({
  endPoint: config.minio.endPoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

const bucket = config.minio.bucket;
let ready = false;

/** Crée le bucket s'il n'existe pas. Appelé au démarrage du serveur. */
async function init() {
  try {
    const exists = await client.bucketExists(bucket);
    if (!exists) {
      await client.makeBucket(bucket);
      console.log(`[MinIO] bucket "${bucket}" créé`);
    } else {
      console.log(`[MinIO] bucket "${bucket}" prêt`);
    }
    ready = true;
  } catch (error) {
    // Deux instances peuvent démarrer en même temps : si l'autre vient de
    // créer le bucket, on considère simplement qu'il est prêt.
    try {
      if (await client.bucketExists(bucket)) {
        ready = true;
        console.log(`[MinIO] bucket "${bucket}" prêt`);
        return;
      }
    } catch {
      // On garde l'erreur d'origine ci-dessous.
    }

    ready = false;
    console.warn(
      '[MinIO] indisponible : le chat fonctionnera, mais pas les fichiers/vocaux.\n' +
        '        Vérifie que MinIO est démarré (docker compose up -d) puis relance le serveur.\n' +
        `        Détail : ${error.message}`
    );
  }
}

function ensureReady() {
  if (!ready) {
    const error = new Error(
      "Le stockage MinIO n'est pas disponible. Démarre-le puis relance le serveur."
    );
    error.code = 'STORAGE_UNAVAILABLE';
    throw error;
  }
}

function sanitizeName(name) {
  return String(name || 'fichier')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(-120);
}

/** Enregistre un fichier (Buffer) dans MinIO. */
async function putObject(key, buffer, mime) {
  ensureReady();
  await client.putObject(bucket, key, buffer, {
    'Content-Type': mime || 'application/octet-stream',
  });
}

/** Renvoie un flux de lecture d'un fichier stocké dans MinIO. */
async function getObject(key) {
  ensureReady();
  return client.getObject(bucket, key);
}

/** Supprime un objet (utilisé si l'insertion en base échoue par exemple). */
async function removeObject(key) {
  try {
    await client.removeObject(bucket, key);
  } catch {
    // On ignore : la suppression est une opération de nettoyage.
  }
}

/** Nom de fichier lisible, sans caractères dangereux pour les en-têtes HTTP. */
function safeDownloadName(name) {
  return sanitizeName(name).replace(/["\r\n]/g, '');
}

module.exports = {
  init,
  putObject,
  getObject,
  removeObject,
  safeDownloadName,
  isReady: () => ready,
};
