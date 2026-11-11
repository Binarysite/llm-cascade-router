// Property tests: random inputs from a seeded generator, so a failure is reproducible.
// Set PROPERTY_SEED to try other seeds; the failing seed is printed in the message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, normalize, RouterConfigError } from '../src/index.js';

const SEED = Number(process.env.PROPERTY_SEED ?? 20261111);
const RUNS = 300;

/** mulberry32: a small, fast, seeded PRNG. @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** @param {number} n */
  const int = (n) => Math.floor(next() * n);
  /** @template T @param {readonly T[]} list @returns {T} */
  const pick = (list) => list[int(list.length)];
  /** @template T @param {readonly T[]} list @returns {T[]} */
  const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return { next, int, pick, shuffle };
}

const CHARS = [
  'a', 'b', 'e', 'z', 'A', 'Z', '0', '7', ' ', ' ', '  ', '\t', '\n', '?', '!', '.', ',', "'", '’', '`', '-',
  'é', 'É', 'ñ', 'ü', 'ß', 'ẞ', 'İ', 'ı', '́', '̈', 'Ａ',
  'ﬁ', '①', '½', 'Σ', 'ς', 'Ж', 'क', 'ि', '中', '\u{1f44d}', '‍',
];
const WORDS = ['ship', 'shipping', 'cost', 'price', 'time', 'sticker', 'stickers', 'size', 'sizes', 'big', 'water',
  'proof', 'file', 'upload', 'order', 'minimum', 'contact', 'hours', 'fast', 'free', 'canada', 'outside', 'png'];
const AVOID = ['damaged', 'refund', 'late', 'lost', 'cancel', 'wrong', 'twice', 'broken'];
const STOP = ['the', 'a', 'do', 'you', 'is', 'my', 'how', 'what'];

/** @param {ReturnType<typeof rng>} r */
const randomText = (r) => Array.from({ length: r.int(30) }, () => r.pick(CHARS)).join('');
/** @param {ReturnType<typeof rng>} r @param {number} max */
const words = (r, max) => Array.from({ length: 1 + r.int(max) }, () => r.pick([...WORDS, ...STOP])).join(' ');

/** A random valid config, or null when the generator made one that setup rejects. @param {ReturnType<typeof rng>} r */
function randomConfig(r) {
  const n = 2 + r.int(4);
  const answers = Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    reply: `reply ${i}`,
    phrases: Array.from({ length: 1 + r.int(3) }, () => words(r, 5)),
    avoid: r.shuffle(AVOID).slice(0, r.int(3)),
  }));
  const config = {
    answers,
    synonyms: r.next() < 0.5 ? { ship: ['shipping'], sticker: ['stickers'] } : {},
    stopwords: r.next() < 0.7 ? STOP : [],
    score: {
      minScore: r.pick([0, 0.2, 0.5, 0.8, 1]),
      minMargin: r.pick([0, 0.05, 0.1, 0.3]),
      maxTokens: 1 + r.int(12),
      typoTolerance: r.next() < 0.5,
    },
    fallback: 'fallback',
  };
  try {
    createRouter(config);
    return config;
  } catch (err) {
    if (err instanceof RouterConfigError) return null; // e.g. the same phrase on two answers
    throw err;
  }
}

test('normalize is idempotent and returns a string for any input', () => {
  const r = rng(SEED);
  for (let i = 0; i < RUNS * 5; i += 1) {
    const s = randomText(r);
    const once = normalize(s);
    assert.equal(normalize(once), once, `seed ${SEED}, input ${JSON.stringify(s)}`);
  }
  for (const v of [undefined, null, 42, {}, [], Symbol('x')]) assert.equal(normalize(v), '');
});

test('layer 2 scores and margins stay in 0..1 and do not depend on word order', async () => {
  const r = rng(SEED + 1);
  let checked = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const config = randomConfig(r);
    if (!config) continue;
    const router = createRouter(config);
    const message = words(r, 8);
    const a = (await router.route(message)).trace.find((s) => s.layer === 'score');
    const shuffled = r.shuffle(message.split(' ')).join(' ');
    const b = (await router.route(shuffled)).trace.find((s) => s.layer === 'score');
    if (!a || a.outcome === 'skipped') continue;
    checked += 1;
    const where = `seed ${SEED + 1}, run ${i}, "${message}"`;
    assert.ok(a.score >= 0 && a.score <= 1, `score ${a.score}, ${where}`);
    if (a.margin !== undefined) assert.ok(a.margin >= 0 && a.margin <= 1, `margin ${a.margin}, ${where}`);
    assert.equal(b?.score, a.score, where);
    assert.equal(b?.margin, a.margin, where);
    assert.equal(b?.answerId, a.answerId, where);
  }
  assert.ok(checked > RUNS / 3, `only ${checked} runs reached layer 2`);
});

test('a layer 2 hit does not depend on the order of the answers', async () => {
  const r = rng(SEED + 2);
  for (let i = 0; i < RUNS; i += 1) {
    const config = randomConfig(r);
    if (!config || config.score.minMargin === 0) continue; // with no margin a tie is broken by order
    const message = words(r, 6);
    const a = await createRouter(config).route(message);
    const b = await createRouter({ ...config, answers: r.shuffle(config.answers) }).route(message);
    assert.equal(b.answerId, a.answerId, `seed ${SEED + 2}, run ${i}, "${message}"`);
  }
});

test('route never rejects, whatever the message, the injected functions and the options', async () => {
  const r = rng(SEED + 3);
  const behaviours = [
    () => async () => ({ choice: 'a0', confidence: 0.99 }),
    () => async () => { throw new Error('down'); },
    () => async () => { throw null; },
    () => () => 'not an object',
    () => async () => ({ choice: 42, confidence: 'high' }),
    () => async () => ({ choice: 'a1', confidence: Number.NaN }),
    () => async () => ({ choice: 'nope', confidence: 2 }),
    () => () => { throw new Error('sync throw'); },
    () => () => new Promise(() => {}), // never settles: the timeout must end it
  ];
  const generators = [
    () => async () => 'model reply',
    () => async () => ({ reply: '' }),
    () => async () => { throw new Error('llm down'); },
    () => async () => null,
    () => () => new Promise(() => {}),
  ];
  const messages = [undefined, null, 42, {}, '', '   ', '\u{1f44d}'];
  for (let i = 0; i < RUNS; i += 1) {
    const config = randomConfig(r);
    if (!config) continue;
    const router = createRouter({
      ...config,
      classifier: r.next() < 0.8 ? { classify: r.pick(behaviours)(), timeoutMs: 5 } : null,
      llm: r.next() < 0.8 ? { generate: r.pick(generators)(), timeoutMs: 5 } : null,
      onResult: r.next() < 0.3 ? () => { throw new Error('logger'); } : null,
    });
    const message = r.next() < 0.2 ? r.pick(messages) : (r.next() < 0.5 ? randomText(r) : words(r, 15));
    const options = r.pick([undefined, null, {}, { signal: {} }, { signal: AbortSignal.abort() },
      { signal: AbortSignal.timeout(1) }, { context: { anything: true } }]);
    const result = await router.route(message, /** @type {any} */ (options));
    assert.equal(typeof result.reply, 'string', `seed ${SEED + 3}, run ${i}`);
    assert.ok(Array.isArray(result.trace));
  }
});

test('an answer whose avoid word is in the message never wins, in any layer', async () => {
  const r = rng(SEED + 4);
  let checked = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const config = randomConfig(r);
    if (!config) continue;
    const target = r.pick(config.answers);
    if (target.avoid.length === 0) continue;
    // The classifier always proposes the vetoed answer, at full confidence.
    const router = createRouter({
      ...config,
      classifier: { classify: async () => ({ choice: target.id, confidence: 1 }) },
    });
    const parts = r.pick(target.phrases).split(' ');
    parts.splice(r.int(parts.length + 1), 0, r.pick(target.avoid));
    const message = parts.join(' ');
    const result = await router.route(message);
    checked += 1;
    assert.notEqual(result.answerId, target.id, `seed ${SEED + 4}, run ${i}, "${message}" via ${result.layer}`);
  }
  assert.ok(checked > RUNS / 3, `only ${checked} runs had an avoid word`);
});

test('avoid words only remove layer 2 answers: a hit is also the hit without any avoid words', async () => {
  // In 0.1.x a vetoed best answer was dropped and the runner-up won unopposed; this fails there.
  const r = rng(SEED + 5);
  let hits = 0;
  for (let i = 0; i < RUNS * 2; i += 1) {
    const config = randomConfig(r);
    if (!config) continue;
    const withAvoid = createRouter(config);
    const without = createRouter({ ...config, answers: config.answers.map(({ avoid, ...a }) => a) });
    const target = r.pick(config.answers);
    const vetoed = r.pick(config.answers);
    const parts = r.pick(target.phrases).split(' ');
    if (vetoed.avoid.length) parts.push(r.pick(vetoed.avoid));
    const message = parts.join(' ');
    const a = await withAvoid.route(message);
    if (a.layer !== 'score') continue;
    hits += 1;
    const b = await without.route(message);
    assert.equal(b.answerId, a.answerId, `seed ${SEED + 5}, run ${i}, "${message}"`);
  }
  assert.ok(hits > 10, `only ${hits} layer 2 hits`);
});
