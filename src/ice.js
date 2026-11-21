// ---------------------------------------------------------------------------
// Serveurs ICE fournis aux navigateurs pour les appels WebRTC.
//
// Deux familles de serveurs :
//   - STUN : permet de découvrir son adresse publique (gratuit, sans relais) ;
//   - TURN : relaie le son et l'image quand la connexion directe est
//     impossible (deux réseaux différents, 4G, NAT d'entreprise...).
//
// Les identifiants TURN ne sont JAMAIS écrits dans les fichiers statiques :
// le navigateur les demande à GET /api/ice-servers, après authentification.
//
// Trois modes, par ordre de priorité :
//   1. Cloudflare Realtime TURN (CF_TURN_KEY_ID + CF_TURN_API_TOKEN) ;
//   2. coturn avec identifiants éphémères (TURN_URLS + TURN_SECRET) ;
//   3. coturn avec identifiants fixes (TURN_URLS + TURN_USERNAME/TURN_CREDENTIAL).
// ---------------------------------------------------------------------------
const crypto = require('node:crypto');
const config = require('./config');

// Réponse de l'API Cloudflare mise en cache (les identifiants sont partagés
// par tous les utilisateurs et valables une heure).
let cloudflareCache = null; // { expiresAt, iceServers }

function hasTurn() {
  const { turnUrls, cloudflare } = config.ice;
  return (
    turnUrls.length > 0 ||
    Boolean(cloudflare.keyId && cloudflare.apiToken)
  );
}

/**
 * Signale les TURN configurés sur une adresse privée : ils fonctionnent sur
 * le réseau local, mais pas depuis internet (4G, autre réseau).
 */
function turnWarning() {
  const { turnUrls } = config.ice;
  if (turnUrls.length === 0) return null;
  const isPrivate = (url) =>
    /^(?:turns?):(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|localhost)/.test(
      url
    );
  return turnUrls.every(isPrivate)
    ? 'adresse privée : ces serveurs TURN ne sont joignables que sur le réseau local'
    : null;
}

/** Identifiants TURN éphémères, compatibles coturn --use-auth-secret. */
function ephemeralTurnCredentials(userId) {
  const { turnSecret, turnTtlSeconds } = config.ice;
  const username = `${Math.floor(Date.now() / 1000) + turnTtlSeconds}:${userId}`;
  const credential = crypto
    .createHmac('sha1', turnSecret)
    .update(username)
    .digest('base64');
  return { username, credential };
}

/** Serveurs ICE "classiques" (STUN + TURN configurés dans .env). */
function staticIceServers(userId) {
  const { stunUrls, turnUrls, turnUsername, turnCredential, turnSecret } = config.ice;

  const iceServers = stunUrls.map((urls) => ({ urls }));

  if (turnUrls.length > 0) {
    if (turnSecret) {
      iceServers.push({ urls: turnUrls, ...ephemeralTurnCredentials(userId) });
    } else if (turnUsername) {
      iceServers.push({
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential,
      });
    }
  }

  return iceServers;
}

/**
 * Demande des identifiants TURN à Cloudflare Realtime.
 * Documentation : https://developers.cloudflare.com/realtime/turn/
 */
async function cloudflareIceServers() {
  const { keyId, apiToken } = config.ice.cloudflare;
  if (!keyId || !apiToken) return [];

  if (cloudflareCache && cloudflareCache.expiresAt > Date.now()) {
    return cloudflareCache.iceServers;
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: config.ice.turnTtlSeconds }),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      console.warn(
        `[ICE] Cloudflare TURN a répondu ${response.status} : ${(await response.text()).slice(0, 200)}`
      );
      return [];
    }

    const data = await response.json();
    const generated = Array.isArray(data.iceServers)
      ? data.iceServers
      : data.iceServers
        ? [data.iceServers]
        : [];

    const iceServers = generated
      .filter((server) => server && server.urls)
      .map((server) => {
        // Cloudflare ajoute parfois un port 53, que les navigateurs bloquent :
        // il provoquerait une attente inutile pendant la collecte ICE.
        const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
          .filter((url) => !/:53(?:\?|$)/.test(url));
        return {
          urls: urls.length === 1 ? urls[0] : urls,
          username: server.username,
          credential: server.credential,
        };
      })
      .filter((server) => server.urls && server.urls.length > 0);

    if (iceServers.length > 0) {
      // Marge de sécurité : on renouvelle 5 minutes avant l'expiration.
      const ttlMs = Math.max(300, config.ice.turnTtlSeconds - 300) * 1000;
      cloudflareCache = { expiresAt: Date.now() + ttlMs, iceServers };
    }
    return iceServers;
  } catch (error) {
    console.warn('[ICE] Cloudflare TURN injoignable :', error.message);
    return [];
  }
}

/** Liste complète des serveurs ICE pour un utilisateur donné. */
async function iceServersFor(userId) {
  const iceServers = staticIceServers(userId);

  // On ajoute Cloudflare en complément : si l'un échoue, l'autre peut passer.
  const cloudflare = await cloudflareIceServers();
  iceServers.push(...cloudflare);

  return iceServers;
}

module.exports = { iceServersFor, hasTurn, turnWarning };
