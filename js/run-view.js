// Экран 2 — «Рабочий экран». Отсчёт считается от временных меток (Date.now()), а не
// накоплением "-1 каждую секунду" — поэтому сворачивание вкладки/телефона, слабый JS-поток
// или каст на TV не дают дрейф: при любом тике позиция пересчитывается заново от baseTimestamp.
//
// baseElapsedMs — сколько мс тренировки прошло по состоянию на момент baseTimestamp.
// Пока running=true, реальный прошедший мс = baseElapsedMs + (Date.now() - baseTimestamp).
// На паузе/при джампе baseElapsedMs просто переустанавливается, а baseTimestamp = Date.now().

import {
  buildSequence, locate, remainingFromIndex, cumulativeBefore, jumpTarget,
  fmtClock, PHASE_LABELS, totalDuration,
} from "./timer-engine.js";
import { speakPhrase, countdownTickBeep, vibrate } from "./audio.js";
import { saveRunState, loadRunState, clearRunState } from "./state.js";

const VIBRATE_PATTERNS = {
  prep: [60], work: [80, 60, 80], rest: [200], restSets: [200, 100, 200],
};

const FINISH_DELAY_MS = 2500; // время дать дослушать "Соромадэ" перед авто-возвратом к настройкам

// "Приготовились" и бип-отсчёт подготовки должны звучать за 10 сек до конца подготовки
// (не в самом начале длинной подготовки, где тренирующиеся ещё далеко от начала работы) —
// если сама подготовка короче этого окна, объявляем сразу, откладывать некуда.
const PREP_WARN_LEAD_SEC = 10;

export function initRunView({ onBackToSetup, onFinished }) {
  const runEl = document.getElementById("viewRun");
  const phaseLabelEl = document.getElementById("runPhaseLabel");
  const ringEl = document.getElementById("runRing");
  const timeEl = document.getElementById("runTime");
  const roundInfoEl = document.getElementById("runRoundInfo");
  const dotsEl = document.getElementById("runDots");
  const totalEl = document.getElementById("runTotal");
  const progressFillEl = document.getElementById("runProgressFill");
  const pauseBtn = document.getElementById("pauseBtn");
  const prevBtn = document.getElementById("prevCycleBtn");
  const nextBtn = document.getElementById("nextCycleBtn");
  const backBtn = document.getElementById("backBtn");
  const liveEl = document.getElementById("live");

  let seq = [];
  let currentParams = null;
  let baseTimestamp = 0;
  let baseElapsedMs = 0;
  let running = false;
  let active = false; // есть загруженная сессия (в т.ч. на паузе), не завершена и не сброшена
  let lastAnnouncedIndex = -1;
  let lastBeepSecond = null;
  let prepVoiceFired = false;
  let tickHandle = null;
  let wakeLock = null;

  function computeElapsedMs() {
    return running ? baseElapsedMs + (Date.now() - baseTimestamp) : baseElapsedMs;
  }

  function persist() {
    saveRunState({
      params: currentParams,
      baseTimestamp,
      baseElapsedMs,
      running,
    });
  }

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) { wakeLock = null; }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && running) acquireWakeLock();
  });

  function roundInfoText(phase) {
    if (phase.type === "prep") return "Подготовка";
    if (phase.type === "restSets") {
      return "Отдых между сетами" + (currentParams.sets > 1 ? " · Сет " + phase.set + " из " + currentParams.sets : "");
    }
    let text = "Цикл " + phase.cycle + " из " + currentParams.cycles;
    if (currentParams.sets > 1) text += " · Сет " + phase.set + " из " + currentParams.sets;
    return text;
  }

  // Точки-индикаторы циклов — считываются издалека без чтения текста "Цикл X из Y".
  // При нескольких сетах точки сгруппированы по сетам (с разделителем между группами),
  // чтобы была видна структура всей тренировки, а не только текущего сета.
  // Для фаз вне сетки циклов (подготовка) все точки остаются нейтральными.
  function renderDots(phase) {
    const cycles = currentParams.cycles;
    const sets = currentParams.sets;
    dotsEl.innerHTML = "";
    for (let s = 1; s <= sets; s++) {
      if (s > 1) {
        const sep = document.createElement("span");
        sep.className = "dot-sep";
        dotsEl.appendChild(sep);
      }
      for (let i = 1; i <= cycles; i++) {
        const dot = document.createElement("span");
        dot.className = "dot";
        if (phase.set > s || (phase.set === s && phase.cycle > i)) {
          dot.className += " done";
        } else if (phase.set === s && phase.cycle === i && (phase.type === "work" || phase.type === "rest")) {
          dot.className += " current";
        }
        dotsEl.appendChild(dot);
      }
    }
  }

  function render() {
    const loc = locate(seq, computeElapsedMs() / 1000);
    const wholeTotal = totalDuration(seq);
    if (loc.index >= seq.length) {
      runEl.dataset.phase = "done";
      phaseLabelEl.textContent = "Готово";
      timeEl.textContent = "00:00";
      timeEl.classList.remove("pulse");
      ringEl.style.setProperty("--pct", 100);
      ringEl.classList.remove("pulse-flash");
      progressFillEl.style.width = "100%";
      roundInfoEl.textContent = "Тренировка завершена";
      renderDots({ set: Infinity, cycle: Infinity });
      totalEl.textContent = "Осталось всего: 00:00";
      pauseBtn.disabled = true;
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }
    const phase = seq[loc.index];
    const remaining = phase.duration - loc.elapsedInPhase;
    runEl.dataset.phase = phase.type;
    phaseLabelEl.textContent = PHASE_LABELS[phase.type];
    timeEl.textContent = fmtClock(remaining);
    ringEl.style.setProperty("--pct", (phase.duration ? Math.max(0, Math.min(100, remaining / phase.duration * 100)) : 0).toFixed(2));
    const lastSeconds = remaining > 0 && remaining <= 3;
    timeEl.classList.toggle("pulse", lastSeconds);
    ringEl.classList.toggle("pulse-flash", lastSeconds);
    roundInfoEl.textContent = roundInfoText(phase);
    renderDots(phase);
    const elapsedWhole = cumulativeBefore(seq, loc.index) + loc.elapsedInPhase;
    progressFillEl.style.width = (wholeTotal ? Math.max(0, Math.min(100, elapsedWhole / wholeTotal * 100)) : 0).toFixed(2) + "%";
    totalEl.textContent = "Осталось всего: " + fmtClock(remainingFromIndex(seq, loc.index, loc.elapsedInPhase));
    pauseBtn.disabled = false;
    pauseBtn.textContent = running ? "Пауза" : "Продолжить";
    prevBtn.disabled = jumpTarget(seq, loc.index, -1) === null;
    nextBtn.disabled = jumpTarget(seq, loc.index, 1) === null;
  }

  function announce(index) {
    if (index >= seq.length) {
      speakPhrase("done");
      vibrate([120, 80, 120, 80, 220]);
      liveEl.textContent = "Тренировка завершена";
      return;
    }
    const phase = seq[index];
    vibrate(VIBRATE_PATTERNS[phase.type] || [80]);
    liveEl.textContent = PHASE_LABELS[phase.type];
    // Длинную подготовку не объявляем голосом сразу в начале — откладываем до
    // PREP_WARN_LEAD_SEC до конца (см. tick()), чтобы "Приготовились" не потерялось
    // за много секунд до самой работы. Короткую (короче окна) — объявляем сразу,
    // откладывать всё равно некуда.
    if (phase.type === "prep" && phase.duration >= PREP_WARN_LEAD_SEC) return;
    if (phase.type === "prep") prepVoiceFired = true;
    speakPhrase(phase.type);
  }

  function finish() {
    running = false;
    active = false;
    stopTicking();
    releaseWakeLock();
    clearRunState();
    render();
    setTimeout(() => onFinished(), FINISH_DELAY_MS);
  }

  function tick() {
    const loc = locate(seq, computeElapsedMs() / 1000);
    if (loc.index !== lastAnnouncedIndex) {
      lastAnnouncedIndex = loc.index;
      lastBeepSecond = null;
      prepVoiceFired = false;
      announce(loc.index);
      if (loc.index >= seq.length) {
        finish();
        return;
      }
    }
    const phase = seq[loc.index];
    const remaining = phase.duration - loc.elapsedInPhase;
    const remainingCeil = Math.ceil(remaining);
    // Бип-отсчёт — всегда только последние 3 секунды фазы, независимо от типа.
    // Голосовое предупреждение "Приготовились" для длинной подготовки при этом
    // всё равно звучит заранее (см. PREP_WARN_LEAD_SEC ниже) — это разные вещи.
    const beepLead = 3;
    if (remaining > 0 && remaining <= beepLead && remainingCeil !== lastBeepSecond) {
      lastBeepSecond = remainingCeil;
      countdownTickBeep();
    }
    if (phase.type === "prep" && !prepVoiceFired && remaining <= PREP_WARN_LEAD_SEC) {
      prepVoiceFired = true;
      speakPhrase("prep");
    }
    render();
  }

  function startTicking() {
    stopTicking();
    tickHandle = setInterval(tick, 250);
  }
  function stopTicking() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  function start(params) {
    currentParams = params;
    seq = buildSequence(params);
    baseElapsedMs = 0;
    baseTimestamp = Date.now();
    running = true;
    active = true;
    lastAnnouncedIndex = -1;
    persist();
    acquireWakeLock();
    startTicking();
    tick();
  }

  // Тренер вернулся из настроек (поправил параметры или нет) и жмёт "Продолжить":
  // пересобираем последовательность и встаём на ту же фазу (по типу/циклу/сету), на которой
  // остановились, сохраняя секунды, уже прошедшие внутри неё — это тот же "продолжить с того же
  // места", что и обычная пауза/резюме, просто через экран настроек. lastAnnouncedIndex выставляем
  // на текущий индекс (а не -1), чтобы фраза фазы не звучала заново, если это не новая фаза.
  function continueRun(newParams) {
    const loc = locate(seq, computeElapsedMs() / 1000);
    const oldPhase = loc.index < seq.length ? seq[loc.index] : null;
    const newSeq = buildSequence(newParams);
    let newIndex = 0;
    if (oldPhase) {
      const found = newSeq.findIndex((ph) => ph.type === oldPhase.type && ph.cycle === oldPhase.cycle && ph.set === oldPhase.set);
      if (found >= 0) newIndex = found;
    }
    const elapsedInPhase = oldPhase ? Math.min(loc.elapsedInPhase, newSeq[newIndex] ? newSeq[newIndex].duration : 0) : 0;
    currentParams = newParams;
    seq = newSeq;
    baseElapsedMs = (cumulativeBefore(seq, newIndex) + elapsedInPhase) * 1000;
    baseTimestamp = Date.now();
    running = true;
    active = true;
    lastAnnouncedIndex = newIndex;
    persist();
    acquireWakeLock();
    startTicking();
    tick();
  }

  function pause() {
    baseElapsedMs = computeElapsedMs();
    running = false;
    stopTicking();
    releaseWakeLock();
    persist();
    render();
  }

  function resume() {
    baseTimestamp = Date.now();
    running = true;
    persist();
    acquireWakeLock();
    startTicking();
    tick();
  }

  function jump(direction) {
    const loc = locate(seq, computeElapsedMs() / 1000);
    const target = jumpTarget(seq, loc.index, direction);
    if (target === null) return;
    baseElapsedMs = cumulativeBefore(seq, target) * 1000;
    baseTimestamp = Date.now();
    lastAnnouncedIndex = -1;
    persist();
    tick();
  }

  function tryResumeFromSaved() {
    const saved = loadRunState();
    if (!saved) return false;
    currentParams = saved.params;
    seq = buildSequence(currentParams);
    baseElapsedMs = saved.baseElapsedMs;
    baseTimestamp = saved.baseTimestamp;
    running = saved.running;
    const loc = locate(seq, computeElapsedMs() / 1000);
    if (loc.index >= seq.length) {
      clearRunState();
      return false;
    }
    active = true;
    lastAnnouncedIndex = loc.index; // не переозвучиваем фазу молча при простом перезапуске страницы
    if (running) { acquireWakeLock(); startTicking(); }
    render();
    return true;
  }

  pauseBtn.addEventListener("click", () => (running ? pause() : resume()));
  prevBtn.addEventListener("click", () => jump(-1));
  nextBtn.addEventListener("click", () => jump(1));
  backBtn.addEventListener("click", () => {
    if (running) pause();
    onBackToSetup();
  });

  return {
    start,
    continueRun,
    tryResumeFromSaved,
    hasActiveSession: () => active,
    getActiveParams: () => currentParams,
  };
}
