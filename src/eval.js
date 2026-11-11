// Measure a router against labelled messages: which layer answered, how often a
// fixed answer was wrong, what the classifier cost. Published as
// "llm-cascade-router/eval"; the bench, the CLI and the examples use it.

const LAYERS = /** @type {const} */ (['exact', 'score', 'classifier', 'llm', 'fallback']);
const CHEAP = new Set(['exact', 'score', 'classifier']);
const Z95 = 1.959963984540054;

/**
 * A mock LLM that counts its calls, so a bench runs offline and deterministic.
 * @returns {import('../index.js').Generate & { calls: () => number }}
 */
export function createMockLlm() {
  let calls = 0;
  /** @param {{ message: string }} input */
  const generate = async ({ message }) => {
    calls += 1;
    return `[model reply to: ${message}]`;
  };
  return Object.assign(generate, { calls: () => calls });
}

/**
 * 95% Wilson score interval for k successes out of n, as [low, high].
 * @param {number} k
 * @param {number} n
 * @returns {[number, number]}
 */
export function wilson95(k, n) {
  if (!(n >= 0) || !(k >= 0) || k > n) throw new RangeError(`wilson95 needs 0 <= k <= n, got k=${k}, n=${n}`);
  if (!n) return [0, 1]; // no trials: the proportion can be anything
  const p = k / n;
  const d = 1 + (Z95 * Z95) / n;
  const center = (p + (Z95 * Z95) / (2 * n)) / d;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + (Z95 * Z95) / (4 * n * n))) / d;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/**
 * Two-sided exact McNemar test on paired outcomes: b pairs where only the first
 * system succeeded, c where only the second did. Returns the p-value.
 * Up to 1000 pairs the terms are summed directly (exact for small counts); above
 * that in log space, because 0.5 ** n underflows to 0 from n = 1075.
 * @param {number} b
 * @param {number} c
 * @throws {RangeError} unless both are non-negative integers
 */
export function mcnemarExact(b, c) {
  if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || c < 0) {
    throw new RangeError(`mcnemarExact needs two non-negative integer counts, got ${b} and ${c}`);
  }
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  if (n <= 1000) {
    let tail = 0;
    let term = 0.5 ** n; // C(n, 0) / 2^n
    for (let i = 0; i <= k; i += 1) {
      tail += term;
      term = (term * (n - i)) / (i + 1);
    }
    return Math.min(1, 2 * tail);
  }
  // log of the largest tail term, C(n, k) / 2^n
  let logTop = -n * Math.LN2;
  for (let i = 0; i < k; i += 1) logTop += Math.log(n - i) - Math.log(i + 1);
  // the tail sum relative to that term, walking down: C(n, i - 1) = C(n, i) * i / (n - i + 1)
  let rel = 1;
  let sum = 1;
  for (let i = k; i > 0; i -= 1) {
    rel = (rel * i) / (n - i + 1);
    sum += rel;
  }
  return Math.min(1, Math.exp(Math.LN2 + logTop + Math.log(sum)));
}

/**
 * Nearest-rank percentiles of a latency sample. p95 is null under 20 samples,
 * where it would just be the maximum.
 * @param {ReadonlyArray<number>} samples milliseconds
 * @returns {{ n: number, p50: number | null, p95: number | null, max: number | null }}
 */
export function latencySummary(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const at = (/** @type {number} */ p) => Math.round(s[Math.max(0, Math.ceil(p * s.length) - 1)] * 10) / 10;
  if (!s.length) return { n: 0, p50: null, p95: null, max: null };
  return { n: s.length, p50: at(0.5), p95: s.length >= 20 ? at(0.95) : null, max: at(1) };
}

/** @param {[number, number]} pair */
const round3 = (pair) => /** @type {[number, number]} */ (pair.map((x) => Number(x.toFixed(3))));

/**
 * @typedef {object} Row
 * @property {string} text
 * @property {string} expect  an answer id, or 'llm'
 * @property {string} layer
 * @property {string | null} answerId
 * @property {'right' | 'wrong' | 'escalated'} verdict
 * @property {string} reason
 * @property {number | null} classifierMs time spent in layer 3 on this turn, null if it did not run
 */

/**
 * Route every labelled message through a fresh router, so call counts belong to this bank.
 * @param {ReadonlyArray<{ text: string, expect: string }>} bank `expect` is an answer id or 'llm'
 * @param {{
 *   build: (slots: { classify?: import('../index.js').Classify, generate: import('../index.js').Generate }) => {
 *     route: (message: string) => Promise<import('../index.js').RouteResult>,
 *   },
 *   classify?: import('../index.js').Classify | null,
 * }} options `build` makes the router from the slots; `classify`, when given, goes in layer 3 and is counted
 */
export async function measure(bank, { build, classify = null }) {
  if (typeof build !== 'function') {
    throw new TypeError('measure: pass build, a function ({ classify, generate }) => router');
  }
  const llm = createMockLlm();
  let classifierCalls = 0;
  let unknownChoices = 0;
  /** @type {import('../index.js').Classify | null} */
  const counted = classify && (async (input) => {
    classifierCalls += 1;
    const out = await classify(input);
    const choice = /** @type {{ choice?: unknown } | null} */ (out)?.choice;
    if (typeof choice === 'string' && !input.choices.some((c) => c.id === choice)) unknownChoices += 1;
    return out;
  });
  const router = build(counted ? { classify: counted, generate: llm } : { generate: llm });

  /** @type {Row[]} */
  const rows = [];
  for (const { text, expect } of bank) {
    const r = await router.route(text);
    /** @type {Row['verdict']} */
    let verdict;
    if (CHEAP.has(r.layer)) verdict = r.answerId === expect ? 'right' : 'wrong';
    else verdict = expect === 'llm' ? 'right' : 'escalated';
    const step = r.trace.find((s) => s.layer === 'classifier');
    const classifierMs = step?.latencyMs ?? null;
    rows.push({ text, expect, layer: r.layer, answerId: r.answerId, verdict, reason: r.reason, classifierMs });
  }

  const byLayer = /** @type {Record<typeof LAYERS[number], import('../eval.js').LayerCounts>} */ (
    Object.fromEntries(LAYERS.map((layer) => {
    const mine = rows.filter((r) => r.layer === layer);
    return [layer, {
      turns: mine.length,
      right: mine.filter((r) => r.verdict === 'right').length,
      wrong: mine.filter((r) => r.verdict === 'wrong').length,
      escalated: mine.filter((r) => r.verdict === 'escalated').length,
    }];
  })));
  const fixed = rows.filter((r) => CHEAP.has(r.layer));
  const fixedRight = fixed.filter((r) => r.verdict === 'right').length;
  const classifierRight = byLayer.classifier.right;
  const answeredWithoutMainLlm = fixed.length;
  return {
    total: rows.length,
    withFixedAnswer: rows.filter((r) => r.expect !== 'llm').length,
    llmCalls: llm.calls(),
    classifierConfigured: Boolean(counted),
    classifierCalls,
    classifierAnswers: byLayer.classifier.turns,
    classifierRight,
    classifierWrong: byLayer.classifier.wrong,
    unknownChoices,
    // Each right classifier answer saves one main-LLM call; a wrong one saves it too, but at a cost not priced here.
    breakEven: classifierCalls ? Number((classifierRight / classifierCalls).toFixed(3)) : 0,
    answeredWithoutMainLlm,
    interval95: round3(wilson95(answeredWithoutMainLlm, rows.length)),
    fixedAnswers: {
      given: fixed.length,
      right: fixedRight,
      wrong: fixed.length - fixedRight,
      precision: fixed.length ? Number((fixedRight / fixed.length).toFixed(3)) : null,
      interval95: round3(wilson95(fixedRight, fixed.length)),
    },
    escalatedLatencyMs: latencySummary(rows
      .filter((r) => !CHEAP.has(r.layer) && r.classifierMs !== null)
      .map((r) => /** @type {number} */ (r.classifierMs))),
    byLayer,
    wrong: rows.filter((r) => r.verdict === 'wrong'),
    escalated: rows.filter((r) => r.verdict === 'escalated'),
    rows,
  };
}

/**
 * The same table for every bank, as lines of text.
 * @param {Awaited<ReturnType<typeof measure>>} report
 * @param {{ verbose?: boolean, noun?: string, classifierNote?: string }} [options] `verbose` adds one
 *   line per message before the table; `noun` names the messages in the first line
 */
export function format(report, { verbose = false, noun = 'labelled messages', classifierNote = '' } = {}) {
  const { total, withFixedAnswer: fixable, byLayer, fixedAnswers } = report;
  const pct = (/** @type {number} */ n, /** @type {number} */ of = total) => `${(of ? (100 * n) / of : 0).toFixed(1)}%`;
  const range = (/** @type {[number, number]} */ [lo, hi]) => `${(100 * lo).toFixed(1)}% to ${(100 * hi).toFixed(1)}%`;
  /** @type {string[]} */
  const out = [];
  if (verbose) {
    for (const r of report.rows) {
      const mark = { right: 'ok   ', wrong: 'WRONG', escalated: 'esc  ' }[r.verdict];
      out.push(`${mark} ${r.layer.padEnd(10)} ${String(r.answerId ?? '-').padEnd(14)} ${r.text}`);
      if (r.verdict !== 'right') out.push(`      expected ${r.expect}; ${r.reason}`);
    }
    out.push('');
  }
  out.push(`${total} ${noun}, ${fixable} with a fixed answer and ${total - fixable} that need the model`);
  out.push('');
  out.push('layer       turns  share   right  wrong  escalated');
  for (const layer of LAYERS) {
    const s = byLayer[layer];
    const cheap = CHEAP.has(layer);
    out.push([
      layer.padEnd(10),
      String(s.turns).padStart(6),
      pct(s.turns).padStart(7),
      String(s.right).padStart(7),
      (cheap ? String(s.wrong) : '-').padStart(6),
      (cheap ? '-' : String(s.escalated)).padStart(10),
    ].join(' '));
  }
  out.push('');
  out.push(`wrong fixed answers: ${fixedAnswers.wrong} of ${fixedAnswers.given} given`);
  if (fixedAnswers.given) {
    out.push(`  precision ${pct(fixedAnswers.right, fixedAnswers.given)}, 95% interval (Wilson) ${
      range(fixedAnswers.interval95)}`);
  }
  for (const r of report.wrong) out.push(`  WRONG ${r.layer}: "${r.text}" -> ${r.answerId}, expected ${r.expect}`);
  out.push(`answered without the main LLM: ${report.answeredWithoutMainLlm}/${total} (${
    pct(report.answeredWithoutMainLlm)}), 95% interval (Wilson) ${range(report.interval95)}`);
  out.push(`  ceiling: ${fixable}/${total} (${pct(fixable)}), the messages that have a fixed answer`);
  out.push(`fixed-answer questions that still reached the LLM: ${report.escalated.length}`);
  out.push(`LLM calls: ${report.llmCalls}, against ${total} if every message went to the model`);
  if (!report.classifierConfigured) {
    out.push('classifier: not configured');
  } else {
    const note = classifierNote ? ` (${classifierNote})` : '';
    out.push(`classifier: ${report.classifierCalls} calls, ${report.classifierAnswers} answers, `
      + `${report.classifierRight} right, ${report.classifierWrong} wrong${note}`);
    if (report.unknownChoices) out.push(`  unknown choices (an id that is not an answer): ${report.unknownChoices}`);
    out.push(`  break-even: ${report.classifierRight} right / ${report.classifierCalls} calls = `
      + `${report.breakEven.toFixed(2)} of a main LLM call`);
    out.push('  (a model classifier saves money only if one call costs less than that; wrong answers cost extra)');
  }
  return out;
}
