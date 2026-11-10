// ---------------------------------------------------------------------------
// Petites fonctions de mise en forme des données avant envoi au navigateur.
// On évite ainsi d'envoyer le hash du mot de passe ou des colonnes inutiles.
// ---------------------------------------------------------------------------

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    lastSeen: row.last_seen,
  };
}

function publicMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.body,
    file: row.file_key
      ? {
          name: row.file_name,
          mime: row.file_mime,
          size: Number(row.file_size || 0),
          durationMs: row.duration_ms || null,
          url: `/api/files/${row.id}`,
        }
      : null,
    createdAt: row.created_at,
    sender: row.sender_display_name
      ? {
          id: row.sender_id,
          displayName: row.sender_display_name,
          avatarColor: row.sender_avatar_color,
        }
      : null,
  };
}

module.exports = { publicUser, publicMessage };
