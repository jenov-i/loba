// ---------------------------------------------------------------------------
// Petit client HTTP pour parler à l'API du serveur.
// ---------------------------------------------------------------------------

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Certaines réponses n'ont pas de JSON (ex: téléchargement de fichier).
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Erreur ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const api = {
  get(url) {
    return request(url);
  },

  post(url, body) {
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  upload(url, formData) {
    return request(url, {
      method: 'POST',
      body: formData,
    });
  },
};
