// ---------------------------------------------------------------------------
// Accès à PostgreSQL.
// On utilise un "pool" : un groupe de connexions réutilisables.
// La fonction query() est utilisée partout dans le projet.
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (error) => {
  console.error('[PostgreSQL] erreur inattendue sur une connexion inactive :', error.message);
});

/** Exécute une requête SQL et renvoie le résultat complet. */
async function query(text, params = []) {
  return pool.query(text, params);
}

/** Renvoie la première ligne, ou null. */
async function one(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

/** Renvoie toutes les lignes. */
async function many(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

/**
 * Crée les tables si elles n'existent pas encore.
 * Le fichier SQL est "idempotent" : on peut le relancer sans risque.
 */
async function init() {
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'schema.sql'),
    'utf8'
  );
  await pool.query(schema);
  console.log('[PostgreSQL] schéma vérifié');
}

module.exports = { pool, query, one, many, init };
