// ---------------------------------------------------------------------------
// Authentification : mots de passe, sessions et cookies.
//
// Principe (volontairement simple) :
// 1. À l'inscription, le mot de passe est transformé en "hash" avec bcrypt.
//    On ne stocke JAMAIS le mot de passe en clair.
// 2. À la connexion, on crée un jeton aléatoire stocké dans la table sessions.
// 3. Ce jeton est envoyé au navigateur dans un cookie httpOnly.
//    httpOnly = le JavaScript de la page ne peut pas le lire (protection XSS).
// 4. À chaque requête, on lit le cookie pour retrouver l'utilisateur.
// ---------------------------------------------------------------------------
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const cookie = require('cookie');
const db = require('./db');
const config = require('./config');

const SESSION_MS = config.sessionDurationDays * 24 * 60 * 60 * 1000;

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [token, userId, config.sessionDurationDays]
  );
  return token;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.useHttps, // le cookie ne circule qu'en HTTPS
    maxAge: SESSION_MS,
    path: '/',
  };
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(config.sessionCookieName, token, cookieOptions())
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(config.sessionCookieName, '', {
      ...cookieOptions(),
      maxAge: 0,
    })
  );
}

function tokenFromCookieHeader(header) {
  if (!header) return null;
  const cookies = cookie.parse(header);
  return cookies[config.sessionCookieName] || null;
}

/** Retrouve l'utilisateur à partir du cookie de la requête HTTP. */
async function userFromRequest(req) {
  const token = tokenFromCookieHeader(req.headers.cookie);
  if (!token) return null;

  const row = await db.one(
    `SELECT u.id, u.username, u.display_name, u.avatar_color, u.created_at, u.last_seen
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return row || null;
}

/** Même chose, mais pour une connexion Socket.IO. */
async function userFromSocket(socket) {
  const token = tokenFromCookieHeader(socket.handshake.headers.cookie);
  if (!token) return null;

  return db.one(
    `SELECT u.id, u.username, u.display_name, u.avatar_color, u.created_at, u.last_seen
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
}

/** Middleware Express : bloque les routes si l'utilisateur n'est pas connecté. */
async function requireAuth(req, res, next) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Non connecté' });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

async function deleteSession(req) {
  const token = tokenFromCookieHeader(req.headers.cookie);
  if (token) await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  userFromRequest,
  userFromSocket,
  requireAuth,
  deleteSession,
  tokenFromCookieHeader,
};
