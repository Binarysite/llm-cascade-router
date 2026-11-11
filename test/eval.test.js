// The evaluation helpers in src/eval.js ("llm-cascade-router/eval").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/index.js';
import { measure, format, wilson95, mcnemarExact, latencySummary, createMockLlm } from '../src/eval.js';

const answers = [
  { id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] },
  { id: 'hours', reply: '9 to 5.', phrases: ['what are your hours'] },
];
/** @param {any} slots */
const build = (slots) => createRouter({
  answers,
  ...(slots.classify ? { classifier: { classify: slots.classify, minConfidence: 0.5 } } : {}),
  llm: { generate: slots.generate },
  fallback: 'f',
});

test('measure needs a build function: the library has no default router', async () => {
  await assert.rejects(measure([], /** @type {any} */ ({})), /pass build/);
});

test('break-even counts only right classifier answers; wrong ones and unknown ids are counted apart', async () => {
  const replies = { 'how big': 'sizes', 'when open': 'sizes', 'what time': 'made-up-id', 'cancel it': null };
  const classify = async ({ message }) => ({ choice: replies[message], confidence: 0.9 });
  const report = await measure([
    { text: 'how big', expect: 'sizes' },
    { text: 'when open', expect: 'hours' },
    { text: 'what time', expect: 'hours' },
    { text: 'cancel it', expect: 'llm' },
  ], { build, classify });
  assert.equal(report.classifierCalls, 4);
  assert.equal(report.classifierAnswers, 2);
  assert.equal(report.classifierRight, 1);
  assert.equal(report.classifierWrong, 1);
  assert.equal(report.unknownChoices, 1);
  assert.equal(report.breakEven, 0.25, 'right / calls, not answers / calls');
  assert.deepEqual(report.fixedAnswers, { given: 2, right: 1, wrong: 1, precision: 0.5, interval95: [0.095, 0.905] });
  assert.equal(report.escalatedLatencyMs.n, 2, 'classifier time on the two turns that reached the LLM');
  const lines = format(report, { classifierNote: 'stub' });
  assert.ok(lines.includes('classifier: 4 calls, 2 answers, 1 right, 1 wrong (stub)'));
  assert.ok(lines.includes('  unknown choices (an id that is not an answer): 1'));
  assert.ok(lines.includes('  break-even: 1 right / 4 calls = 0.25 of a main LLM call'));
  assert.ok(lines.includes('wrong fixed answers: 1 of 2 given'));
  assert.ok(lines.includes('  precision 50.0%, 95% interval (Wilson) 9.5% to 90.5%'));
});

test('without a classifier the report says so and has no precision line when nothing was answered', async () => {
  const report = await measure([{ text: 'cancel my order', expect: 'llm' }], { build });
  assert.equal(report.classifierConfigured, false);
  assert.equal(report.fixedAnswers.precision, null);
  const lines = format(report, { verbose: true });
  assert.equal(lines[0], 'ok    llm        -              cancel my order');
  assert.ok(lines.includes('classifier: not configured'));
  assert.ok(!lines.some((l) => l.includes('precision')));
});

test('mcnemarExact gives the two-sided exact p-value', () => {
  assert.equal(mcnemarExact(4, 0), 0.125);
  assert.equal(mcnemarExact(0, 4), 0.125);
  assert.equal(mcnemarExact(3, 0), 0.25);
  assert.equal(mcnemarExact(0, 0), 1);
  assert.equal(mcnemarExact(5, 5), 1);
  assert.ok(Math.abs(mcnemarExact(10, 2) - 0.03857421875) < 1e-12);
});

/** Two-sided exact McNemar p from BigInt binomial sums: 2 * sum_{i<=min} C(n, i) / 2^n, capped at 1. */
function referenceMcnemar(b, c) {
  const n = BigInt(b + c);
  let coef = 1n;
  let tail = 0n;
  for (let i = 0n; i <= BigInt(Math.min(b, c)); i += 1n) {
    tail += coef;
    coef = (coef * (n - i)) / (i + 1n);
  }
  const num = 2n * tail;
  const den = 1n << n;
  if (num >= den) return 1;
  // 64 fractional bits of the exact ratio; plenty for p-values that are not astronomically small.
  return Number((num << 64n) / den) / 2 ** 64;
}

test('mcnemarExact does not underflow with many discordant pairs', () => {
  assert.equal(mcnemarExact(600, 600), 1);
  assert.equal(mcnemarExact(538, 538), 1);
  assert.equal(mcnemarExact(500, 500), 1);
  for (const [b, c] of [[1100, 1000], [1000, 1100], [600, 520], [520, 480], [4000, 3800], [12, 3]]) {
    const want = referenceMcnemar(b, c);
    const got = mcnemarExact(b, c);
    assert.ok(want > 0 && want < 1, `reference in (0, 1) for ${b}, ${c}: ${want}`);
    assert.ok(Math.abs(got - want) / want < 1e-9, `${b}, ${c}: got ${got}, want ${want}`);
  }
});

test('latencySummary gives nearest-rank p50 and max, and p95 only from 20 samples', () => {
  assert.deepEqual(latencySummary([]), { n: 0, p50: null, p95: null, max: null });
  assert.deepEqual(latencySummary([30, 10, 20]), { n: 3, p50: 20, p95: null, max: 30 });
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.deepEqual(latencySummary(twenty), { n: 20, p50: 10, p95: 19, max: 20 });
});

test('wilson95 edge cases: no trials is the whole range, impossible counts throw', () => {
  assert.deepEqual(wilson95(0, 0), [0, 1]);
  assert.throws(() => wilson95(5, 4), RangeError);
  assert.throws(() => wilson95(-1, 4), RangeError);
  assert.throws(() => wilson95(1, -1), RangeError);
});

test('wilson95 and the mock LLM', async () => {
  const [lo, hi] = wilson95(31, 31);
  assert.ok(lo > 0.88 && lo < 0.9 && hi === 1);
  const llm = createMockLlm();
  assert.equal(await llm({ message: 'hi', signal: AbortSignal.timeout(1000) }), '[model reply to: hi]');
  assert.equal(llm.calls(), 1);
});

test('mcnemarExact rejects counts that are not non-negative integers', () => {
  for (const [b, c] of [[-1, 2], [1, -2], [1.5, 2], [2, 0.5], [NaN, 1], [1, NaN], [Infinity, 1], [1, undefined]]) {
    assert.throws(() => mcnemarExact(b, /** @type {number} */ (c)), RangeError, `${b}, ${c}`);
  }
});
