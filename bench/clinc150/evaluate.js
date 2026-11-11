// Shared evaluation for the CLINC150 benches: one decision per message (a fixed
// answer id, or 'llm') scored against the labels.
import { wilson95 } from '../../src/eval.js';

/**
 * @param {ReadonlyArray<{ expect: string }>} examples
 * @param {ReadonlyArray<string>} decisions an answer id or 'llm' per example, same order
 */
export function score(examples, decisions) {
  let answered = 0;
  let right = 0;
  let wrongIntent = 0;
  let wrongMustEscalate = 0;
  let answerable = 0;
  examples.forEach((ex, i) => {
    if (ex.expect !== 'llm') answerable += 1;
    const d = decisions[i];
    if (d === 'llm') return;
    answered += 1;
    if (d === ex.expect) right += 1;
    else if (ex.expect === 'llm') wrongMustEscalate += 1;
    else wrongIntent += 1;
  });
  const n = examples.length;
  const wrong = wrongIntent + wrongMustEscalate;
  const r3 = (/** @type {number} */ x) => Number(x.toFixed(3));
  return {
    n,
    answerable,
    answered,
    right,
    wrong,
    wrongIntent,
    wrongMustEscalate,
    escalatedAnswerable: answerable - right - wrongIntent,
    toLlm: n - answered,
    shareAnsweredWithoutLlm: r3(answered / n),
    coverageOfAnswerable: r3(right / answerable),
    precision: answered ? r3(right / answered) : null,
    precisionInterval95: wilson95(right, answered).map(r3),
    wrongPer1000Turns: Number(((1000 * wrong) / n).toFixed(2)),
    escalationRate: r3((n - answered) / n),
  };
}

/** Selection rule, fixed before any validation run: the most answers with precision >= MIN_PRECISION. */
export const MIN_PRECISION = 0.98;

/**
 * Pick a grid point on validation results. Ties go to the stricter point, which
 * comes later in the grid. When no point reaches MIN_PRECISION, the most precise wins.
 * @template T
 * @param {Array<{ point: T, result: ReturnType<typeof score> }>} grid ordered from loose to strict
 */
export function choose(grid) {
  const ok = grid.filter((g) => g.result.answered > 0 && (g.result.precision ?? 0) >= MIN_PRECISION);
  const pool = ok.length ? ok : grid.filter((g) => g.result.answered > 0);
  const key = (/** @type {typeof grid[number]} */ g) => (ok.length ? g.result.answered : (g.result.precision ?? 0));
  let best = pool[0];
  for (const g of pool) if (key(g) >= key(best)) best = g;
  return { ...best, rule: ok.length ? `most answers with precision >= ${MIN_PRECISION}` : 'highest precision' };
}

/** Thresholds from 0.30 to 1.00 in steps of 0.05. */
export const THRESHOLDS = Array.from({ length: 15 }, (_, i) => Number((0.3 + 0.05 * i).toFixed(2)));
export const MARGINS = [0, 0.05, 0.1, 0.15, 0.2, 0.3];
