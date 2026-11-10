#!/usr/bin/env node
// Génère (ou régénère) le certificat HTTPS dans certs/.
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { ensureCertificates } = require('../src/certificates');

// On supprime l'ancien certificat pour en créer un neuf.
for (const file of ['key.pem', 'cert.pem']) {
  const full = path.join(config.certDir, file);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

const { certPath } = ensureCertificates(config.certDir);
console.log(`Certificat prêt : ${certPath}`);
