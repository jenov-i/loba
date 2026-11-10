# 02 — Architecture du code

Ce document décrit l'organisation du code, la base de données, l'API REST et
les événements temps réel. Il s'adresse à quelqu'un qui veut **comprendre** ou
**modifier** LOBA.

---

## 1. Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            NAVIGATEUR                                   │
│                                                                         │
│  index.html + style.css                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ app.js   │ │ chat.js  │ │ calls.js │ │ sounds.js│ │ api/state/ui │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────────┘ └──────────────┘  │
│       │            │            │                                        │
│       │ Socket.IO  │  HTTP      │  PeerJS / WebRTC                      │
└───────┼────────────┼────────────┼────────────────────────────────────────┘
        │            │            │
        ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        SERVEUR NODE.JS (src/)                           │
│                                                                         │
│  server.js ──► Express ──► routes.js ──► auth.js / db.js / storage.js   │
│      │                                                                  │
│      ├──────► Socket.IO ──► sockets.js ──► state.js / db.js             │
│      │                                                                  │
│      └──────► PeerJS ──► peer-server.js                                 │
│                                                                         │
│  certificates.js : certificat HTTPS auto-signé                          │
└───────────────┬───────────────────────────────┬─────────────────────────┘
                │                               │
                ▼                               ▼
      ┌──────────────────┐            ┌──────────────────┐
      │   PostgreSQL     │            │      MinIO       │
      │ comptes          │            │ fichiers         │
      │ messages         │            │ images           │
      │ conversations    │            │ messages vocaux  │
      │ appels, sessions │            │ (bucket privé)   │
      └──────────────────┘            └──────────────────┘
```

---

## 2. Arborescence commentée

```
LOBA/
├── src/                        Côté serveur (CommonJS)
│   ├── server.js               Point d'entrée et câblage général
│   ├── config.js               Lit .env et expose un objet config
│   ├── db.js                   Pool PostgreSQL + exécution de schema.sql
│   ├── auth.js                 bcrypt, sessions, cookies, middlewares
│   ├── routes.js               Toutes les routes /api
│   ├── sockets.js              Temps réel + machine d'état des appels
│   ├── peer-server.js          Signalisation PeerJS sur /peer
│   ├── storage.js              Client MinIO : put/get/remove
│   ├── certificates.js         Génère certs/key.pem et cert.pem
│   ├── state.js                Présence en mémoire (userId → sockets)
│   ├── serialize.js            Transforme les lignes SQL en JSON public
│   └── ...
│
├── public/                     Côté navigateur (ES modules, sans build)
│   ├── index.html              Structure complète de l'interface
│   ├── css/style.css           Styles (thème sombre, responsive)
│   ├── img/logo.svg            Logo
│   └── js/
│       ├── app.js              Démarrage, auth, Socket.IO, modales
│       ├── api.js              Petit client fetch
│       ├── state.js            État partagé côté client
│       ├── ui.js               Formatage, toasts, avatars, échappement
│       ├── chat.js             Conversations, messages, fichiers, vocaux
│       ├── calls.js            Appels PeerJS et interface d'appel
│       └── sounds.js           Sonnerie et tonalité Web Audio
│
├── sql/schema.sql              Tables, contraintes et index
├── scripts/
│   ├── generate-cert.js        Régénère le certificat
│   └── dev-s3.js               Serveur S3 local sans Docker (s3rver)
│
├── docs/                       Cette documentation
├── certs/                      Certificats générés (ignorés par git)
├── .data/                      Données s3rver (ignorées par git)
├── docker-compose.yml          PostgreSQL 16 + MinIO
├── .env.example                Modèle de configuration
└── package.json
```

### Pourquoi du CommonJS côté serveur et des modules ES côté navigateur ?

- Le serveur utilise `require()` / `module.exports` : c'est le style le plus
  répandu avec Node.js, et il fonctionne sans configuration.
- Le navigateur utilise `import` / `export` natifs : aucun bundler, aucun
  build. `<script type="module" src="/js/app.js">` suffit.

---

## 3. Le démarrage, étape par étape

`src/server.js` exécute ces opérations dans l'ordre :

```js
await db.init();          // 1. crée les tables si besoin
await storage.init();     // 2. crée le bucket MinIO si besoin

const app = express();    // 3. application Express
app.use(express.static(...));   // fichiers de public/

const server = https.createServer({ key, cert }, app); // 4. HTTPS

const io = new Server(server, { ... }); // 5. Socket.IO
initSockets(io);
createPeerServer(app, server);          // 6. PeerJS sur /peer

app.use('/api', createRoutes(io));      // 7. API REST

server.listen(config.port, '0.0.0.0');  // 8. écoute
```

Deux points importants :

1. **Socket.IO doit être créé avant l'API** : `createRoutes(io)` a besoin de
   l'instance pour diffuser les nouveaux messages.
2. **PeerJS ne doit pas capturer `/socket.io`** : d'où le serveur WebSocket
   `noServer` décrit dans `src/peer-server.js`.

Au démarrage, LOBA affiche aussi les adresses IPv4 locales pour permettre
l'accès depuis un téléphone sur le même Wi-Fi.

---

## 4. La base de données PostgreSQL

Le schéma complet est dans `sql/schema.sql`. Il est rejoué à chaque démarrage
(les instructions `IF NOT EXISTS` le rendent idempotent).

### 4.1 `users`

| Colonne | Type | Rôle |
|---|---|---|
| `id` | SERIAL PK | Identifiant interne |
| `username` | TEXT UNIQUE | Identifiant de connexion (minuscules) |
| `display_name` | TEXT | Nom affiché |
| `password_hash` | TEXT | Hash bcrypt (jamais le mot de passe) |
| `avatar_color` | TEXT | Couleur de l'avatar |
| `last_seen` | TIMESTAMPTZ | Dernière activité connue |
| `created_at` | TIMESTAMPTZ | Date de création |

### 4.2 `sessions`

| Colonne | Type | Rôle |
|---|---|---|
| `token` | TEXT PK | Jeton aléatoire de 64 caractères |
| `user_id` | FK users | Propriétaire |
| `created_at` | TIMESTAMPTZ | Création |
| `expires_at` | TIMESTAMPTZ | Expiration (30 jours) |

Le jeton est envoyé dans un cookie **httpOnly**, **SameSite=Lax**, **Secure**
en HTTPS. Le JavaScript de la page ne peut pas le lire.

### 4.3 `conversations`

| Colonne | Type | Rôle |
|---|---|---|
| `id` | SERIAL PK | Identifiant |
| `type` | TEXT | `direct` ou `group` |
| `name` | TEXT | Nom du groupe (NULL pour un direct) |
| `created_by` | FK users | Créateur |
| `created_at` | TIMESTAMPTZ | Date |

### 4.4 `conversation_members`

| Colonne | Type | Rôle |
|---|---|---|
| `conversation_id` | FK conversations | Conversation |
| `user_id` | FK users | Membre |
| `joined_at` | TIMESTAMPTZ | Arrivée |
| `last_read_at` | TIMESTAMPTZ | Sert au compteur de non-lus |

La clé primaire est le couple `(conversation_id, user_id)`. C'est cette table
qui **autorise** l'accès : toutes les routes vérifient que l'utilisateur y
figure avant de lire ou d'écrire.

### 4.5 `messages`

| Colonne | Type | Rôle |
|---|---|---|
| `id` | SERIAL PK | Identifiant |
| `conversation_id` | FK conversations | Destination |
| `sender_id` | FK users | Expéditeur (NULL si compte supprimé) |
| `kind` | TEXT | `text`, `file`, `voice`, `system` |
| `body` | TEXT | Texte du message |
| `file_key` | TEXT | Clé de l'objet dans MinIO |
| `file_name` | TEXT | Nom d'origine |
| `file_mime` | TEXT | Type MIME |
| `file_size` | BIGINT | Taille en octets |
| `duration_ms` | INTEGER | Durée d'un vocal |
| `created_at` | TIMESTAMPTZ | Date d'envoi |

### 4.6 `calls`

| Colonne | Type | Rôle |
|---|---|---|
| `id` | SERIAL PK | Identifiant en base |
| `conversation_id` | FK conversations | Contexte |
| `started_by` | FK users | Appelant |
| `kind` | TEXT | `audio` ou `video` |
| `status` | TEXT | `ringing`, `active`, `ended`, `missed`, `declined` |
| `started_at` | TIMESTAMPTZ | Début |
| `ended_at` | TIMESTAMPTZ | Fin |

L'appel **en cours** est aussi gardé en mémoire dans une `Map` (`calls` dans
`src/sockets.js`) pour retrouver rapidement les participants et leur `peerId`.
La table ne sert qu'à l'historique.

### 4.7 Index

```sql
idx_members_user            -- retrouver les conversations d'un utilisateur
idx_messages_conversation   -- charger les derniers messages
idx_sessions_user           -- sessions d'un utilisateur
idx_calls_conversation      -- historique des appels
```

---

## 5. L'API REST

Toutes les routes sont préfixées par `/api`. Sauf `register` et `login`,
elles exigent un cookie de session valide (`auth.requireAuth`).

| Méthode | Route | Corps / paramètres | Réponse |
|---|---|---|---|
| POST | `/api/auth/register` | `{ username, displayName, password }` | `201 { user }` + cookie |
| POST | `/api/auth/login` | `{ username, password }` | `200 { user }` + cookie |
| POST | `/api/auth/logout` | — | `{ ok: true }` |
| GET | `/api/me` | — | `{ user }` ou `401` |
| GET | `/api/users?q=` | recherche facultative | `{ users: [...] }` |
| GET | `/api/conversations` | — | `{ conversations: [...] }` |
| POST | `/api/conversations` | `{ type: 'direct', userId }` **ou** `{ type: 'group', name, memberIds }` | `201 { conversation }` |
| GET | `/api/conversations/:id` | — | `{ conversation }` |
| GET | `/api/conversations/:id/messages?limit=&beforeId=` | — | `{ messages, hasMore }` |
| POST | `/api/conversations/:id/messages` | `{ body }` | `201 { message }` |
| POST | `/api/conversations/:id/upload` | multipart `file`, `kind=voice?`, `durationMs?` | `201 { message }` |
| GET | `/api/files/:messageId` | — | flux binaire (inline/attachment) |
| POST | `/api/conversations/:id/read` | — | `{ ok: true }` |

### Codes d'erreur utilisés

| Code | Signification dans LOBA |
|---|---|
| `400` | Donnée invalide (identifiant, message vide, fichier manquant…) |
| `401` | Non connecté ou session expirée |
| `403` | Pas membre de la conversation |
| `404` | Utilisateur, conversation, message ou fichier introuvable |
| `409` | Identifiant déjà pris |
| `413` | Fichier trop volumineux |
| `503` | MinIO indisponible |

### Créer une discussion privée

```http
POST /api/conversations
Content-Type: application/json
Cookie: loba_session=...

{ "type": "direct", "userId": 4 }
```

Si une discussion privée existe déjà entre les deux personnes, le serveur la
renvoie avec `existed: true` au lieu d'en créer une seconde. C'est une règle
métier importante : **une seule discussion directe par paire**.

### Créer un groupe

```http
POST /api/conversations
Content-Type: application/json

{ "type": "group", "name": "Équipe Produit", "memberIds": [4, 5] }
```

Le créateur est ajouté automatiquement. Un message `system` est inséré
(« Amina a créé le groupe… »), puis tous les membres reçoivent
`conversation:new` et leurs sockets rejoignent la room `conv:<id>`.

### Téléverser un fichier

```http
POST /api/conversations/1/upload
Content-Type: multipart/form-data

file=@photo.jpg
kind=voice          (facultatif)
durationMs=4200     (facultatif, pour un vocal)
```

Le fichier est gardé en mémoire (limite `MAX_UPLOAD_MB`, 25 Mo par défaut),
puis envoyé à MinIO sous une clé du type
`<conversationId>/<uuid>.<extension>`. Le nom d'origine n'est jamais utilisé
comme clé, ce qui évite les collisions et les traversées de chemin.

### Télécharger un fichier

`GET /api/files/:messageId` vérifie l'appartenance à la conversation, puis
renvoie le flux MinIO avec :

- `Content-Type` du fichier ;
- `Content-Disposition: inline` pour les images sûres, l'audio et la vidéo ;
- `Content-Disposition: attachment` pour tout le reste (dont les SVG) ;
- `X-Content-Type-Options: nosniff` ;
- `Content-Security-Policy: default-src 'none'; sandbox`.

---

## 6. Les événements Socket.IO

### 6.1 Authentification de la connexion

Le cookie de session est lu dans `socket.handshake.headers.cookie`. Si le
jeton est invalide, la connexion est refusée avant tout événement.

```js
io.use(async (socket, next) => {
  const user = await auth.userFromSocket(socket);
  if (!user) return next(new Error('Non connecté'));
  socket.data.user = user;
  next();
});
```

À la connexion, le serveur fait aussi :

1. `state.addSocket(user.id, socket.id)` ;
2. `socket.join('user:<id>')` ;
3. rejoindre toutes les rooms `conv:<id>` des conversations de l'utilisateur ;
4. mettre à jour `last_seen` ;
5. diffuser `presence:update { online: true }`.

### 6.2 Tableau des événements

#### Client → serveur

| Événement | Charge utile | Réponse (ack) |
|---|---|---|
| `typing` | `{ conversationId, isTyping }` | — |
| `call:invite` | `{ conversationId, kind, peerId }` | `{ ok, callId }` ou `{ ok: false, error }` |
| `call:accept` | `{ callId, peerId }` | `{ ok, participants }` |
| `call:decline` | `{ callId }` | — |
| `call:leave` | `{ callId }` | — |
| `call:end` | `{ callId }` | — |

#### Serveur → client

| Événement | Charge utile | Quand |
|---|---|---|
| `message:new` | message complet | Message texte/fichier/vocal créé |
| `typing` | `{ conversationId, userId, displayName, isTyping }` | Quelqu'un tape |
| `presence:update` | `{ userId, online }` | Connexion/déconnexion |
| `conversation:new` | `{ conversationId }` | Groupe créé |
| `call:incoming` | `{ callId, conversationId, conversationName, conversationType, kind, from }` | Invitation reçue |
| `call:peer-joined` | `{ callId, userId, peerId, user }` | Quelqu'un accepte |
| `call:peer-left` | `{ callId, userId }` | Quelqu'un quitte |
| `call:ended` | `{ callId, conversationId }` | Appel terminé |
| `call:declined` | `{ callId, userId, displayName }` | Refus |

### 6.3 La machine d'état des appels

```
                 call:invite
                     │
                     ▼
                 ┌────────┐   call:accept   ┌────────┐
                 │ringing │ ───────────────►│ active │
                 └────┬───┘                 └───┬────┘
                      │                         │
        call:decline  │                         │ call:leave
        (direct)      │                         │ (dernier participant)
                      ▼                         ▼
                 ┌──────────┐             ┌────────┐
                 │ declined │             │ ended  │
                 └──────────┘             └────────┘
                      ▲                         ▲
                      │ 45 s sans réponse       │ call:end / déconnexion
                      └─────────────────────────┘
```

Règles implémentées :

- un seul appel actif par conversation à la fois ;
- un appel privé ne peut être lancé que si l'autre personne est en ligne ;
- un groupe peut être appelé si **au moins un** membre est en ligne ;
- un refus termine un appel privé, mais pas un appel de groupe ;
- `call:leave` retire un participant ; l'appel se termine quand il n'en reste
  plus aucun ;
- une déconnexion Socket.IO retire aussi le participant.

---

## 7. Le client navigateur

### 7.1 `app.js` — chef d'orchestre

1. `GET /api/me` : si un cookie valide existe, on entre directement.
2. Sinon, affichage de l'écran de connexion / inscription.
3. `startApp(user)` :
   - charge les conversations (`loadConversations`) ;
   - ouvre Socket.IO (`connectSocket`) ;
   - initialise PeerJS (`initPeer`) ;
   - branche les gestionnaires d'événements.
4. Gère aussi les modales « nouvelle discussion », « nouveau groupe » et
   « utilisateurs ».

### 7.2 `chat.js` — messages et fichiers

- affichage de la liste des conversations avec aperçu, heure et non-lus ;
- chargement de l'historique par pages (`limit`, `beforeId`) ;
- envoi de texte via `POST /api/conversations/:id/messages` ;
- upload de fichiers et de vocaux ;
- rendu des images, PDF, documents et lecteurs audio ;
- enregistrement d'un vocal avec `MediaRecorder` ;
- indicateur de frappe (émission limitée dans le temps) ;
- marquage comme lu.

### 7.3 `calls.js` — appels

- création de l'objet `Peer` et gestion des erreurs ;
- `startCall('audio' | 'video')` ;
- réception d'un appel, sonnerie, acceptation, refus ;
- connexions média et attachement des flux aux balises `<video>`/`<audio>` ;
- maillage pour les groupes ;
- minuteur, micro, caméra, raccrochage ;
- nettoyage complet (arrêt des pistes, fermeture des connexions).

### 7.4 `state.js` (client) — état partagé

Contient `me`, `conversations`, `messages`, `activeId`, `peer`, `peerId`,
`call`, `incomingCall`, etc. C'est un simple objet exporté : tous les modules
importent la même référence.

### 7.5 `ui.js` — utilitaires

`escapeHtml`, `initials`, `avatarHtml`, `formatTime`, `formatDay`,
`formatListTime`, `formatSize`, `formatDuration`, `toast`, `openModal`,
`closeModal`, `debounce`.

> **Sécurité :** tout texte venant d'un utilisateur (message, nom de groupe,
> nom de fichier, nom affiché) est passé par `escapeHtml` avant d'être inséré
> dans `innerHTML`. C'est indispensable pour éviter les injections HTML.

---

## 8. Configuration

Toutes les variables sont lues dans `.env` par `src/config.js`.

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port du serveur |
| `HTTPS` | `true` | `false` pour du HTTP simple (local uniquement) |
| `DATABASE_URL` | `postgres://loba:loba@localhost:5432/loba` | Connexion PostgreSQL |
| `MINIO_ENDPOINT` | `localhost` | Hôte MinIO/S3 |
| `MINIO_PORT` | `9000` | Port MinIO |
| `MINIO_USE_SSL` | `false` | TLS vers MinIO |
| `MINIO_ACCESS_KEY` | `minioadmin` | Clé d'accès |
| `MINIO_SECRET_KEY` | `minioadmin` | Secret |
| `MINIO_BUCKET` | `loba` | Nom du bucket |
| `MAX_UPLOAD_MB` | `25` | Taille maximale d'un fichier |
| `SESSION_COOKIE` | `loba_session` | Nom du cookie |
| `PGSSL` | `false` | `true` pour activer TLS vers PostgreSQL |

Le fichier `.env` n'est **jamais** versionné (voir `.gitignore`). Seul
`.env.example` est dans le dépôt.

---

## 9. Choix de conception et limites

| Choix | Raison | Limite |
|---|---|---|
| Un seul serveur Node | Déploiement simple | Pas de montée en charge horizontale |
| État des appels en mémoire | Rapide à écrire | Perdu au redémarrage |
| Présence en mémoire | Pas de table à maintenir | Idem |
| Maillage WebRTC | Pas de serveur média | 4 participants maximum conseillés |
| Certificat auto-signé | Aucune configuration | Avertissement navigateur |
| Fichiers privés via l'API | Contrôle d'accès simple | Le serveur relaie la bande passante |
| MinIO | API S3 standard | Service externe à lancer |
| Pas de framework front | Base légère | Code plus verbeux |

Ces limites sont assumées : LOBA privilégie la simplicité et la lisibilité.
Les pistes d'amélioration sont dans
[06 — Aller plus loin](06-aller-plus-loin.md).

---

## 10. Parcours d'une requête dans le code

Exemple : Amina ouvre la conversation 1.

```
public/js/chat.js
  selectConversation(1)
    └─ api.get('/api/conversations/1/messages?limit=50')
         │
         ▼
src/routes.js
  router.get('/conversations/:id/messages', auth.requireAuth, ...)
    ├─ auth.requireAuth        → lit le cookie, charge l'utilisateur
    ├─ getMembership(1, userId) → vérifie l'accès
    ├─ db.many(...)            → SELECT ... ORDER BY id DESC LIMIT 50
    └─ res.json({ messages: rows.reverse().map(publicMessage) })
         │
         ▼
public/js/chat.js
  state.messages = ...
  renderMessages()
```

Chaque couche a une responsabilité claire :

- **routes.js** : HTTP, validation, droits, réponse ;
- **db.js** : SQL uniquement ;
- **serialize.js** : transformation SQL → JSON pour le navigateur ;
- **chat.js** : état et affichage.

👉 Passe au [03 — Guide d'utilisation](03-guide-utilisation.md) pour découvrir
l'application au quotidien.
