-- ---------------------------------------------------------------------------
-- Schéma de la base de données LOBA
--
-- Ce fichier est exécuté automatiquement au démarrage du serveur
-- (voir src/db.js). Toutes les instructions utilisent "IF NOT EXISTS" :
-- on peut donc le rejouer sans perdre les données existantes.
-- ---------------------------------------------------------------------------

-- Utilisateurs ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,              -- identifiant unique (login)
  display_name  TEXT NOT NULL,                     -- nom affiché dans l'application
  password_hash TEXT NOT NULL,                     -- mot de passe chiffré (bcrypt)
  avatar_color  TEXT NOT NULL DEFAULT '#00a884',   -- couleur de l'avatar
  last_seen     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions ---------------------------------------------------------------
-- Une session = un cookie posé dans le navigateur après connexion.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Conversations ----------------------------------------------------------
-- type = 'direct' : discussion privée entre 2 personnes
-- type = 'group'  : discussion de groupe (nom obligatoire)
CREATE TABLE IF NOT EXISTS conversations (
  id         SERIAL PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  name       TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Membres d'une conversation ---------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at    TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

-- Messages ---------------------------------------------------------------
-- kind = 'text'   : message texte
-- kind = 'file'   : fichier partagé (image, document...)
-- kind = 'voice'  : message vocal enregistré dans le navigateur
-- kind = 'system' : message automatique ("X a créé le groupe")
CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'file', 'voice', 'system')),
  body            TEXT,
  file_key        TEXT,           -- nom de l'objet dans MinIO
  file_name       TEXT,           -- nom d'origine du fichier
  file_mime       TEXT,           -- type MIME (image/png, audio/webm...)
  file_size       BIGINT,         -- taille en octets
  duration_ms     INTEGER,        -- durée d'un message vocal
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Appels (journal) -------------------------------------------------------
CREATE TABLE IF NOT EXISTS calls (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  started_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
  status          TEXT NOT NULL DEFAULT 'ringing'
                  CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'declined')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);

-- Index pour accélérer les requêtes fréquentes ---------------------------
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_conversation ON calls(conversation_id, id DESC);
