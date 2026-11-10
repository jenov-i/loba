// ---------------------------------------------------------------------------
// Messages sonores (sonnerie d'appel entrant + tonalité d'appel sortant).
//
// Aucun fichier MP3 n'est nécessaire : on génère les sons avec l'API Web Audio
// du navigateur. C'est ce qu'on appelle un "ringtone" synthétique.
// ---------------------------------------------------------------------------

let audioContext = null;
let ringtoneTimer = null;
let ringbackTimer = null;

function getContext() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

/**
 * Un navigateur bloque le son tant que l'utilisateur n'a pas cliqué.
 * On appelle donc cette fonction lors de la connexion pour "déverrouiller"
 * l'audio.
 */
export function unlockAudio() {
  try {
    getContext();
  } catch {
    // Pas grave : le son sera déverrouillé au premier clic.
  }
}

/** Joue deux fréquences pendant "duration" secondes. */
function tone(frequencies, duration = 0.4, volume = 0.06) {
  const ctx = getContext();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.03);
  gain.gain.setValueAtTime(volume, now + duration - 0.08);
  gain.gain.linearRampToValueAtTime(0, now + duration);
  gain.connect(ctx.destination);

  for (const frequency of frequencies) {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}

/** Sonnerie d'un appel entrant : "drriing" toutes les 2,5 secondes. */
export function startRingtone() {
  stopSounds();
  const ring = () => {
    tone([660, 880], 0.35, 0.07);
    setTimeout(() => tone([660, 880], 0.35, 0.07), 450);
  };
  ring();
  ringtoneTimer = setInterval(ring, 2500);
  if (navigator.vibrate) navigator.vibrate([300, 200, 300, 800]);
}

/** Tonalité d'appel sortant : "bip... bip..." toutes les 3 secondes. */
export function startRingback() {
  stopSounds();
  const beep = () => tone([440], 0.9, 0.035);
  beep();
  ringbackTimer = setInterval(beep, 3000);
}

export function stopSounds() {
  clearInterval(ringtoneTimer);
  clearInterval(ringbackTimer);
  ringtoneTimer = null;
  ringbackTimer = null;
  if (navigator.vibrate) navigator.vibrate(0);
}
