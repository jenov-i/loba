// ---------------------------------------------------------------------------
// Certificat HTTPS auto-signé.
//
// WebRTC exige HTTPS (sauf sur localhost). Pour éviter à l'utilisateur
// d'installer mkcert, LOBA génère automatiquement un certificat avec OpenSSL
// au premier démarrage. Le navigateur affichera un avertissement de sécurité :
// c'est normal pour un certificat auto-signé (voir README, dépannage).
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Liste les adresses IP locales (pour ouvrir l'app depuis un téléphone). */
function localIPv4Addresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    }
  }
  return addresses;
}

/**
 * Crée certs/key.pem et certs/cert.pem s'ils n'existent pas.
 * Renvoie { key, cert } (chemins des fichiers).
 */
function ensureCertificates(certDir) {
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { keyPath, certPath };
  }

  fs.mkdirSync(certDir, { recursive: true });

  const altNames = [
    'DNS:localhost',
    'IP:127.0.0.1',
    ...localIPv4Addresses().map((ip) => `IP:${ip}`),
  ].join(',');

  console.log('[HTTPS] Génération du certificat auto-signé...');
  execFileSync(
    'openssl',
    [
      'req', '-x509',
      '-newkey', 'rsa:2048',
      '-nodes',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '365',
      '-subj', '/C=CF/ST=Bangui/O=LOBA/CN=localhost',
      '-addext', `subjectAltName=${altNames}`,
    ],
    { stdio: 'ignore' }
  );
  console.log('[HTTPS] Certificat créé dans certs/');

  return { keyPath, certPath };
}

module.exports = { ensureCertificates, localIPv4Addresses };
