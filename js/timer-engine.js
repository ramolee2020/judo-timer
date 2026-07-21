// Чистая математика тайминга: строит плоскую последовательность фаз из параметров
// и умеет по прошедшему времени (мс) от начала тренировки находить текущую фазу.
// Никакого состояния не хранит — вызывающий код (run-view) держит только
// { baseTimestamp, baseElapsedMs, running } и на каждый тик пересчитывает позицию заново.
// Это даёт точность без дрейфа: неважно, сколько реального времени прошло
// между тиками (фон, слабое устройство) — позиция всегда считается от времени, а не суммированием.

export const PHASE_LABELS = {
  prep: "Подготовка",
  work: "Работа",
  rest: "Отдых",
  restSets: "Отдых между сетами",
  cooldown: "Заминка",
  done: "Готово",
};

export function buildSequence(p) {
  const seq = [];
  if (p.prep > 0) seq.push({ type: "prep", duration: p.prep, set: 1, cycle: 1 });
  for (let s = 1; s <= p.sets; s++) {
    for (let c = 1; c <= p.cycles; c++) {
      seq.push({ type: "work", duration: p.work, set: s, cycle: c });
      if (c < p.cycles && p.rest > 0) {
        seq.push({ type: "rest", duration: p.rest, set: s, cycle: c });
      }
    }
    if (s < p.sets && p.restSets > 0) {
      seq.push({ type: "restSets", duration: p.restSets, set: s, cycle: p.cycles });
    }
  }
  if (p.cooldown > 0) seq.push({ type: "cooldown", duration: p.cooldown, set: p.sets, cycle: p.cycles });
  return seq;
}

export function totalDuration(seq) {
  return seq.reduce((sum, ph) => sum + ph.duration, 0);
}

// Сумма длительностей фаз с индекса 0 до index (не включая index) — момент старта фазы index.
export function cumulativeBefore(seq, index) {
  let sum = 0;
  for (let i = 0; i < index && i < seq.length; i++) sum += seq[i].duration;
  return sum;
}

// По прошедшему времени (сек) от начала тренировки находит { index, elapsedInPhase }.
// index === seq.length означает, что тренировка полностью завершена.
export function locate(seq, elapsedSec) {
  let acc = 0;
  for (let i = 0; i < seq.length; i++) {
    const dur = seq[i].duration;
    if (elapsedSec < acc + dur) {
      return { index: i, elapsedInPhase: elapsedSec - acc };
    }
    acc += dur;
  }
  return { index: seq.length, elapsedInPhase: 0 };
}

export function remainingFromIndex(seq, index, elapsedInPhase) {
  if (index >= seq.length) return 0;
  let total = Math.max(0, seq[index].duration - elapsedInPhase);
  for (let i = index + 1; i < seq.length; i++) total += seq[i].duration;
  return total;
}

function workPhaseIndices(seq) {
  const arr = [];
  seq.forEach((ph, i) => { if (ph.type === "work") arr.push(i); });
  return arr;
}

// Индекс фазы-работы соседнего цикла (direction: -1 назад, +1 вперёд), либо null если некуда.
export function jumpTarget(seq, currentIndex, direction) {
  const workIdx = workPhaseIndices(seq);
  if (workIdx.length === 0) return null;
  let pos = -1;
  for (let i = 0; i < workIdx.length; i++) {
    if (workIdx[i] <= currentIndex) pos = i;
  }
  const targetPos = pos + direction;
  if (targetPos < 0 || targetPos >= workIdx.length) return null;
  return workIdx[targetPos];
}

export function fmtClock(totalSec) {
  const sec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
