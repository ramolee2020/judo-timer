// Голосовые фразы: приоритет — записанные файлы (голос тренера), fallback — TTS браузера.
// Бипы — не файлы, а короткие тоны через WebAudio (дешевле, чем таскать base64-wav в разметке;
// заодно легко подправить громкость/частоту на этапе "коррекции звука" позже).

const PHRASE_FILES = {
  prep: "assets/audio/prigotovilis-user.oga",
  work: "assets/audio/hajime-user.wav",
  rest: "assets/audio/mate-user.wav",
  restSets: "assets/audio/mate-user.wav",
  done: "assets/audio/soromade-user.oga",
};

const TTS_FALLBACK_TEXT = {
  prep: "Приготовились",
  work: "Хаджимэ",
  rest: "Матэ",
  restSets: "Матэ",
  done: "Соромадэ",
};

const audioElements = {};
function getAudioEl(phase) {
  const src = PHRASE_FILES[phase];
  if (!src) return null;
  if (!audioElements[phase]) {
    const el = new Audio(src);
    el.preload = "auto";
    audioElements[phase] = el;
  }
  return audioElements[phase];
}

let audioCtx = null;
function ensureCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}

function tone(freq, durMs, volume) {
  const ctx = ensureCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain).connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + durMs / 1000);
  osc.start(now);
  osc.stop(now + durMs / 1000);
}

export function countdownTickBeep() {
  tone(880, 90, 0.18);
}

let unlocked = false;
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  ensureCtx();
  Object.keys(PHRASE_FILES).forEach((phase) => {
    const el = getAudioEl(phase);
    if (!el) return;
    const prevVolume = el.volume;
    el.volume = 0;
    const p = el.play();
    if (p && p.then) {
      p.then(() => {
        el.pause();
        el.currentTime = 0;
        el.volume = prevVolume;
      }).catch(() => {
        el.volume = prevVolume;
      });
    }
  });
  if ("speechSynthesis" in window) window.speechSynthesis.resume();
}

function speakFallback(phase) {
  if (!("speechSynthesis" in window)) return;
  const text = TTS_FALLBACK_TEXT[phase];
  if (!text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ru-RU";
  window.speechSynthesis.speak(utter);
}

export function speakPhrase(phase) {
  const el = getAudioEl(phase);
  if (!el) {
    speakFallback(phase);
    return;
  }
  try {
    el.currentTime = 0;
  } catch (e) {}
  const p = el.play();
  if (p && p.catch) p.catch(() => speakFallback(phase));
}

export function vibrate(pattern) {
  if ("vibrate" in navigator) {
    try { navigator.vibrate(pattern); } catch (e) {}
  }
}
