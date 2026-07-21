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

// Записи с телефона тренера — тихие. Обычный volume у <audio> может только приглушать
// (максимум 1 = "как записано"), поэтому громкость реально поднимаем через Web Audio
// (GainNode > 1), а следом ставим компрессор — иначе усиленные пики просто хрипят/клипуют
// на слабом динамике телефона.
const VOICE_GAIN = 3;
const BEEP_VOLUME = 0.65; // раньше 0.18 — почти в 4 раза громче

const audioElements = {};
const mediaSources = {};

function wireGain(phase, el) {
  const ctx = ensureCtx();
  if (!ctx || mediaSources[phase]) return;
  try {
    const source = ctx.createMediaElementSource(el);
    const gainNode = ctx.createGain();
    gainNode.gain.value = VOICE_GAIN;
    source.connect(gainNode).connect(compressor);
    mediaSources[phase] = { source, gainNode };
  } catch (e) {
    // если узел уже создавался раньше для этого элемента — просто играем без усиления
  }
}

function getAudioEl(phase) {
  const src = PHRASE_FILES[phase];
  if (!src) return null;
  if (!audioElements[phase]) {
    const el = new Audio(src);
    el.preload = "auto";
    audioElements[phase] = el;
    wireGain(phase, el);
  }
  return audioElements[phase];
}

let audioCtx = null;
let compressor = null;
function ensureCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
      compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 6;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      compressor.connect(audioCtx.destination);
    }
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
  osc.connect(gain).connect(compressor);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + durMs / 1000);
  osc.start(now);
  osc.stop(now + durMs / 1000);
}

export function countdownTickBeep() {
  tone(880, 90, BEEP_VOLUME);
}

// На самом первом запуске приложения (холодный кэш, файлы ещё не скачаны) разблокировка
// каждого аудио-элемента может занять заметное время — если реальная фраза (например,
// "Приготовились" в начале подготовки) звучит раньше, чем долетит эта разблокировка,
// браузер её тихо блокирует. unlockAudio() поэтому возвращает промис, который вызывающий
// код (app.js) ждёт перед стартом отсчёта — с таймаутом на случай, если play() никогда не
// разрешится (не должны блокировать старт тренировки бесконечно).
let unlockPromise = null;
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

export function unlockAudio() {
  if (unlockPromise) return unlockPromise;
  const ctx = ensureCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  const tasks = Object.keys(PHRASE_FILES).map((phase) => {
    const el = getAudioEl(phase);
    if (!el) return Promise.resolve();
    const prevVolume = el.volume;
    el.volume = 0;
    const p = el.play();
    if (p && p.then) {
      return p.then(() => {
        el.pause();
        el.currentTime = 0;
        el.volume = prevVolume;
      }).catch(() => {
        el.volume = prevVolume;
      });
    }
    return Promise.resolve();
  });
  if ("speechSynthesis" in window) window.speechSynthesis.resume();
  unlockPromise = withTimeout(Promise.all(tasks), 1200);
  return unlockPromise;
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
