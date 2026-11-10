# 01 — Comment ça marche ?

Ce document explique **ce qui se passe réellement** quand tu envoies un message
ou que tu lances un appel avec LOBA. Aucune connaissance avancée n'est
nécessaire : on part des idées simples, puis on descend progressivement dans
les détails.

---

## 1. Le problème : envoyer du texte, puis du son et de l'image

Une application de messagerie doit faire deux choses très différentes :

1. **Échanger de petits événements** : « Alice a envoyé un message », « Bob est
   en ligne », « Carol appelle », « quelqu'un tape… ». Ces informations doivent
   arriver **instantanément** et de façon **fiable**.
2. **Transporter du son et de la vidéo** en temps réel, avec le moins de
   latence possible.

On pourrait tout faire passer par le serveur. Mais faire transiter deux flux
vidéo par un serveur central coûte cher en bande passante et ajoute de la
latence. Les navigateurs savent donc se connecter **directement entre eux** :
c'est le rôle de **WebRTC**.

LOBA utilise donc **deux canaux** :

```
   Navigateur A                                             Navigateur B
   ┌────────────┐        Socket.IO (passer par le serveur)  ┌────────────┐
   │            │  ─────────────────────────────────────►   │            │
   │            │   messages, présence, invitations d'appel  │            │
   │            │                                            │            │
   │            │        WebRTC / PeerJS (direct)            │            │
   │            │  ◄══════════════════════════════════════►  │            │
   └─────┬──────┘        audio + vidéo, de navigateur à       └─────┬──────┘
         │               navigateur (le serveur ne voit rien)       │
         │                                                          │
         │  API REST : connexion, historique, fichiers              │
         ▼                                                          ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │ Serveur Node.js                                                   │
   │  · Express (API REST + fichiers statiques)                        │
   │  · Socket.IO (temps réel)                                         │
   │  · PeerJS (signalisation WebRTC)                                  │
   │  · PostgreSQL (comptes, messages, appels)                         │
   │  · MinIO (fichiers, messages vocaux)                              │
   └───────────────────────────────────────────────────────────────────┘
```

> **À retenir :** Socket.IO sert à « se parler » et à « se trouver ».
> WebRTC sert à « se voir et s'entendre » directement.

---

## 2. Les trois briques du navigateur

### 2.1 `getUserMedia` : capturer le micro et la caméra

```js
const stream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: true,
});
```

Cette API demande l'autorisation à l'utilisateur, puis renvoie un **flux**
(`MediaStream`) contenant des pistes audio et vidéo. C'est ce flux que l'on
affiche dans une balise `<video>` ou que l'on envoie à l'autre personne.

Deux règles importantes :

- Le navigateur ne demande l'autorisation que dans un **contexte sécurisé** :
  `https://` ou `http://localhost`. C'est pour cela que LOBA génère un
  certificat HTTPS.
- Un flux ne peut pas être « copié » : on le partage. Plusieurs connexions
  WebRTC peuvent utiliser le même flux local (utile pour les appels de groupe).

### 2.2 `RTCPeerConnection` : la connexion directe

`RTCPeerConnection` représente **une connexion directe** entre deux
navigateurs. Pour l'établir, les deux côtés doivent échanger des informations
techniques :

- **SDP** (*Session Description Protocol*) : un texte qui décrit les codecs
  audio/vidéo, les formats acceptés, etc. On l'obtient avec
  `createOffer()` / `createAnswer()`.
- **ICE** (*Interactive Connectivity Establishment*) : une liste de chemins
  réseau possibles (adresses locales, adresse publique, relais). On les
  échange via `onicecandidate`.

C'est ce qu'on appelle la **signalisation**. WebRTC ne dit pas *comment*
transporter ces messages : c'est à l'application de le faire. LOBA utilise
Socket.IO et le serveur PeerJS pour cela.

### 2.3 Les serveurs STUN et TURN

La plupart des ordinateurs sont derrière un routeur (NAT) : ils n'ont pas
d'adresse publique directement joignable.

- **STUN** : un serveur public qui répond « voici l'adresse que le monde voit
  de toi ». Il suffit pour beaucoup de réseaux domestiques. LOBA utilise les
  serveurs STUN de Google.
- **TURN** : un relais. Si la connexion directe est impossible (réseau
  d'entreprise, 4G opérateur), le trafic passe par le serveur TURN. LOBA n'en
  fournit pas par défaut ; voir
  [06 — Aller plus loin](06-aller-plus-loin.md#2-ajouter-un-serveur-turn-coturn).

---

## 3. À quoi sert PeerJS ?

Écrire toute la signalisation WebRTC à la main est long et source d'erreurs.
**PeerJS** fournit :

- un **serveur de signalisation** qui attribue un identifiant à chaque
  navigateur (par exemple `k3J9...`) ;
- une API simple :
  ```js
  const peer = new Peer();                 // se connecte au serveur
  peer.on('open', (id) => { /* mon identifiant */ });
  const call = peer.call(peerId, stream);  // appeler quelqu'un
  peer.on('call', (call) => call.answer(stream)); // répondre
  ```

Dans LOBA, le serveur PeerJS est monté sur **le même serveur HTTPS**, à
l'adresse `/peer`. Le navigateur s'y connecte ainsi :

```js
new Peer(undefined, {
  host: window.location.hostname,
  port: Number(window.location.port) || 443,
  path: '/peer',
  secure: window.location.protocol === 'https:',
});
```

Le détail délicat se trouve dans `src/peer-server.js` : PeerJS et Socket.IO
utilisent tous les deux le **protocole WebSocket**. Pour éviter qu'ils se
volent leurs connexions, LOBA crée un serveur WebSocket « manuel » qui ne
traite que le chemin `/peer/peerjs`. Les autres chemins (dont `/socket.io`)
restent à Socket.IO.

```
Navigateur ──wss://localhost:3000/peer/peerjs──► PeerJS (signalisation)
Navigateur ──wss://localhost:3000/socket.io───► Socket.IO (messages)
```

---

## 4. À quoi sert Socket.IO ?

Socket.IO maintient une connexion **permanente** entre le navigateur et le
serveur. Le serveur peut donc pousser un événement vers le navigateur sans que
celui-ci ait besoin de redemander quelque chose.

LOBA s'en sert pour :

| Événement | Direction | Rôle |
|---|---|---|
| `message:new` | serveur → clients | Un nouveau message est arrivé |
| `typing` | client → serveur → clients | « X est en train d'écrire » |
| `presence:update` | serveur → clients | X vient de se connecter / déconnecter |
| `conversation:new` | serveur → clients | Un groupe vient d'être créé |
| `call:incoming` | serveur → client | Une personne t'appelle |
| `call:peer-joined` | serveur → clients | Quelqu'un a rejoint l'appel |
| `call:peer-left` | serveur → clients | Quelqu'un a quitté l'appel |
| `call:ended` | serveur → clients | L'appel est terminé |
| `call:declined` | serveur → clients | Quelqu'un a refusé |

### Les « rooms »

Socket.IO permet de regrouper les connexions dans des **rooms** (salons).
LOBA en utilise trois sortes :

- `user:<id>` : tous les onglets d'un utilisateur donné ;
- `conv:<id>` : tous les membres d'une conversation ;
- `call:<id>` : tous les participants d'un appel en cours.

Quand Alice envoie un message dans la conversation 7, le serveur fait :

```js
io.to('conv:7').emit('message:new', message);
```

Seuls les navigateurs présents dans la room `conv:7` reçoivent l'événement.

---

## 5. Le parcours complet d'un message

Prenons Alice qui écrit « Salut Bob ! » dans leur discussion privée.

```
1. Alice tape le texte et clique sur Envoyer.
        │
2. Le navigateur appelle :
   POST /api/conversations/1/messages  { "body": "Salut Bob !" }
        │
3. Express vérifie le cookie de session (auth.requireAuth).
        │
4. Le serveur vérifie qu'Alice est bien membre de la conversation 1.
        │
5. INSERT INTO messages (...) RETURNING *   → PostgreSQL
        │
6. Le serveur émet :
   io.to('conv:1').emit('message:new', message)
        │
7. Le navigateur d'Alice ET celui de Bob reçoivent l'événement.
   (Alice voit son message; Bob aussi, instantanément.)
        │
8. Le serveur répond aussi à la requête HTTP avec le message créé.
```

Pourquoi passer par HTTP **et** Socket.IO ? Parce que l'envoi doit être
confirmé (HTTP) et la réception doit être instantanée pour tout le monde
(Socket.IO). Le message n'est jamais envoyé directement de navigateur à
navigateur : il est toujours stocké avant d'être diffusé.

### Les fichiers et messages vocaux

Les fichiers ne passent pas dans Socket.IO. Le navigateur envoie le fichier
avec `POST /api/conversations/:id/upload` (multipart). Le serveur :

1. vérifie les droits ;
2. range le fichier dans **MinIO** sous une clé aléatoire ;
3. insère une ligne `messages` avec `kind = 'file'` ou `'voice'` ;
4. diffuse le message via `message:new`, comme un message texte.

Pour lire le fichier, le navigateur appelle
`GET /api/files/:messageId`. Le serveur vérifie encore les droits, puis
relaie le flux depuis MinIO. **MinIO n'est jamais exposé directement** : un
fichier n'est lisible que par les membres de la conversation.

---

## 6. Le parcours complet d'un appel privé

### 6.1 L'invitation (Socket.IO)

```
Alice clique sur 📞
   │
   ├─ getUserMedia({ audio: true })          → flux local
   ├─ PeerJS est déjà connecté                → peerId d'Alice
   │
   └─ socket.emit('call:invite', { conversationId, kind: 'audio', peerId })
            │
            ▼
       Serveur : crée un appel en mémoire + une ligne dans la table calls
       Serveur : trouve les autres membres en ligne
       Serveur : io.to('user:<bob>').emit('call:incoming', { ... })
            │
            ▼
       Bob reçoit l'événement → affiche la modale + joue la sonnerie
```

### 6.2 L'acceptation (Socket.IO puis WebRTC)

```
Bob clique sur le bouton vert
   │
   ├─ getUserMedia({ audio: true })
   ├─ socket.emit('call:accept', { callId, peerId: peerIdDeBob })
   │        │
   │        ▼
   │   Serveur : marque l'appel "active"
   │   Serveur : répond avec la liste des participants déjà présents
   │   Serveur : prévient Alice via 'call:peer-joined'
   │
   └─ Pour chaque participant déjà présent :
          peer.call(peerIdDeAlice, fluxLocalDeBob)
                   │
                   ▼
          Alice reçoit peer.on('call') et répond avec son propre flux
                   │
                   ▼
          Connexion WebRTC établie : le son circule directement
```

Le serveur ne voit **jamais** l'audio. Il a seulement aidé les deux
navigateurs à se trouver.

### 6.3 Le raccrochage

```js
socket.emit('call:end', { callId });   // appel privé : tout le monde raccroche
socket.emit('call:leave', { callId }); // groupe : je pars, les autres restent
```

Le serveur supprime l'appel de sa mémoire, met à jour la table `calls`
(`ended`, `declined`, `missed`…) et prévient les autres avec `call:ended` ou
`call:peer-left`. Chaque navigateur ferme alors ses connexions PeerJS et
coupe les pistes locales (`track.stop()`), ce qui éteint la caméra.

---

## 7. Les appels de groupe : le maillage (mesh)

Pour un groupe de 3 personnes, il n'y a pas de « serveur d'appel ». Chaque
navigateur ouvre une connexion WebRTC avec **chacun des autres** :

```
          Alice
         /     \
        /       \
     Bob ─────── Carol
```

- Alice envoie son flux à Bob et à Carol.
- Bob envoie son flux à Alice et à Carol.
- Carol envoie son flux à Alice et à Bob.

C'est la topologie **maillée** (*mesh*). Avantages : simple, pas de serveur
média, latence minimale. Inconvénient : le nombre de connexions explose.

| Participants | Connexions par personne | Connexions totales |
|---:|---:|---:|
| 2 | 1 | 1 |
| 3 | 2 | 3 |
| 4 | 3 | 6 |
| 5 | 4 | 10 |
| 6 | 5 | 15 |

LOBA recommande donc **2 à 4 personnes**. Au-delà, il faut un **SFU**
(*Selective Forwarding Unit*) comme LiveKit, mediasoup ou Janus : chaque
navigateur n'envoie qu'un seul flux au serveur, qui le redistribue. Voir
[06 — Aller plus loin](06-aller-plus-loin.md#3-passer-à-un-serveur-sfu).

---

## 8. La sonnerie, sans fichier MP3

LOBA n'embarque aucun fichier audio. La sonnerie est **synthétisée** avec
l'API **Web Audio** (`public/js/sounds.js`) :

```js
const ctx = new AudioContext();
const oscillator = ctx.createOscillator();
oscillator.frequency.value = 660;   // fréquence en hertz
oscillator.connect(ctx.destination);
oscillator.start();
```

- **Appel entrant** : deux notes (660 Hz + 880 Hz) jouées deux fois, toutes
  les 2,5 secondes.
- **Appel sortant** : un bip à 440 Hz toutes les 3 secondes.

Les navigateurs bloquent le son tant que l'utilisateur n'a pas interagi avec
la page. C'est pourquoi `unlockAudio()` est appelé au premier clic (et au
moment de la connexion).

---

## 9. Présence et « en train d'écrire »

### Présence

Le serveur garde en mémoire une correspondance `userId → nombre d'onglets
ouverts` (`src/state.js`). Quand le premier onglet se connecte, l'utilisateur
devient **en ligne** ; quand le dernier se ferme, il passe **hors ligne** et
`last_seen` est enregistré dans PostgreSQL.

```js
state.addSocket(user.id, socket.id);       // connexion
state.removeSocket(user.id, socket.id);    // déconnexion
```

Cette information n'est pas stockée en base : elle est perdue au redémarrage
du serveur. C'est acceptable pour un projet à un seul serveur.

### Frappe

À chaque touche, le navigateur émet `typing` (au plus une fois toutes les
quelques centaines de millisecondes). Le serveur relaie aux autres membres de
la conversation. Après 2 secondes sans frappe, le client envoie
`isTyping: false`. Rien n'est stocké.

---

## 10. Le rôle de PostgreSQL et de MinIO

| Donnée | Où elle vit | Pourquoi |
|---|---|---|
| Comptes, mots de passe hachés | PostgreSQL | Requêtes, unicité, sécurité |
| Sessions | PostgreSQL | Survit au redémarrage du serveur |
| Conversations et membres | PostgreSQL | Relations et droits d'accès |
| Messages (texte, métadonnées de fichiers) | PostgreSQL | Historique, recherche, compteurs |
| Journal des appels | PostgreSQL | Statut, durée, historique |
| Fichiers, images, vocaux | MinIO | Gros objets binaires, API S3 |

Les fichiers ne sont **pas** stockés dans PostgreSQL : ce serait inefficace et
lourd. On stocke seulement la **clé** de l'objet MinIO dans la colonne
`messages.file_key`.

---

## 11. Pourquoi HTTPS est obligatoire

`getUserMedia` (micro/caméra) n'est autorisé que dans un **contexte
sécurisé** :

- `https://...` ;
- ou `http://localhost` (exception pour le développement local).

Depuis un téléphone qui ouvre `http://192.168.1.42:3000`, le navigateur
refuserait le micro. C'est pour cela que LOBA :

1. génère un certificat auto-signé au premier démarrage
   (`src/certificates.js`) ;
2. sert tout le site en HTTPS sur le port 3000.

Le certificat étant auto-signé, le navigateur affiche un avertissement. Il
faut l'accepter une fois. En production, on utiliserait un vrai certificat
(Let's Encrypt) derrière un reverse proxy.

---

## 12. Vocabulaire

| Terme | Définition simple |
|---|---|
| **WebRTC** | Technologie des navigateurs pour l'audio/vidéo en direct |
| **Peer** | Un participant (un navigateur) dans une connexion directe |
| **Signalisation** | Échange des informations nécessaires avant la connexion directe |
| **SDP** | Description technique d'une session (codecs, formats) |
| **ICE** | Recherche du meilleur chemin réseau entre deux pairs |
| **STUN** | Serveur qui indique ton adresse publique |
| **TURN** | Serveur relais quand la connexion directe échoue |
| **SFU** | Serveur qui relaie les flux pour les grands groupes |
| **Mesh** | Topologie où chacun est connecté à tous |
| **Socket.IO** | Bibliothèque de communication temps réel client ↔ serveur |
| **PeerJS** | Bibliothèque qui simplifie WebRTC et fournit la signalisation |
| **MinIO** | Stockage de fichiers compatible avec l'API Amazon S3 |
| **Room** | Groupe de connexions Socket.IO qui reçoivent les mêmes événements |

---

## 13. Où lire le code

| Sujet | Fichier |
|---|---|
| Démarrage, HTTPS, branchement de tout | `src/server.js` |
| API REST complète | `src/routes.js` |
| Événements temps réel et machine d'appel | `src/sockets.js` |
| Serveur de signalisation PeerJS | `src/peer-server.js` |
| Stockage MinIO | `src/storage.js` |
| Authentification et sessions | `src/auth.js` |
| Logique d'appel côté navigateur | `public/js/calls.js` |
| Messages, fichiers, vocaux | `public/js/chat.js` |
| Sonnerie Web Audio | `public/js/sounds.js` |
| Branchement Socket.IO côté client | `public/js/app.js` |

👉 Continue avec [02 — Architecture du projet](02-architecture-du-projet.md)
pour le rôle détaillé de chaque fichier, de la base de données et des API.
