# 06 — Aller plus loin

LOBA est volontairement simple. Ce document liste les limites assumées et
explique **comment les dépasser** : TURN, SFU, sécurité, déploiement,
scalabilité et fonctionnalités.

---

## 1. Rappel des limites

| Limite | Conséquence | Solution |
|---|---|---|
| Maillage WebRTC | 4 participants maximum conseillés | Serveur SFU |
| STUN uniquement | Certains réseaux ne se connectent pas | Serveur TURN |
| Un seul serveur Node | Présence et appels en mémoire | Redis + adaptateur Socket.IO |
| Certificat auto-signé | Avertissement navigateur | Let's Encrypt + reverse proxy |
| Pas de rate limiting | Bruteforce possible | Middleware de limitation |
| Messages en clair | Pas de confidentialité côté serveur | Chiffrement au repos / E2EE |
| Pas de vérification d'e-mail | Comptes jetables | SMTP + jetons |
| Pas de modération | Contenus indésirables | Signalement, filtres |
| Pas de notifications push | Appels manqués si onglet fermé | Service Worker + push |

---

## 2. Ajouter un serveur TURN (coturn)

### 2.1 Pourquoi ?

Deux navigateurs derrière des NAT stricts (entreprise, 4G opérateur) ne
peuvent pas toujours établir une connexion directe. Un **TURN** relaie le
trafic. C'est la solution standard, utilisée par toutes les applications de
visioconférence.

### 2.2 Lancer coturn avec Docker

Ajoute ce service à `docker-compose.yml` :

```yaml
  coturn:
    image: coturn/coturn:latest
    container_name: loba-coturn
    restart: unless-stopped
    network_mode: host
    command:
      - --lt-cred-mech
      - --user=loba:motdepassefort
      - --realm=loba.local
      - --fingerprint
      - --no-cli
      - --min-port=49160
      - --max-port=49200
```

> `network_mode: host` est nécessaire pour que les ports UDP soient accessibles.
> Sous Docker Desktop (Windows/macOS), le mode host est limité : préfère une
> machine Linux ou un TURN hébergé.

Ouvre les ports dans le pare-feu :

- **3478** UDP et TCP (STUN/TURN) ;
- **49160–49200** UDP (relais média).

### 2.3 Configurer le client

Dans `public/js/calls.js`, la configuration actuelle est :

```js
config: {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
},
```

Ajoute le serveur TURN :

```js
config: {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: [
        'turn:TON_DOMAINE_OU_IP:3478?transport=udp',
        'turn:TON_DOMAINE_OU_IP:3478?transport=tcp',
      ],
      username: 'loba',
      credential: 'motdepassefort',
    },
  ],
},
```

Redémarre le serveur et recharge les pages. Pour vérifier que le TURN est
utilisé, ouvre `chrome://webrtc-internals` pendant un appel et regarde les
candidats ICE de type `relay`.

> **Sécurité :** ne mets pas un mot de passe TURN en clair dans un dépôt
> public. Utilise une variable d'environnement exposée par une route
> `GET /api/ice-servers`, ou des identifiants éphémères (TURN REST API).

---

## 3. Passer à un serveur SFU

### 3.1 Le problème du maillage

En mesh, chaque participant envoie son flux à **tous** les autres. Pour `n`
personnes, chaque navigateur gère `n-1` encodeurs et `n-1` connexions. La
charge explose :

| n | Connexions totales | Upload par personne |
|---:|---:|---:|
| 3 | 3 | 2 flux |
| 5 | 10 | 4 flux |
| 10 | 45 | 9 flux |

### 3.2 Le principe du SFU

Un **SFU** (*Selective Forwarding Unit*) reçoit un seul flux de chaque
participant et le rediffuse aux autres. Chaque navigateur n'envoie qu'**un**
flux, quel que soit le nombre de participants.

```
        Alice ──► ┌─────────┐ ──► Bob
        Bob   ──► │   SFU   │ ──► Carol
        Carol ──► └─────────┘ ──► Alice
```

Solutions open source :

- **LiveKit** (recommandé pour démarrer) ;
- **mediasoup** (Node.js, très flexible) ;
- **Janus** (C, plugins) ;
- **Jitsi Videobridge**.

### 3.3 Intégration dans LOBA

Le plus simple est de remplacer la partie média de `public/js/calls.js` par le
SDK du SFU, tout en gardant :

- Socket.IO pour les invitations et la présence ;
- PostgreSQL pour l'historique ;
- la table `calls` pour le journal.

Avec LiveKit, le flux devient :

1. le serveur génère un **jeton** pour l'utilisateur et la salle ;
2. le client se connecte à la salle LiveKit ;
3. LiveKit gère l'audio, la vidéo et la topologie.

Il faut alors ajouter un service LiveKit et une route d'authentification. La
signalisation PeerJS n'est plus nécessaire.

---

## 4. Sécurité

LOBA est un projet pédagogique. Voici les points à renforcer avant un usage
réel.

### 4.1 Limiter les tentatives de connexion

Sans limitation, un attaquant peut tester des milliers de mots de passe.

```bash
npm install express-rate-limit
```

```js
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives. Réessaie dans 15 minutes.' },
});

router.post('/auth/login', loginLimiter, async (req, res) => { ... });
```

Ajoute aussi une limitation sur `register` et `upload`.

### 4.2 En-têtes de sécurité

Utilise **Helmet** pour ajouter les en-têtes HTTP recommandés :

```bash
npm install helmet
```

```js
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'wss:', 'https:'],
    },
  },
}));
```

> LOBA n'utilise aucun script inline : une CSP stricte est donc possible. Il
> faudra autoriser `blob:` pour les aperçus audio/vidéo locaux.

### 4.3 CSRF

Les cookies sont `SameSite=Lax`, ce qui protège déjà des requêtes
inter-sites pour la plupart des cas. Pour une protection complète, ajoute un
jeton CSRF sur les formulaires sensibles ou passe à un cookie `SameSite=Strict`
(au prix de la navigation depuis un lien externe).

### 4.4 Validation des fichiers

- Vérifie le **type MIME réel** (pas seulement l'extension) avec `file-type`.
- Limite les types autorisés si l'usage le permet.
- Analyse les fichiers avec un antivirus (ClamAV) dans un vrai produit.
- Sers toujours les fichiers avec `Content-Disposition: attachment` sauf types
  sûrs (c'est déjà le cas pour les SVG).
- Stocke les fichiers dans un bucket **privé** (c'est le cas).

### 4.5 Secrets et configuration

- Ne commit jamais `.env`.
- Utilise des mots de passe forts pour PostgreSQL, MinIO et TURN.
- En production, génère les secrets avec `openssl rand -hex 32`.
- Fais tourner les clés si elles ont fuité.

### 4.6 Chiffrement de bout en bout (E2EE)

Actuellement :

- le transport navigateur ↔ serveur est chiffré par HTTPS ;
- le transport WebRTC est chiffré par DTLS-SRTP ;
- mais le **serveur** peut lire les messages stockés en clair dans PostgreSQL.

Pour une vraie E2EE, il faudrait :

1. générer une paire de clés par appareil (Web Crypto API) ;
2. publier les clés publiques ;
3. chiffrer chaque message côté client (par exemple avec Olm/Megolm, la
   bibliothèque de Matrix) ;
4. ne stocker que le texte chiffré.

C'est un projet à part entière : la gestion des clés et des appareils est
complexe.

### 4.7 Sessions

- Les jetons sont aléatoires (32 octets) et stockés en base.
- Ajoute un nettoyage périodique :
  ```sql
  DELETE FROM sessions WHERE expires_at < now();
  ```
- Permets à l'utilisateur de voir et révoquer ses sessions.
- Ajoute une rotation du jeton à chaque connexion si nécessaire.

---

## 5. Déploiement

### 5.1 Sur un VPS Linux

Prérequis : un domaine pointant vers le serveur, Docker, Node.js.

1. **Installer le projet** :
   ```bash
   git clone https://github.com/jenov-i/loba.git
   cd loba
   cp .env.example .env
   npm install
   docker compose up -d
   npm run seed
   ```

2. **Ne pas exposer le port 3000 directement.** Utilise un reverse proxy avec
   HTTPS.

3. **Lancer le serveur avec un gestionnaire de processus** :
   ```bash
   npm install -g pm2
   pm2 start src/server.js --name loba
   pm2 save
   pm2 startup
   ```

### 5.2 Reverse proxy avec Caddy (HTTPS automatique)

Caddy obtient et renouvelle automatiquement un certificat Let's Encrypt.

`Caddyfile` :

```
loba.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy gère les WebSockets automatiquement. Il faut aussi :

- désactiver la génération du certificat auto-signé côté LOBA (ou ignorer
  `certs/`) ;
- dans `.env`, garder `HTTPS=true` si Caddy parle à LOBA en HTTPS, ou passer
  LOBA en HTTP interne (`HTTPS=false`) et laisser Caddy faire le HTTPS public.

**Configuration recommandée :**

```dotenv
HTTPS=false
PORT=3000
```

Caddy expose `https://loba.example.com` et relaie vers `http://127.0.0.1:3000`.
Le cookie de session doit alors être `Secure` : il faut adapter
`src/auth.js` pour le forcer derrière un proxy (`req.secure` ou
`X-Forwarded-Proto`).

### 5.3 Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name loba.example.com;

    ssl_certificate     /etc/letsencrypt/live/loba.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/loba.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
```

### 5.4 Docker Compose de production

Un exemple de pile complète :

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: loba
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: loba
    volumes:
      - db_data:/var/lib/postgresql/data

  minio:
    image: bitnamilegacy/minio:latest
    restart: always
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes:
      - minio_data:/data

  app:
    build: .
    restart: always
    depends_on: [db, minio]
    environment:
      DATABASE_URL: postgres://loba:${DB_PASSWORD}@db:5432/loba
      MINIO_ENDPOINT: minio
      MINIO_ACCESS_KEY: ${MINIO_USER}
      MINIO_SECRET_KEY: ${MINIO_PASSWORD}
      HTTPS: "false"
      PORT: "3000"
    ports:
      - "127.0.0.1:3000:3000"

volumes:
  db_data:
  minio_data:
```

Il faut ajouter un `Dockerfile` (non fourni) et un reverse proxy public.

### 5.5 Checklist de mise en production

- [ ] Domaine + HTTPS valide (Let's Encrypt).
- [ ] Mots de passe forts et secrets hors du dépôt.
- [ ] `HTTPS=false` en interne si un proxy termine le TLS.
- [ ] Cookie `Secure` forcé derrière le proxy.
- [ ] Reverse proxy configuré pour les WebSockets.
- [ ] Sauvegardes PostgreSQL (`pg_dump`) quotidiennes.
- [ ] Sauvegardes MinIO (ou stockage S3 externe).
- [ ] Limitation des tentatives de connexion.
- [ ] En-têtes de sécurité (Helmet, CSP).
- [ ] Journaux et supervision (PM2, Docker logs, Uptime Kuma).
- [ ] TURN pour les réseaux stricts.
- [ ] Nettoyage des sessions expirées.
- [ ] Politique de rétention des fichiers.

---

## 6. Scalabilité

### 6.1 Plusieurs instances Node

Socket.IO utilise la mémoire du processus. Avec deux instances derrière un
load balancer, un message émis sur l'instance A n'atteint pas les clients
connectés à l'instance B.

**Solution : l'adaptateur Redis.**

```bash
npm install @socket.io/redis-adapter redis
```

```js
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));
```

Il faut aussi :

- déplacer la présence et l'état des appels dans Redis ;
- activer les **sessions collantes** (*sticky sessions*) sur le load balancer,
  ou forcer le transport WebSocket ;
- partager les fichiers via MinIO/S3 (déjà le cas) ;
- utiliser PostgreSQL pour tout l'état durable (déjà le cas).

### 6.2 Base de données

- Index déjà présents sur les colonnes fréquentes.
- Paginer les messages (déjà fait avec `beforeId`).
- Archiver les vieux messages.
- Utiliser un pool de connexions (déjà le cas).
- Envisager un réplica en lecture pour les grosses charges.

### 6.3 Fichiers

- MinIO peut être déployé en mode distribué.
- Ou utiliser un service S3 managé (AWS S3, Scaleway, Cloudflare R2…).
- Ajouter un CDN pour les téléchargements publics (pas le cas ici, tout est
  privé).

---

## 7. Idées de fonctionnalités

| Fonctionnalité | Complexité | Pistes |
|---|---|---|
| Accusés de lecture par message | Moyenne | Table `message_reads(message_id, user_id, read_at)` |
| Réactions emoji | Faible | Table `reactions(message_id, user_id, emoji)` |
| Répondre à un message | Faible | Colonne `reply_to_id` |
| Modifier / supprimer un message | Moyenne | Colonnes `edited_at`, `deleted_at`, événements Socket.IO |
| Recherche dans les messages | Faible | `ILIKE` + index GIN, ou `tsvector` |
| Ajouter/retirer des membres | Moyenne | Routes + événements + mise à jour des rooms |
| Quitter un groupe | Faible | `DELETE` dans `conversation_members`, message système |
| Notifications push | Élevée | Service Worker, Web Push, clés VAPID |
| Notifications de bureau | Faible | API `Notification` |
| Statuts / stories | Élevée | Nouvelle table + expiration |
| Appels hors ligne | Élevée | Push + sonnerie native |
| Partage d'écran | Faible | `getDisplayMedia` + remplacer la piste vidéo |
| Enregistrement d'appel | Moyenne | `MediaRecorder` côté client + upload |
| Sous-titres en direct | Élevée | Web Speech API ou service externe |
| Thème clair | Faible | Variables CSS + préférence |
| PWA installable | Faible | `manifest.json` + Service Worker |
| Chiffrement E2EE | Très élevée | Protocole de clés (Olm/Megolm, Signal) |

---

## 8. Exercices pour apprendre

1. **Ajouter un thème clair** : duplique les variables CSS dans
   `public/css/style.css` et ajoute un bouton qui bascule une classe sur
   `<body>`.
2. **Afficher la durée des appels dans la conversation** : ajoute un message
   système à la fin d'un appel, en utilisant `calls.started_at` et `ended_at`.
3. **Ajouter la recherche de messages** : crée
   `GET /api/conversations/:id/messages?q=...` avec un `ILIKE`.
4. **Quitter un groupe** : ajoute `DELETE /api/conversations/:id/members/me`,
   un message système et la mise à jour des rooms Socket.IO.
5. **Partager l'écran** : ajoute un bouton qui appelle `getDisplayMedia`, puis
   remplace la piste vidéo dans les connexions existantes avec
   `RTCRtpSender.replaceTrack`.
6. **Ajouter un TURN** : suis la section 2 et vérifie les candidats `relay`
   dans `chrome://webrtc-internals`.
7. **Limiter les connexions** : ajoute `express-rate-limit` sur `/auth/login`.
8. **Écrire des tests** : utilise `node:test` pour tester `serialize.js` et
   quelques fonctions pures, puis des tests d'API avec `supertest`.

---

## 9. Ressources

### WebRTC

- MDN — *WebRTC API* : <https://developer.mozilla.org/fr/docs/Web/API/WebRTC_API>
- *WebRTC for the Curious* (livre gratuit) : <https://webrtcforthecurious.com/>
- Article sur les serveurs STUN/TURN : <https://webrtc.org/getting-started/turn-server>

### PeerJS

- Documentation : <https://peerjs.com/docs/>
- Dépôt GitHub : <https://github.com/peers/peerjs>

### Socket.IO

- Documentation : <https://socket.io/docs/v4/>
- Adaptateur Redis : <https://socket.io/docs/v4/redis-adapter/>

### PostgreSQL

- Documentation : <https://www.postgresql.org/docs/>

### MinIO

- Documentation : <https://min.io/docs/minio/linux/index.html>

### Sécurité web

- OWASP Top 10 : <https://owasp.org/www-project-top-ten/>
- MDN — *Content Security Policy* :
  <https://developer.mozilla.org/fr/docs/Web/HTTP/CSP>

### SFU

- LiveKit : <https://livekit.io/>
- mediasoup : <https://mediasoup.org/>
- Janus : <https://janus.conf.meetecho.com/>

---

## 10. Conclusion

LOBA montre l'essentiel d'une application de communication moderne :

- **Socket.IO** pour les événements temps réel ;
- **WebRTC/PeerJS** pour le média direct ;
- **PostgreSQL** pour la persistance ;
- **MinIO** pour les fichiers ;
- **HTTPS** pour la sécurité et l'accès au matériel.

Les limites sont connues et documentées. Chaque section de ce document est une
piste concrète pour transformer ce projet pédagogique en application plus
robuste.

Bon développement !
