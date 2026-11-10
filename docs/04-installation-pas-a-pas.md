# 04 — Installation pas à pas

Ce guide installe LOBA **depuis zéro**, même si tu n'as jamais utilisé Docker
ni PostgreSQL. Suis les étapes dans l'ordre.

Deux chemins possibles :

- **Option A (recommandée)** : Docker pour PostgreSQL et MinIO.
- **Option B** : sans Docker, avec PostgreSQL installé sur la machine et un
  stockage S3 de développement.

Durée estimée : 10 à 20 minutes.

---

## 1. Prérequis

### 1.1 Node.js 20 ou plus

Vérifie la version :

```bash
node -v
npm -v
```

Tu dois voir `v20.x`, `v22.x` ou plus. Sinon, télécharge Node.js :
<https://nodejs.org/> (choisis la version **LTS**).

### 1.2 Git

```bash
git --version
```

Sinon : <https://git-scm.com/downloads>.

### 1.3 Docker (option A)

```bash
docker --version
docker compose version
```

- Sur Linux, ajoute ton utilisateur au groupe `docker` pour éviter `sudo` :
  ```bash
  sudo usermod -aG docker "$USER"
  ```
  Puis **déconnecte-toi et reconnecte-toi**.
- Sur Windows/macOS : installe **Docker Desktop** et démarre-le.

### 1.4 OpenSSL

LOBA génère son certificat HTTPS avec OpenSSL :

```bash
openssl version
```

Il est déjà présent sur Linux et macOS. Sur Windows, il est fourni avec Git
Bash ; sinon, installe-le via <https://slproweb.com/products/Win32OpenSSL.html>.

---

## 2. Récupérer le code

```bash
git clone https://github.com/jenov-i/loba.git
cd loba
```

Si tu as téléchargé une archive ZIP, décompresse-la et ouvre un terminal dans
le dossier.

---

## 3. Configurer l'application

```bash
cp .env.example .env
```

Sous Windows (PowerShell) :

```powershell
Copy-Item .env.example .env
```

Ouvre `.env` avec un éditeur. Les valeurs par défaut conviennent à l'option A :

```dotenv
PORT=3000
HTTPS=true
DATABASE_URL=postgres://loba:loba@localhost:5432/loba
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=loba
MAX_UPLOAD_MB=25
```

> Ne mets **jamais** ce fichier sur GitHub : il est déjà dans `.gitignore`.

---

## 4. Option A — avec Docker (recommandée)

### 4.1 Démarrer PostgreSQL et MinIO

```bash
docker compose up -d
```

La première fois, Docker télécharge les images (quelques minutes). Vérifie
ensuite :

```bash
docker compose ps
```

Tu dois voir `loba-db` et `loba-minio` en état `running` (ou `healthy`).

### 4.2 Installer les dépendances

```bash
npm install
```

### 4.3 Lancer LOBA

```bash
npm start
```

Tu dois voir :

```
[PostgreSQL] schéma vérifié
[MinIO] bucket "loba" prêt

  LOBA est démarré !
  Local   : https://localhost:3000
  Réseau  : https://192.168.1.42:3000
```

### 4.4 Ouvrir l'application

Va sur **https://localhost:3000**.

> ⚠️ **L'avertissement de certificat est normal.**
> LOBA utilise un certificat **auto-signé**, que le navigateur ne reconnaît pas.
> - **Chrome / Edge** : *Paramètres avancés* → *Continuer vers localhost
>   (dangereux)*.
> - **Firefox** : *Avancé…* → *Accepter le risque et continuer*.
> - **Safari** : *Afficher les détails* → *visiter ce site web*.
>
> Sans cette étape, le navigateur bloquera le micro et la caméra.

Clique sur **Créer un compte** et choisis ton nom, ton identifiant et ton mot
de passe. Le compte est créé immédiatement.

---

## 5. Option B — sans Docker

Cette option utilise :

- **PostgreSQL** installé sur la machine ;
- **s3rver** (inclus dans les dépendances de développement) à la place de
  MinIO.

### 5.1 Installer PostgreSQL

**Ubuntu / Debian**

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

**macOS (Homebrew)**

```bash
brew install postgresql@16
brew services start postgresql@16
```

**Windows**

Télécharge l'installateur sur <https://www.postgresql.org/download/windows/>.
Retiens le mot de passe du superutilisateur `postgres`.

### 5.2 Créer l'utilisateur et la base

Ouvre `psql` en tant que superutilisateur.

Linux :

```bash
sudo -u postgres psql
```

macOS :

```bash
psql postgres
```

Windows (invite de commandes) :

```cmd
psql -U postgres
```

Puis exécute :

```sql
CREATE USER loba WITH PASSWORD 'loba';
CREATE DATABASE loba OWNER loba;
\q
```

Teste la connexion :

```bash
psql "postgres://loba:loba@localhost:5432/loba" -c "SELECT 1;"
```

### 5.3 Installer les dépendances

```bash
npm install
```

### 5.4 Configurer `.env` pour s3rver

Modifie les lignes MinIO :

```dotenv
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=S3RVER
MINIO_SECRET_KEY=S3RVER
MINIO_BUCKET=loba
```

Le reste ne change pas.

### 5.5 Démarrer le stockage S3

Dans un **premier terminal** :

```bash
npm run s3
```

Tu dois voir :

```
Stockage S3 de développement démarré sur le port 9000
Identifiants à mettre dans .env :
  MINIO_ACCESS_KEY=S3RVER
  MINIO_SECRET_KEY=S3RVER
```

Ce serveur est prévu pour le développement. Il stocke les fichiers dans
`.data/s3/`. Pour un vrai déploiement, utilise MinIO ou un service S3.

### 5.6 Lancer LOBA

Dans un **second terminal** :

```bash
npm start
```

Puis ouvre <https://localhost:3000> et crée ton compte.

> **Important :** si tu changes `MINIO_PORT` ou le dossier de données, relance
> **aussi** le serveur LOBA : il crée le bucket au démarrage.

---

## 6. Vérifier que tout fonctionne

### 6.1 Vérification rapide en ligne de commande

```bash
curl -k https://localhost:3000/api/me
```

Réponse attendue : `{"error":"Non connecté"}` avec le code 401. C'est le signe
que le serveur et l'API répondent (tu n'as simplement pas de cookie).

### 6.2 Vérification dans le navigateur

1. La page de connexion s'affiche.
2. La création d'un compte fonctionne.
3. Deux comptes peuvent démarrer une discussion.
4. Un message envoyé apparaît instantanément dans une seconde fenêtre.
5. Un fichier s'envoie et se télécharge.
6. Un appel entre deux fenêtres sonne et fonctionne.

### 6.3 Vérification des services

```bash
docker compose ps          # option A
curl http://localhost:9000 # MinIO (réponse XML) ou s3rver
```

---

## 7. Changer le port

Si le port 3000 est occupé, modifie `.env` :

```dotenv
PORT=4000
```

Puis relance `npm start`. L'adresse devient `https://localhost:4000`.

Sous Linux, pour libérer un port occupé :

```bash
fuser -k 3000/tcp
```

Sous Windows :

```powershell
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

---

## 8. Accéder depuis un téléphone (même Wi-Fi)

1. Démarre LOBA. Le terminal affiche une adresse `https://192.168.x.x:3000`.
2. Autorise le port 3000 dans le pare-feu.

**Ubuntu (ufw)** :

```bash
sudo ufw allow 3000/tcp
```

**Windows** : *Pare-feu Windows Defender* → *Paramètres avancés* → *Règles de
trafic entrant* → *Nouvelle règle* → port 3000.

3. Si tu changes de réseau (autre adresse IP), régénère le certificat pour
   qu'il contienne la nouvelle adresse :

   ```bash
   npm run cert
   ```

   Puis relance `npm start` et accepte le nouvel avertissement sur le téléphone.

4. Ouvre l'adresse sur le téléphone et crée un compte, ou connecte-toi avec un compte différent.

---

## 9. Commandes utiles

| Commande | Effet |
|---|---|
| `npm start` | Démarre le serveur |
| `npm run dev` | Démarre avec rechargement automatique (Node 20+) |
| `npm run cert` | Supprime et régénère le certificat |
| `npm run s3` | Démarre le stockage S3 local (option B) |
| `docker compose up -d` | Démarre PostgreSQL + MinIO |
| `docker compose stop` | Arrête les conteneurs (données conservées) |
| `docker compose down` | Supprime les conteneurs (données conservées) |
| `docker compose down -v` | Supprime **aussi les volumes** (tout est effacé) |

---

## 10. Mettre à jour l'application

```bash
git pull
npm install
npm start
```

Les tables existantes sont conservées. Si le schéma évolue, `db.init()` crée
les nouvelles tables, mais **ne modifie pas** les colonnes existantes : une
migration manuelle peut être nécessaire.

---

## 11. Désinstaller / repartir de zéro

### Garder le code, effacer les données

```bash
docker compose down -v      # supprime PostgreSQL + MinIO
rm -rf .data                # supprime les fichiers s3rver (option B)
rm -f .env
```

Puis reprends à l'étape 3.

### Tout supprimer

```bash
cd ..
rm -rf loba
```

---

## 12. Checklist finale

- [ ] `node -v` affiche 20 ou plus.
- [ ] `.env` existe et contient la bonne `DATABASE_URL`.
- [ ] PostgreSQL répond (`docker compose ps` ou `psql`).
- [ ] MinIO ou s3rver répond sur le port 9000.
- [ ] `npm install` s'est terminé sans erreur.
- [ ] `npm start` affiche « LOBA est démarré ! ».
- [ ] Le certificat est accepté dans le navigateur.
- [ ] La création d'un compte fonctionne.

Si une étape échoue, consulte [05 — Dépannage](05-depannage.md).
