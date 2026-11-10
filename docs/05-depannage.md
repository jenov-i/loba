# 05 — Dépannage

Ce guide regroupe les problèmes les plus fréquents, classés par moment où ils
apparaissent. Commence toujours par lire **le message exact** affiché dans le
terminal ou dans le navigateur : il indique souvent la cause.

---

## 1. Réflexes de base

Avant de chercher longtemps :

1. **Regarde le terminal** où tourne `npm start`. Les erreurs serveur y sont
   affichées en clair.
2. **Ouvre la console du navigateur** : `F12` → onglet *Console*. Les erreurs
   JavaScript et les erreurs réseau y apparaissent.
3. **Vérifie les services** :
   ```bash
   docker compose ps
   curl -s http://localhost:9000 | head
   ```
4. **Redémarre proprement** :
   ```bash
   # Ctrl+C dans le terminal du serveur, puis :
   npm start
   ```
5. **Vérifie le fichier `.env`** : une faute de frappe dans un mot de passe ou
   un port suffit à tout casser.

---

## 2. Problèmes au démarrage

### 2.1 `EADDRINUSE: address already in use :::3000`

Un autre programme utilise le port 3000 (souvent une ancienne instance de
LOBA).

**Linux/macOS :**

```bash
fuser -k 3000/tcp
```

ou, si `fuser` n'est pas disponible :

```bash
lsof -i :3000
kill <PID>
```

**Windows :**

```powershell
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Alternative :** change `PORT=4000` dans `.env`, puis relance.

> N'utilise pas `pkill -f node` : cela tuerait aussi d'autres projets Node.

### 2.2 `ECONNREFUSED 127.0.0.1:5432`

PostgreSQL n'est pas démarré ou n'écoute pas sur le port attendu.

**Avec Docker :**

```bash
docker compose up -d
docker compose ps
```

**Sans Docker :**

```bash
sudo systemctl status postgresql     # Linux
brew services list                   # macOS
```

Vérifie aussi que `DATABASE_URL` pointe vers le bon port :

```dotenv
DATABASE_URL=postgres://loba:loba@localhost:5432/loba
```

### 2.3 `password authentication failed for user "loba"`

Le mot de passe dans `.env` ne correspond pas à celui de PostgreSQL.

Avec Docker, les identifiants sont fixés au **premier** démarrage du volume.
Si tu as changé `docker-compose.yml` après coup, l'ancien mot de passe reste.

**Solution simple (efface les données) :**

```bash
docker compose down -v
docker compose up -d
npm run seed
```

**Solution sans perte de données :** connecte-toi en superutilisateur et
change le mot de passe :

```sql
ALTER USER loba WITH PASSWORD 'loba';
```

### 2.4 `database "loba" does not exist`

La base n'a pas été créée (fréquent en installation sans Docker).

```bash
sudo -u postgres psql
```

```sql
CREATE USER loba WITH PASSWORD 'loba';
CREATE DATABASE loba OWNER loba;
\q
```

### 2.5 `[MinIO] indisponible : ...`

Le serveur démarre quand même : le chat texte fonctionne, mais **pas les
fichiers ni les vocaux**.

**Avec Docker :**

```bash
docker compose up -d minio
docker compose logs minio
```

**Sans Docker :**

```bash
npm run s3
```

Vérifie que le port 9000 est libre et que les identifiants de `.env`
correspondent :

- MinIO Docker : `minioadmin` / `minioadmin` ;
- s3rver : `S3RVER` / `S3RVER`.

Après avoir corrigé, **relance `npm start`** : le bucket est créé au démarrage.

### 2.6 `Impossible de générer le certificat` / `openssl: command not found`

OpenSSL est absent.

- **Ubuntu/Debian** : `sudo apt install openssl`
- **macOS** : `brew install openssl`
- **Windows** : utilise Git Bash (OpenSSL inclus) ou installe OpenSSL.

Tu peux aussi lancer sans HTTPS pour tester **uniquement sur localhost** :

```dotenv
HTTPS=false
```

Mais le micro et la caméra seront bloqués : HTTPS est obligatoire pour les
appels, même en local sur certains navigateurs.

### 2.7 `permission denied while trying to connect to the Docker daemon`

Ton utilisateur n'a pas le droit d'utiliser Docker.

```bash
sudo usermod -aG docker "$USER"
```

Puis **déconnecte-toi et reconnecte-toi** (ou redémarre la session).

### 2.8 `Port 5432 is already in use`

Un PostgreSQL local tourne déjà. Deux options :

1. Arrêter le PostgreSQL local :
   ```bash
   sudo systemctl stop postgresql
   ```
2. Ou changer le port publié dans `docker-compose.yml` :
   ```yaml
   ports:
     - "5433:5432"
   ```
   et adapter `.env` :
   ```dotenv
   DATABASE_URL=postgres://loba:loba@localhost:5433/loba
   ```

---

## 3. Problèmes dans le navigateur

### 3.1 « Votre connexion n'est pas privée »

C'est **normal** : le certificat est auto-signé.

- **Chrome/Edge** : *Paramètres avancés* → *Continuer vers localhost
  (dangereux)*.
- **Firefox** : *Avancé…* → *Accepter le risque et continuer*.
- **Safari** : *Afficher les détails* → *visiter ce site web*.

Si l'avertissement revient à chaque fois, tu utilises peut-être une adresse IP
qui a changé. Régénère le certificat :

```bash
npm run cert
```

Puis relance le serveur.

### 3.2 Le navigateur bloque le micro / la caméra

Le message ressemble à « Permission denied » ou « NotAllowedError ».

1. Vérifie que l'URL commence bien par **`https://`** (ou `http://localhost`).
2. Clique sur l'icône de réglages à gauche de la barre d'adresse → autorise
   **Microphone** et **Caméra** pour ce site.
3. Ferme les autres applications qui utilisent la caméra (Zoom, Teams, autre
   onglet).
4. Recharge la page.

Sous Linux, vérifie que ton utilisateur a accès aux périphériques audio/vidéo
et que le navigateur n'est pas lancé dans un conteneur sans accès matériel.

### 3.3 « Signalisation indisponible »

Le navigateur n'arrive pas à joindre le serveur PeerJS sur `/peer`.

Causes possibles :

- le serveur Node est arrêté ;
- un proxy ne laisse pas passer les WebSockets ;
- le port 3000 est bloqué par le pare-feu ;
- le certificat n'a pas été accepté.

**À vérifier :**

```bash
curl -k https://localhost:3000/peer/peerjs/id
```

Une réponse (même vide ou une erreur JSON) signifie que la route existe. Si tu
obtiens une erreur de connexion, le serveur ne tourne pas.

Dans la console du navigateur (`F12`), cherche `WebSocket connection failed` ou
`/peer/peerjs`.

Clique sur l'indicateur **« Signalisation indisponible »** en bas de la barre
latérale pour réessayer.

### 3.4 L'appel sonne mais il n'y a pas de son

Trois causes classiques :

1. **Réseau trop restrictif** (entreprise, 4G opérateur) : la connexion directe
   échoue. Il faut un serveur **TURN**. Voir
   [06 — Aller plus loin](06-aller-plus-loin.md#2-ajouter-un-serveur-turn-coturn).
2. **Mauvais périphérique de sortie** : vérifie le volume et la sortie audio de
   l'ordinateur.
3. **Le micro est coupé** : le bouton 🎤 barré coupe ta piste audio.

Regarde l'état de la connexion dans la console : `peer.on('error')` affiche
souvent `iceConnectionClosed` ou `peer-unavailable`.

### 3.5 Aucune sonnerie

Les navigateurs bloquent l'audio tant qu'il n'y a pas eu d'interaction.

- Clique une fois dans la page (par exemple sur une conversation) **avant** de
  recevoir l'appel.
- Vérifie que l'onglet n'est pas en sourdine (clic droit sur l'onglet →
  *Rétablir le son*).
- Vérifie le volume système.

La sonnerie est synthétisée, il n'y a **aucun fichier MP3** à télécharger.

### 3.6 « L'autre participant n'est plus joignable »

Le `peerId` de l'autre navigateur n'est plus valide : il a fermé l'onglet,
rechargé la page ou perdu la connexion.

Il suffit de relancer l'appel après sa reconnexion.

### 3.7 L'interface reste sur « Connexion à la signalisation… »

- Le serveur PeerJS n'est pas encore prêt : attends quelques secondes.
- Vérifie que `node_modules/peerjs/dist/peerjs.min.js` existe
  (`npm install`).
- Regarde la console : une erreur 404 sur `/vendor/peerjs.min.js` indique une
  installation incomplète.

```bash
ls node_modules/peerjs/dist/peerjs.min.js
npm install
```

---

## 4. Problèmes de messagerie

### 4.1 Les messages n'arrivent pas en temps réel

- Vérifie que Socket.IO est connecté : dans la console, cherche
  `WebSocket connection to ... failed`.
- Un proxy doit laisser passer les WebSockets (voir section 6).
- Si tu as rechargé la page, l'historique est rechargé par HTTP : les anciens
  messages doivent apparaître même si le temps réel est cassé.

### 4.2 Le compteur de non-lus ne se remet pas à zéro

Ouvre la conversation : `POST /api/conversations/:id/read` met à jour
`last_read_at`. Si le problème persiste, vérifie que la requête n'échoue pas
(onglet *Réseau* de la console).

### 4.3 « Le message est vide »

Le serveur refuse les messages composés uniquement d'espaces. Écris au moins un
caractère.

### 4.4 « Le message est trop long (4000 caractères max) »

Découpe le message ou envoie un fichier texte.

### 4.5 Les fichiers ne s'envoient pas

| Erreur | Cause | Solution |
|---|---|---|
| `413` / « Fichier trop volumineux » | > `MAX_UPLOAD_MB` (25 Mo) | Compresse le fichier ou augmente la limite |
| `503` / « stockage MinIO n'est pas disponible » | MinIO/s3rver arrêté | `docker compose up -d` ou `npm run s3`, puis relance LOBA |
| `403` | Tu n'es pas membre de la conversation | Recharge la page |
| Rien ne se passe | Fichier vide ou sélection annulée | Réessaie |

### 4.6 Une image ne s'affiche pas

- Les formats autorisés en aperçu sont PNG, JPEG, GIF, WebP et AVIF.
- Un **SVG** est volontairement proposé en téléchargement (risque XSS).
- Si l'image est très lourde, le navigateur peut mettre du temps.

### 4.7 Le message vocal ne s'enregistre pas

- Autorise le micro.
- `MediaRecorder` n'est pas disponible dans certains navigateurs anciens :
  utilise une version récente de Chrome, Firefox, Edge ou Safari.
- Si l'envoi échoue, vérifie MinIO (les vocaux sont des fichiers).

---

## 5. Problèmes de comptes et de sessions

### 5.1 « Identifiant ou mot de passe incorrect »

- Les identifiants sont **sensibles à la casse** pour le mot de passe, mais
  l'identifiant est converti en minuscules.
- Les comptes de démo n'existent qu'après `npm run seed`.
- Si tu as réinitialisé les volumes Docker, il faut relancer `npm run seed`.

### 5.2 « Cet identifiant est déjà utilisé »

Choisis un autre identifiant. Les identifiants sont uniques.

### 5.3 Je suis déconnecté sans raison

- La session expire après **30 jours**.
- `docker compose down -v` supprime la table `sessions`.
- Changer de navigateur ou vider les cookies efface le jeton.

Reconnecte-toi simplement.

### 5.4 Deux comptes dans le même navigateur

Un navigateur ne peut avoir qu'**une seule session** par origine (un cookie).
Pour tester deux personnes, utilise une fenêtre de navigation privée ou deux
navigateurs différents.

---

## 6. Problèmes réseau, proxy et Wi-Fi

### 6.1 Depuis un téléphone, la page ne s'ouvre pas

1. Le téléphone et l'ordinateur doivent être sur le **même Wi-Fi**.
2. Autorise le port 3000 dans le pare-feu.
3. Vérifie l'adresse affichée par `npm start` (elle change selon le réseau).
4. Certains réseaux Wi-Fi d'entreprise isolent les clients (*AP isolation*) :
   impossible de joindre un autre appareil.

### 6.2 Derrière un reverse proxy (Nginx, Caddy, Traefik)

Le proxy doit :

- transmettre les en-têtes `Host`, `X-Forwarded-For`, `X-Forwarded-Proto` ;
- laisser passer les **WebSockets** (`Upgrade: websocket`,
  `Connection: Upgrade`) ;
- ne pas bufferiser `/socket.io` ni `/peer/peerjs`.

Exemple Nginx minimal :

```nginx
location / {
    proxy_pass https://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Si les WebSockets sont bloqués, Socket.IO retombe sur du *long polling* : les
messages arrivent avec du retard, et les appels PeerJS peuvent échouer.

### 6.3 Deux réseaux différents (maison ↔ 4G)

Sans TURN, la connexion directe peut échouer. C'est une limite de WebRTC, pas
un bug de LOBA. Voir
[06 — Aller plus loin](06-aller-plus-loin.md#2-ajouter-un-serveur-turn-coturn).

---

## 7. Réinitialiser proprement

### 7.1 Réinitialiser les comptes de démo

```bash
npm run seed
```

Les comptes existants sont mis à jour, les messages sont conservés.

### 7.2 Effacer toutes les données PostgreSQL (Docker)

```bash
docker compose down -v
docker compose up -d
npm run seed
```

### 7.3 Effacer les fichiers MinIO (Docker)

```bash
docker compose down -v
docker compose up -d
```

### 7.4 Effacer les fichiers s3rver (sans Docker)

```bash
rm -rf .data/s3
npm run s3
```

Puis relance LOBA pour recréer le bucket.

### 7.5 Effacer les sessions

```sql
DELETE FROM sessions;
```

Tous les utilisateurs devront se reconnecter.

---

## 8. Diagnostic avancé

### 8.1 Vérifier la connexion à PostgreSQL

```bash
psql "postgres://loba:loba@localhost:5432/loba" -c "\dt"
```

Tu dois voir les tables `users`, `sessions`, `conversations`,
`conversation_members`, `messages`, `calls`.

### 8.2 Vérifier MinIO

```bash
curl -s http://localhost:9000 | head
```

Une réponse XML (`AccessDenied`, `ListAllMyBucketsResult`…) prouve que le
service répond.

### 8.3 Vérifier l'API

```bash
curl -k -i https://localhost:3000/api/me
```

Attendu : `HTTP/1.1 401` et `{"error":"Non connecté"}`.

### 8.4 Vérifier PeerJS

```bash
curl -k https://localhost:3000/peer/peerjs/id
```

### 8.5 Vérifier Socket.IO

Dans la console du navigateur :

```js
// après connexion
window.lobaDebug ??= {};
```

Ou observe l'onglet *Réseau* : une requête `socket.io/?EIO=4&transport=websocket`
doit rester ouverte (statut 101 *Switching Protocols*).

### 8.6 Logs Docker

```bash
docker compose logs -f db
docker compose logs -f minio
```

### 8.7 Tout est cassé, je veux repartir de zéro

```bash
# Arrêter le serveur : Ctrl+C

docker compose down -v      # efface PostgreSQL + MinIO
rm -rf node_modules .data certs
rm -f .env

cp .env.example .env
npm install
docker compose up -d
npm run seed
npm start
```

---

## 9. Tableau récapitulatif

| Message / symptôme | Cause la plus probable | Solution rapide |
|---|---|---|
| `EADDRINUSE` | Port occupé | `fuser -k 3000/tcp` ou change `PORT` |
| `ECONNREFUSED 5432` | PostgreSQL arrêté | `docker compose up -d` |
| `password authentication failed` | Mauvais mot de passe | Corrige `.env` ou recrée le volume |
| `database does not exist` | Base absente | `CREATE DATABASE loba` |
| `[MinIO] indisponible` | MinIO/s3rver arrêté | `docker compose up -d` / `npm run s3` |
| Avertissement certificat | Certificat auto-signé | Accepter l'exception |
| Micro refusé | HTTPS non accepté | Accepter le certificat, autoriser le site |
| Signalisation indisponible | WebSocket/proxy/port | Vérifier `/peer/peerjs`, pare-feu |
| Pas de son en appel | NAT strict | Ajouter un serveur TURN |
| Fichier `413` | > 25 Mo | Compresser ou augmenter la limite |
| Fichier `503` | MinIO arrêté | Relancer le stockage |
| Pas de messages en direct | WebSocket bloqué | Vérifier proxy/pare-feu |

---

## 10. Obtenir de l'aide

Si le problème persiste, rassemble :

1. le message d'erreur **complet** du terminal ;
2. les erreurs de la console du navigateur (`F12`) ;
3. la sortie de `docker compose ps` ;
4. ton système (Windows, macOS, Ubuntu…) et ta version de Node (`node -v`) ;
5. ce que tu faisais juste avant le problème.

Ouvre ensuite une *issue* sur le dépôt GitHub :
<https://github.com/jenov-i/loba/issues>.
