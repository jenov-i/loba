# LOBA — messagerie instantanée et appels

> **LOBA** réunit la messagerie, les appels audio/vidéo, les messages vocaux et
> le partage de fichiers dans une interface simple. Discussions privées,
> groupes et appels directs, avec **Node.js, Socket.IO, PeerJS (WebRTC),
> PostgreSQL et MinIO**. Aucun framework front-end, aucune étape de build.

LOBA fonctionne avec un compte que tu crées toi-même.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Aperçu](#aperçu)
- [Technologies utilisées](#technologies-utilisées)
- [Démarrage rapide (5 minutes)](#démarrage-rapide-5-minutes)
- [Tester à deux (ou depuis un téléphone)](#tester-à-deux-ou-depuis-un-téléphone)
- [Commandes utiles](#commandes-utiles)
- [Structure du code](#structure-du-code)
- [Comment ça marche (résumé)](#comment-ça-marche-résumé)
- [Dépannage express](#dépannage-express)
- [Limites connues et sécurité](#limites-connues-et-sécurité)
- [Documentation détaillée](#documentation-détaillée)
- [Licence](#licence)

---

## Fonctionnalités

| Fonctionnalité | État | Où c'est implémenté |
|---|---|---|
| Création de compte / connexion | ✅ | `src/auth.js`, `src/routes.js`, `public/js/app.js` |
| Messages texte en temps réel | ✅ | `src/sockets.js`, `public/js/chat.js` |
| Discussion privée (chat + audio + vidéo) | ✅ | `src/routes.js`, `public/js/calls.js` |
| Discussion de groupe (chat + audio + vidéo) | ✅ | `src/routes.js`, `public/js/calls.js` |
| Appel audio 1‑à‑1 | ✅ | PeerJS + `public/js/calls.js` |
| Appel vidéo 1‑à‑1 | ✅ | PeerJS + `public/js/calls.js` |
| Appels de groupe (maillage P2P) | ✅ (2 à 4 personnes recommandées) | `public/js/calls.js` |
| Sonnerie d'appel entrant + tonalité d'appel sortant | ✅ (générées en Web Audio) | `public/js/sounds.js` |
| Messages vocaux (enregistrement navigateur) | ✅ | `public/js/chat.js`, `src/routes.js` |
| Partage de fichiers (images, PDF, documents…) | ✅ | `src/routes.js`, `src/storage.js` |
| Stockage des fichiers dans MinIO (S3) | ✅ | `src/storage.js` |
| Base de données PostgreSQL | ✅ | `sql/schema.sql`, `src/db.js` |
| Présence en ligne / hors ligne | ✅ | `src/state.js`, `src/sockets.js` |
| Indicateur « en train d'écrire… » | ✅ | `src/sockets.js`, `public/js/chat.js` |
| Compteur de messages non lus | ✅ | `src/routes.js`, `public/js/chat.js` |
| Historique persistant des messages | ✅ | table `messages` |
| Journal des appels | ✅ | table `calls` |
| HTTPS (certificat auto-signé généré automatiquement) | ✅ | `src/certificates.js` |

---

## Aperçu

### Connexion

![Écran de connexion](docs/screenshots/01-connexion.png)

### Discussion et messages

![Discussion privée](docs/screenshots/02-discussion.png)

### Groupe

![Discussion de groupe](docs/screenshots/03-groupe.png)

### Appel entrant (sonnerie)

![Appel entrant](docs/screenshots/04-appel-entrant.png)

---

## Technologies utilisées

| Technologie | Rôle dans LOBA | Pourquoi ce choix |
|---|---|---|
| **Node.js + Express** | Serveur web, API REST, fichiers statiques | JavaScript partout, simple à comprendre |
| **Socket.IO** | Temps réel : messages, présence, invitations d'appel | Gère les reconnexions et les « rooms » |
| **WebRTC** | Transport direct de l'audio et de la vidéo | Standard du navigateur, faible latence |
| **PeerJS** | Simplifie WebRTC + fournit la signalisation | Évite d'écrire SDP/ICE à la main |
| **PostgreSQL** | Utilisateurs, messages, conversations, appels | Base relationnelle fiable |
| **MinIO** | Stockage des fichiers et vocaux (API S3) | Fichiers privés, pas dans la base |
| **HTTPS** | Sécurité + accès micro/caméra | `getUserMedia` exige un contexte sécurisé |
| **HTML/CSS/JS** | Interface (aucun framework, aucun build) | Base légère et facile à personnaliser |

> **Note sur MinIO :** MinIO n'est plus distribué librement sur Docker Hub.
> Le `docker-compose.yml` utilise donc une image MinIO archivée par Bitnami.
> Si tu n'as pas Docker, `npm run s3` démarre un serveur S3 de développement :
> le code utilise le SDK MinIO et fonctionne avec les deux.

---

## Démarrage rapide (5 minutes)

### 1. Prérequis

- **Node.js 20 ou plus** — [télécharger](https://nodejs.org/) (`node -v` doit afficher `v20…` ou plus).
- **Docker + Docker Compose** — [installer Docker](https://docs.docker.com/engine/install/).
  (Pas Docker ? Voir [l'installation sans Docker](docs/04-installation-pas-a-pas.md#5-option-b--sans-docker).)

### 2. Récupérer le code

```bash
git clone https://github.com/jenov-i/loba.git
cd loba
```

### 3. Configurer

```bash
cp .env.example .env
```

Les valeurs par défaut fonctionnent avec le `docker-compose.yml` fourni.

### 4. Démarrer PostgreSQL et MinIO

```bash
docker compose up -d
```

Vérifie que les deux conteneurs tournent :

```bash
docker compose ps
```

### 5. Installer les dépendances

```bash
npm install
```

### 6. Lancer LOBA

```bash
npm start
```

Le terminal affiche :

```
  LOBA est démarré !
  Local   : https://localhost:3000
  Réseau  : https://192.168.1.42:3000
```

### 7. Ouvrir l'application

Va sur **https://localhost:3000**.

> ⚠️ **Avertissement de certificat : c'est normal.**
> LOBA génère un certificat HTTPS auto-signé au premier démarrage. Le navigateur
> affiche « Votre connexion n'est pas privée ».
> Clique sur **Paramètres avancés** → **Continuer vers localhost (dangereux)**.
> Sans cela, le navigateur refusera l'accès au micro et à la caméra.

Clique sur **Créer un compte**, choisis un nom, un identifiant et un mot de
passe. Tu peux ensuite rechercher d'autres personnes inscrites et démarrer une
discussion.

---

## Tester à deux (ou depuis un téléphone)

### Sur le même ordinateur

Le plus simple est d'utiliser **deux profils de navigateur différents**
(ou une fenêtre de navigation privée), car une session = un cookie :

1. Fenêtre normale → crée un premier compte.
2. Fenêtre privée → crée un second compte.
3. Le premier compte ouvre la discussion avec le second et envoie un message.
4. Clique sur l'icône 📞 (audio) ou 🎥 (vidéo).
5. Chez l'autre personne, la sonnerie retentit : clique sur le bouton vert
   pour accepter.

> Utilise **deux navigateurs différents** (Chrome + Firefox) si tu veux tester
> un appel : certains systèmes n'autorisent qu'un seul accès à la caméra à la fois.

### Depuis un téléphone sur le même Wi‑Fi

1. Au démarrage, LOBA affiche une adresse `https://192.168.x.x:3000`.
2. Ouvre cette adresse sur le téléphone (même réseau Wi‑Fi).
3. Accepte l'avertissement de certificat.
4. Crée un compte ou connecte-toi avec un autre compte.

Si l'adresse ne s'ouvre pas : vérifie le pare-feu de l'ordinateur (port 3000).

---

## Commandes utiles

| Commande | Effet |
|---|---|
| `npm start` | Démarre le serveur (HTTPS sur le port 3000) |
| `npm run dev` | Démarre avec rechargement automatique |
| `npm run cert` | Régénère le certificat HTTPS (après un changement d'IP) |
| `npm run s3` | Démarre un stockage S3 local (sans Docker/MinIO) |
| `docker compose up -d` | Démarre PostgreSQL + MinIO |
| `docker compose down` | Arrête les services (données conservées) |
| `docker compose down -v` | Arrête **et efface** les données |

---

## Structure du code

```
LOBA/
├── src/                      # Côté serveur (Node.js)
│   ├── server.js             # Point d'entrée : HTTPS + Express + Socket.IO + PeerJS
│   ├── config.js             # Lecture du fichier .env
│   ├── db.js                 # Connexion PostgreSQL + création des tables
│   ├── auth.js               # Mots de passe, sessions, cookies
│   ├── routes.js             # API REST (connexion, messages, fichiers...)
│   ├── sockets.js            # Temps réel (messages, présence, invitations d'appel)
│   ├── peer-server.js        # Serveur de signalisation PeerJS (/peer)
│   ├── storage.js            # Envoi/lecture des fichiers dans MinIO
│   ├── certificates.js       # Génération du certificat HTTPS auto-signé
│   ├── state.js              # Qui est en ligne ? (mémoire)
│   └── serialize.js          # Mise en forme des données pour le navigateur
│
├── public/                   # Côté navigateur
│   ├── index.html            # Toute l'interface (une seule page)
│   ├── css/style.css         # Styles
│   ├── img/logo.svg
│   └── js/
│       ├── app.js            # Démarrage, connexion, Socket.IO
│       ├── api.js            # Appels HTTP vers /api
│       ├── state.js          # État partagé (utilisateur, discussions...)
│       ├── ui.js             # Petites fonctions d'affichage
│       ├── chat.js           # Messages, fichiers, vocaux
│       ├── calls.js          # Appels PeerJS + interface d'appel
│       └── sounds.js         # Sonnerie et tonalité (Web Audio)
│
├── sql/schema.sql            # Structure de la base de données
├── scripts/
│   ├── generate-cert.js      # Régénère certs/
│   └── dev-s3.js             # Stockage S3 local sans Docker
├── docs/                     # Documentation détaillée (en français)
├── docker-compose.yml        # PostgreSQL + MinIO
├── .env.example              # Modèle de configuration
└── package.json
```

Chaque fichier est commenté en français, avec des explications sur le
« pourquoi » et pas seulement le « comment ».

---

## Comment ça marche (résumé)

LOBA utilise **deux canaux différents** :

```
   Navigateur A                                            Navigateur B
   ┌───────────┐        Socket.IO (signalisation)        ┌───────────┐
   │           │  ───────────────────────────────────►   │           │
   │           │   messages, présence, invitations        │           │
   │           │                                          │           │
   │           │        WebRTC / PeerJS (média)           │           │
   │           │  ◄══════════════════════════════════►    │           │
   └─────┬─────┘        audio + vidéo DIRECTEMENT          └─────┬─────┘
         │                                                        │
         │  API REST + fichiers                                   │
         ▼                                                        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Serveur Node : Express · Socket.IO · PeerJS                 │
   │  PostgreSQL (messages, comptes)   MinIO (fichiers, vocaux)   │
   └──────────────────────────────────────────────────────────────┘
```

1. **Socket.IO** sert à se « trouver » : envoyer les messages, signaler qui est
   en ligne, inviter quelqu'un à un appel.
2. **WebRTC (via PeerJS)** transporte ensuite l'audio et la vidéo **directement**
   entre les navigateurs. Le serveur ne voit pas les images ni le son.
3. **PostgreSQL** garde l'historique (comptes, messages, conversations, appels).
4. **MinIO** garde les fichiers et les messages vocaux ; l'accès est contrôlé par
   l'API (les fichiers ne sont pas publics).

👉 Pour tout comprendre pas à pas :
**[docs/01-comment-ca-marche.md](docs/01-comment-ca-marche.md)**

---

## Dépannage express

| Problème | Cause probable | Solution |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL n'est pas démarré | `docker compose up -d` |
| `password authentication failed` | Mauvais `DATABASE_URL` dans `.env` | Utilise `postgres://loba:loba@localhost:5432/loba` |
| `[MinIO] indisponible` | MinIO n'est pas démarré | `docker compose up -d` ou `npm run s3` |
| Le navigateur bloque le micro | HTTPS non accepté | Accepte le certificat, utilise `https://` (pas `http://`) |
| « Signalisation indisponible » | Port 3000 bloqué / proxy sans WebSocket | Vérifie le pare-feu et la config du proxy |
| L'appel sonne mais pas de son | Réseaux différents sans TURN | Voir [aller plus loin](docs/06-aller-plus-loin.md#2-ajouter-un-serveur-turn-coturn) |
| `EADDRINUSE :3000` | Un autre programme utilise le port | `fuser -k 3000/tcp` ou change `PORT` dans `.env` |

Le guide complet : **[docs/05-depannage.md](docs/05-depannage.md)**

---

## Limites connues et sécurité

LOBA est conçu pour un usage simple et un déploiement léger. Voici ce qu'il
faut garder en tête avant de l'ouvrir à un large public :

- **Appels de groupe en maillage (mesh)** : chaque participant est connecté à
  tous les autres. Recommandé jusqu'à **4 personnes**. Au-delà, il faut un
  serveur **SFU** (LiveKit, mediasoup…).
- **STUN uniquement** : deux personnes derrière des réseaux très stricts
  (entreprise, 4G opérateur) peuvent ne pas se connecter. Il faut alors un
  serveur **TURN** (coturn).
- **Certificat auto-signé** : le navigateur affiche un avertissement.
- **Présence et appels en mémoire** : un seul serveur Node. Pas de montée en
  charge horizontale.
- **Messages stockés en clair dans PostgreSQL**. Les médias WebRTC sont chiffrés
  en transit (DTLS‑SRTP), mais pas de chiffrement de bout en bout applicatif.
- Pas de limitation de tentatives de connexion (rate limiting), pas de
  vérification d'e-mail, pas de modération.

Ces points sont détaillés avec des pistes d'amélioration dans
**[docs/06-aller-plus-loin.md](docs/06-aller-plus-loin.md)**.

---

## Documentation détaillée

| Document | Contenu |
|---|---|
| [01 — Comment ça marche](docs/01-comment-ca-marche.md) | WebRTC, SDP, ICE, PeerJS, Socket.IO, sonnerie, flux d'un message et d'un appel |
| [02 — Architecture du code](docs/02-architecture-du-code.md) | Rôle de chaque fichier, base de données, API, événements Socket.IO |
| [03 — Guide d'utilisation](docs/03-guide-utilisation.md) | Créer un compte, discuter, envoyer des fichiers/vocaux, appeler |
| [04 — Installation pas à pas](docs/04-installation-pas-a-pas.md) | Installation détaillée avec et sans Docker, certificats, réseau |
| [05 — Dépannage](docs/05-depannage.md) | Tous les problèmes courants et leurs solutions |
| [06 — Aller plus loin](docs/06-aller-plus-loin.md) | TURN, SFU, sécurité, déploiement, scaling |

---

## Licence

[MIT](LICENSE)
