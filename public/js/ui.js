// ---------------------------------------------------------------------------
// Petites fonctions d'interface réutilisées partout.
// ---------------------------------------------------------------------------

/** Échappe le texte avant de l'insérer dans du HTML (protection XSS). */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** "Awa Diallo" -> "AD" */
export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/** Couleur stable dérivée d'une chaîne (pour les groupes sans couleur). */
export function colorFromString(value) {
  const colors = ['#00a884', '#53bdeb', '#a78bfa', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

/** Renvoie le HTML d'un avatar (initiales + couleur). */
export function avatarHtml(name, color, extraClass = '') {
  const bg = color || colorFromString(name);
  return `<span class="avatar ${extraClass}" style="background:${escapeHtml(
    bg
  )}">${escapeHtml(initials(name))}</span>`;
}

/** 14:05 */
export function formatTime(value) {
  return new Date(value).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Aujourd'hui / Hier / 05/11/2026 */
export function formatDay(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Aujourd'hui";
  if (sameDay(date, yesterday)) return 'Hier';
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Heure courte pour la liste : 14:05, "Hier", "05/11" */
export function formatListTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatTime(value);
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Hier';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

/** 1536 -> "1,5 Ko" */
export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/** 65000 -> "1:05" */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Notification discrète en bas à gauche. */
export function toast(message, type = 'info') {
  const container = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  container.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .25s';
    setTimeout(() => node.remove(), 300);
  }, 3800);
}

export function openModal(id) {
  document.getElementById(id)?.removeAttribute('hidden');
}

export function closeModal(id) {
  document.getElementById(id)?.setAttribute('hidden', '');
}

/** Empêche d'appeler une fonction trop souvent (ex: frappe au clavier). */
export function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Raccourci pour querySelector. */
export const $ = (selector) => document.querySelector(selector);

/** Raccourci pour querySelectorAll (renvoie un vrai tableau). */
export const $$ = (selector) => [...document.querySelectorAll(selector)];
