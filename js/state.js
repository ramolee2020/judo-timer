// Хранилище настроек тренера: последние введённые параметры и сохранённые
// пользовательские заготовки. Живёт в localStorage, переживает перезапуск приложения.

export const DEFAULT_PARAMS = { prep: 10, work: 180, rest: 30, cycles: 5, sets: 1, restSets: 60 };

export const FIELD_MIN = { prep: 0, work: 5, rest: 0, cycles: 1, sets: 1, restSets: 0 };

const STORE_KEY = "judoTimer.v2.store";
const RUN_KEY = "judoTimer.v2.run";

function clampParams(p) {
  const out = {};
  for (const key of Object.keys(DEFAULT_PARAMS)) {
    const raw = Number(p[key]);
    const min = FIELD_MIN[key];
    out[key] = Number.isFinite(raw) ? Math.max(min, Math.round(raw)) : DEFAULT_PARAMS[key];
  }
  return out;
}

export function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { lastParams: { ...DEFAULT_PARAMS }, customPresets: {}, highContrast: false };
    const parsed = JSON.parse(raw);
    const customPresets = {};
    for (const [name, params] of Object.entries(parsed.customPresets || {})) {
      customPresets[name] = clampParams(params);
    }
    return {
      lastParams: clampParams(parsed.lastParams || DEFAULT_PARAMS),
      customPresets,
      highContrast: !!parsed.highContrast,
    };
  } catch (e) {
    return { lastParams: { ...DEFAULT_PARAMS }, customPresets: {}, highContrast: false };
  }
}

export function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    /* localStorage недоступен (приватный режим и т.п.) — просто не сохраняем */
  }
}

export function saveRunState(runState) {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(runState));
  } catch (e) {}
}

export function loadRunState() {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function clearRunState() {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch (e) {}
}

export { clampParams };
