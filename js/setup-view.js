// Экран 1 — «Программирование»: поля параметров (степперы + прямой ввод цифр) и список
// сохранённых тренировок тренера. Ничего не знает про сам отсчёт — только собирает params
// и передаёт их наверх через app.startTraining().

import { FIELD_MIN, clampParams } from "./state.js";
import { totalDuration, buildSequence, fmtClock } from "./timer-engine.js";

const FIELDS = [
  { key: "prep", label: "Подготовка, сек" },
  { key: "work", label: "Работа, сек" },
  { key: "rest", label: "Отдых, сек" },
  { key: "cycles", label: "Циклы" },
  { key: "sets", label: "Сеты" },
  { key: "restSets", label: "Отдых между сетами, сек" },
];

// Шаг +/- всегда 1 (точная подстройка) — при удержании кнопки повтор разгоняется по трём
// ступеням, чтобы быстро долистать и до больших значений, не требуя отдельного "крупного шага".
const HOLD_START_MS = 400;
const HOLD_FAST_MS = 1200;
const HOLD_FASTEST_MS = 2600;

// Простые монолинейные SVG-иконки для каждого поля — свои, без внешних шрифтов/иконок
// (офлайн-PWA не может подгружать иконки из сети).
const ICONS = {
  prep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12M6 22h12M6 2c0 6 5 6.5 6 10-1 3.5-6 4-6 10M18 2c0 6-5 6.5-6 10 1 3.5 6 4 6 10"/></svg>',
  work: '<svg viewBox="0 0 24 24"><rect fill="currentColor" x="1.5" y="7.8" width="9.3" height="2.6" rx="1.3"/><rect fill="currentColor" x="13.2" y="7.8" width="9.3" height="2.6" rx="1.3"/><rect fill="currentColor" x="9.6" y="7.3" width="4.8" height="4" rx="1.6"/><path fill="currentColor" d="M10.2 10.7 12 10.7 10.7 19.8 8.9 19.3Z"/><path fill="currentColor" d="M13.8 10.7 12 10.7 13.3 19.8 15.1 19.3Z"/></svg>',
  rest: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  cycles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 14-5.3L21 9"/><path d="M21 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L3 15"/><path d="M3 20v-5h5"/></svg>',
  sets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  restSets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3v2M12 3v2"/></svg>',
};

export function initSetupView(app) {
  const fieldsList = document.getElementById("fieldsList");
  const summaryLine = document.getElementById("summaryLine");
  const timelineEl = document.getElementById("timeline");
  const startBtn = document.getElementById("startBtn");
  const savePresetBtn = document.getElementById("savePresetBtn");
  const toggleSavedBtn = document.getElementById("toggleSavedBtn");
  const savedList = document.getElementById("savedList");
  const continuePausedBtn = document.getElementById("continuePausedBtn");
  const setupHint = document.getElementById("setupHint");
  const contrastToggle = document.getElementById("contrastToggle");

  let params = { ...app.store.lastParams };
  let savedListOpen = false;
  const fieldValueEls = {};

  function renderSavedList() {
    const names = Object.keys(app.store.customPresets);
    toggleSavedBtn.textContent = "Сохранённые тренировки" + (names.length ? " (" + names.length + ")" : "");
    savedList.innerHTML = "";
    if (!names.length) {
      const empty = document.createElement("p");
      empty.className = "saved-empty";
      empty.textContent = "Пока нет сохранённых тренировок.";
      savedList.appendChild(empty);
      return;
    }
    names.forEach((name) => {
      const row = document.createElement("div");
      row.className = "saved-item";

      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "saved-item-name";
      nameBtn.textContent = name;
      nameBtn.addEventListener("click", () => {
        params = clampParams(app.store.customPresets[name]);
        renderFields();
        renderSummary();
        savedListOpen = false;
        renderSavedListVisibility();
      });
      row.appendChild(nameBtn);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "saved-item-delete";
      del.textContent = "×";
      del.title = "Удалить тренировку";
      del.setAttribute("aria-label", "Удалить «" + name + "»");
      del.addEventListener("click", () => {
        delete app.store.customPresets[name];
        app.persistStore();
        renderSavedList();
      });
      row.appendChild(del);

      savedList.appendChild(row);
    });
  }

  function renderSavedListVisibility() {
    savedList.hidden = !savedListOpen;
    toggleSavedBtn.setAttribute("aria-expanded", String(savedListOpen));
  }

  // Тап — мгновенный шаг ±1. Удержание — автоповтор, который разгоняется по трём ступеням
  // (HOLD_START_MS/HOLD_FAST_MS/HOLD_FASTEST_MS), не меняя сам шаг: так можно и точно
  // подстроить на 1, и быстро долистать до большого значения без отдельной "крупной" кнопки.
  function attachHold(button, key, dir) {
    let intervalId = null;
    const timers = [];

    function clearAll() {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      timers.forEach(clearTimeout);
      timers.length = 0;
    }

    function repeatAt(ms) {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => adjust(key, dir), ms);
    }

    button.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      adjust(key, dir);
      timers.push(setTimeout(() => repeatAt(180), HOLD_START_MS));
      timers.push(setTimeout(() => repeatAt(70), HOLD_FAST_MS));
      timers.push(setTimeout(() => repeatAt(30), HOLD_FASTEST_MS));
    });
    button.addEventListener("pointerup", clearAll);
    button.addEventListener("pointerleave", clearAll);
    button.addEventListener("pointercancel", clearAll);
  }

  function renderFields() {
    fieldsList.innerHTML = "";
    FIELDS.forEach(({ key, label }) => {
      const row = document.createElement("div");
      row.className = "field-row";

      const iconEl = document.createElement("span");
      iconEl.className = "field-icon";
      iconEl.setAttribute("aria-hidden", "true");
      iconEl.innerHTML = ICONS[key] || "";
      row.appendChild(iconEl);

      const body = document.createElement("div");
      body.className = "field-body";

      const labelEl = document.createElement("span");
      labelEl.className = "field-label";
      labelEl.textContent = label;
      body.appendChild(labelEl);

      const stepper = document.createElement("div");
      stepper.className = "stepper";

      const minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "–";
      minus.setAttribute("aria-label", "Меньше: " + label);
      attachHold(minus, key, -1);
      stepper.appendChild(minus);

      const valueBtn = document.createElement("button");
      valueBtn.type = "button";
      valueBtn.className = "field-value";
      valueBtn.textContent = String(params[key]);
      valueBtn.title = "Нажмите, чтобы ввести точное число";
      valueBtn.addEventListener("click", () => enterEditMode(key, valueBtn, stepper));
      stepper.appendChild(valueBtn);
      fieldValueEls[key] = valueBtn;

      const plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "Больше: " + label);
      attachHold(plus, key, 1);
      stepper.appendChild(plus);

      body.appendChild(stepper);
      row.appendChild(body);
      fieldsList.appendChild(row);
    });
  }

  function enterEditMode(key, valueBtn, stepper) {
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "numeric";
    input.className = "field-value-input";
    input.value = String(params[key]);
    input.min = String(FIELD_MIN[key]);
    stepper.replaceChild(input, valueBtn);
    input.focus();
    input.select();

    function commit() {
      const raw = Number(input.value);
      params[key] = Number.isFinite(raw) ? Math.max(FIELD_MIN[key], Math.round(raw)) : params[key];
      renderFields();
      renderSummary();
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
  }

  function adjust(key, delta) {
    params[key] = Math.max(FIELD_MIN[key], params[key] + delta);
    const el = fieldValueEls[key];
    if (el) el.textContent = String(params[key]);
    renderSummary();
  }

  function renderSummary() {
    const seq = buildSequence(params);
    const total = totalDuration(seq);
    const cycleCount = params.sets * params.cycles;
    summaryLine.innerHTML =
      "<b>" + fmtClock(total) + "</b> · " + cycleCount + " " + pluralCycles(cycleCount) +
      (params.sets > 1 ? " · " + params.sets + " сет." : "");
    renderTimeline(seq);
  }

  // Форма тренировки одним взглядом до старта: сегменты пропорциональны длительности
  // фаз (flex-grow = duration в секундах), цвет как на рабочем экране.
  function renderTimeline(seq) {
    timelineEl.innerHTML = "";
    seq.forEach((phase) => {
      if (!phase.duration) return;
      const seg = document.createElement("span");
      seg.className = "seg seg-" + phase.type;
      seg.style.flex = phase.duration + " 0 0";
      timelineEl.appendChild(seg);
    });
  }

  function pluralCycles(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "цикл";
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "цикла";
    return "циклов";
  }

  function applyContrast() {
    document.body.dataset.contrast = app.store.highContrast ? "high" : "normal";
    contrastToggle.textContent = "Зальный режим: " + (app.store.highContrast ? "вкл" : "выкл");
    contrastToggle.classList.toggle("active", !!app.store.highContrast);
  }

  contrastToggle.addEventListener("click", () => {
    app.store.highContrast = !app.store.highContrast;
    app.persistStore();
    applyContrast();
  });

  toggleSavedBtn.addEventListener("click", () => {
    savedListOpen = !savedListOpen;
    renderSavedListVisibility();
  });

  savePresetBtn.addEventListener("click", () => {
    const name = window.prompt("Название тренировки:");
    if (!name) return;
    app.store.customPresets[name] = clampParams(params);
    app.persistStore();
    renderSavedList();
  });

  // "Старт" всегда начинает новую тренировку с текущими настройками — даже если есть
  // тренировка на паузе, она в этом случае просто перезаписывается. Продолжить старую
  // (если она вдруг нужна) — отдельная мелкая ссылка ниже, а не то, что происходит по умолчанию.
  startBtn.addEventListener("click", () => {
    app.startTraining({ ...params });
  });

  continuePausedBtn.addEventListener("click", () => {
    app.continueRun({ ...params });
  });

  function refreshRunControls() {
    const hasPaused = app.hasPausedRun();
    startBtn.textContent = "Старт";
    continuePausedBtn.hidden = !hasPaused;
    setupHint.textContent = hasPaused
      ? "Есть тренировка на паузе. «Старт» начнёт новую с текущими настройками — чтобы вернуться к прежней, используйте «Продолжить предыдущую тренировку» ниже."
      : "";
  }

  function onShow() {
    if (app.hasPausedRun()) {
      params = clampParams(app.getActiveParams());
      renderFields();
      renderSummary();
    }
    refreshRunControls();
  }

  renderSavedList();
  renderSavedListVisibility();
  renderFields();
  renderSummary();
  refreshRunControls();
  applyContrast();

  return {
    getParams: () => ({ ...params }),
    onShow,
  };
}
