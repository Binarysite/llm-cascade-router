import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRouter, RouterConfigError } from '../src/index.js';

const FALLBACK = 'A person will reply soon.';

/** @param {any} classifier */
const routerWith = (classifier) => createRouter({
  answers: [
    { id: 'refund-policy', reply: 'Misprints are reprinted free.', phrases: ['what is your refund policy'] },
    { id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'], description: 'sticker sizes' },
  ],
  stopwords: ['what', 'is', 'your', 'do', 'you'],
  classifier,
  fallback: FALLBACK,
});

const fixed = (choice, confidence) => async () => ({ choice, confidence });

test('the classifier only runs after both local layers miss', async () => {
  let calls = 0;
  const router = routerWith({ classify: async () => { calls += 1; return { choice: 'sizes', confidence: 0.99 }; } });
  assert.equal((await router.route('what sizes do you print')).layer, 'exact');
  assert.equal(calls, 0);
  const r = await router.route('can I get one as big as a laptop lid');
  assert.equal(r.layer, 'classifier');
  assert.equal(r.answerId, 'sizes');
  assert.equal(calls, 1);
  assert.deepEqual(r.trace.map((s) => s.layer), ['exact', 'score', 'classifier']);
});

test('the classifier receives the message, the choices and an abort signal', async () => {
  let seen;
  const router = routerWith({ classify: async (input) => { seen = input; return { choice: null, confidence: 0 }; } });
  await router.route('hello there', { context: { channel: 'web' } });
  assert.equal(seen.message, 'hello there');
  assert.deepEqual(seen.context, { channel: 'web' });
  assert.deepEqual(seen.choices, [
    { id: 'refund-policy', description: 'what is your refund policy' },
    { id: 'sizes', description: 'sticker sizes' },
  ]);
  assert.ok(seen.signal instanceof AbortSignal);
});

test('a confidence at minConfidence answers, just below it does not', async () => {
  const at = await routerWith({ classify: fixed('sizes', 0.7), minConfidence: 0.7 }).route('laptop lid size');
  assert.equal(at.layer, 'classifier');
  assert.equal(at.trace.at(-1).confidence, 0.7);

  const below = await routerWith({ classify: fixed('sizes', 0.69), minConfidence: 0.7 }).route('laptop lid size');
  assert.equal(below.layer, 'fallback');
  assert.match(below.trace.at(-1).reason, /sizes at 0.69, below minConfidence 0.7/);
});

test('a slow classifier times out, its signal is aborted, and the turn still ends', async () => {
  let aborted = false;
  const router = routerWith({
    timeoutMs: 20,
    classify: async ({ signal }) => {
      signal.addEventListener('abort', () => { aborted = true; });
      await sleep(500);
      return { choice: 'sizes', confidence: 1 };
    },
  });
  const t0 = performance.now();
  const r = await router.route('laptop lid size');
  // The classifier sleeps 500 ms; anything clearly below that proves the turn
  // did not wait for it, with room for a slow CI runner.
  assert.ok(performance.now() - t0 < 450, 'did not wait for the slow classifier');
  assert.equal(r.layer, 'fallback');
  assert.equal(r.trace.at(-1).outcome, 'timeout');
  assert.match(r.trace.at(-1).reason, /within 20 ms/);
  assert.ok(aborted);
});

test('a classifier that throws is recorded as an error and skipped', async () => {
  const r = await routerWith({ classify: async () => { throw new Error('quota exceeded'); } }).route('laptop lid size');
  assert.equal(r.layer, 'fallback');
  assert.deepEqual(r.trace.at(-1), {
    layer: 'classifier', outcome: 'error', reason: 'Error: quota exceeded', latencyMs: r.trace.at(-1).latencyMs,
  });
});

test('abstaining, unknown ids and malformed output are not answers', async () => {
  const cases = [
    [fixed(null, 0.9), 'miss', /abstained/],
    [fixed('gift-cards', 0.95), 'miss', /unknown choice "gift-cards"/],
    [fixed('sizes', 1.4), 'error', /between 0 and 1/],
    [fixed('sizes', Number.NaN), 'error', /between 0 and 1/],
    [async () => 'sizes', 'error', /must return/],
    [async () => [], 'error', /must return/],
    [fixed({}, 0.9), 'error', /choice must be an answer id or null, got object/],
    [fixed(7, 0.9), 'error', /got number/],
  ];
  for (const [classify, outcome, reason] of cases) {
    const r = await routerWith({ classify }).route('laptop lid size');
    assert.equal(r.layer, 'fallback');
    assert.equal(r.trace.at(-1).outcome, outcome);
    assert.match(r.trace.at(-1).reason, reason);
  }
});

test('the caller aborting mid-classifier ends the turn with the fallback', async () => {
  const controller = new AbortController();
  const slow = async () => {
    await sleep(200);
    return { choice: 'sizes', confidence: 1 };
  };
  const router = routerWith({ timeoutMs: 1000, classify: slow });
  setTimeout(() => controller.abort(), 10);
  const r = await router.route('laptop lid size', { signal: controller.signal });
  assert.equal(r.reason, 'aborted by caller');
  assert.equal(r.trace.at(-1).outcome, 'aborted');
});

test('classifier config is validated', () => {
  assert.throws(() => routerWith({}), RouterConfigError);
  assert.throws(() => routerWith({ classify: fixed('x', 1), minConfidence: -0.1 }), /minConfidence/);
  assert.throws(() => routerWith({ classify: fixed('x', 1), timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => routerWith({ classify: fixed('x', 1), model: 'x' }), /unknown key "model"/);
});

test('an avoid word vetoes the classifier choice, not only the local score', async () => {
  const router = createRouter({
    answers: [
      { id: 'file-formats', reply: 'PNG, PDF or SVG.', phrases: ['what file formats do you accept'], avoid: ['wrong'] },
    ],
    classifier: { classify: fixed('file-formats', 0.99) },
    fallback: FALLBACK,
  });
  const r = await router.route('I uploaded the wrong file, can I swap it?');
  assert.equal(r.layer, 'fallback');
  assert.match(r.trace.at(-1).reason, /file-formats vetoed by avoid word "wrong"/);
});

test('usage from the classifier is copied to its trace step; without one the step has no usage key', async () => {
  const usage = { input_tokens: 120, output_tokens: 9 };
  const vetoRouter = createRouter({
    answers: [{ id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'], avoid: ['refund'] }],
    classifier: { classify: async () => ({ choice: 'sizes', confidence: 0.99, usage }) },
    fallback: FALLBACK,
  });
  const vetoed = await vetoRouter.route('refund for a laptop lid size');
  assert.equal(vetoed.trace.at(-1).outcome, 'miss');
  assert.deepEqual(vetoed.trace.at(-1).usage, usage);

  const abstained = await routerWith({ classify: async () => ({ choice: null, confidence: 0, usage }) })
    .route('laptop lid size');
  assert.deepEqual(abstained.trace.at(-1).usage, usage);

  const plain = await routerWith({ classify: fixed('sizes', 0.99) }).route('laptop lid size');
  assert.equal(plain.layer, 'classifier');
  assert.ok(!('usage' in plain.trace.at(-1)));
});
