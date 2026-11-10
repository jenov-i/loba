#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Crée quelques comptes de démonstration et une discussion de groupe.
//
//   npm run seed
//
// Tous les comptes utilisent le mot de passe : loba1234
// ---------------------------------------------------------------------------
const db = require('../src/db');
const auth = require('../src/auth');

const DEMO_PASSWORD = 'loba1234';

const users = [
  { username: 'alice', displayName: 'Alice Mbaïkoua', color: '#00a884' },
  { username: 'bob', displayName: 'Bob Nguema', color: '#53bdeb' },
  { username: 'carol', displayName: 'Carol Kouassi', color: '#a78bfa' },
];

async function main() {
  await db.init();
  const passwordHash = await auth.hashPassword(DEMO_PASSWORD);
  const ids = {};

  for (const user of users) {
    const row = await db.one(
      `INSERT INTO users (username, display_name, password_hash, avatar_color)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE
         SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [user.username, user.displayName, passwordHash, user.color]
    );
    ids[user.username] = row.id;
    console.log(`Utilisateur prêt : ${user.username} (id ${row.id})`);
  }

  // Discussion privée Alice <-> Bob
  const existing = await db.one(
    `SELECT c.id FROM conversations c
     JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $1
     JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $2
     WHERE c.type = 'direct'`,
    [ids.alice, ids.bob]
  );

  if (!existing) {
    const direct = await db.one(
      `INSERT INTO conversations (type, created_by) VALUES ('direct', $1) RETURNING id`,
      [ids.alice]
    );
    await db.query(
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
       VALUES ($1, $2, now()), ($1, $3, now())`,
      [direct.id, ids.alice, ids.bob]
    );
    await db.query(
      `INSERT INTO messages (conversation_id, sender_id, kind, body)
       VALUES ($1, $2, 'text', $3)`,
      [direct.id, ids.alice, 'Salut Bob ! Bienvenue sur LOBA 👋']
    );
    console.log('Discussion privée Alice ↔ Bob créée');
  }

  // Groupe WebRTC
  let group = await db.one(
    `SELECT id FROM conversations WHERE type = 'group' AND name = 'Projet WebRTC'`
  );

  if (!group) {
    group = await db.one(
      `INSERT INTO conversations (type, name, created_by) VALUES ('group', 'Projet WebRTC', $1) RETURNING id`,
      [ids.alice]
    );
    await db.query(
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
       SELECT $1, unnest($2::int[]), now()`,
      [group.id, [ids.alice, ids.bob, ids.carol]]
    );
    await db.query(
      `INSERT INTO messages (conversation_id, sender_id, kind, body)
       VALUES ($1, $2, 'system', 'Alice Mbaïkoua a créé le groupe « Projet WebRTC »')`,
      [group.id, ids.alice]
    );
    await db.query(
      `INSERT INTO messages (conversation_id, sender_id, kind, body)
       VALUES ($1, $2, 'text', 'On teste les appels vidéo ce soir ? 📹')`,
      [group.id, ids.alice]
    );
    console.log('Groupe « Projet WebRTC » créé');
  }

  console.log(`\nComptes de démo prêts. Mot de passe : ${DEMO_PASSWORD}`);
  await db.pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
