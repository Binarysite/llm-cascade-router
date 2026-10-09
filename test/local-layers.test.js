import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/index.js';

const FALLBACK = 'A person will reply soon.';

const base = (overrides = {}) => ({
  answers: [
    {
      id: 'shipping-time',
      reply: 'Orders ship in 2 business days.',
      phrases: ['how long does shipping take', 'when will my order ship'],
      avoid: ['damaged'],
    },
    { id: 'waterproof', reply: 'Yes, they are waterproof.', phrases: ['are the stickers waterproof'] },
    { id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] },
  ],
  synonyms: { ship: ['shipping', 'shipped', 'delivery', 'deliver'] },
  stopwords: ['the', 'a', 'do', 'does', 'you', 'my', 'are', 'is', 'will', 'i'],
  fallback: FALLBACK,
  ...overrides,
});

test('layer 1 answers an exact normalized phrase without running layer 2', async () => {
  const router = createRouter(base());
  const r = await router.route('How long does SHIPPING take??');
  assert.equal(r.layer, 'exact');
  assert.equal(r.answerId, 'shipping-time');
  assert.equal(r.reply, 'Orders ship in 2 business days.');
  assert.deepEqual(r.trace.map((s) => s.layer), ['exact']);
  assert.equal(typeof r.latencyMs, 'number');
});

test('layer 2 answers a paraphrase through synonyms and records its score', async () => {
  const router = createRouter(base());
  const r = await router.route('how long is delivery');
  assert.equal(r.layer, 'score');
  assert.equal(r.answerId, 'shipping-time');
  assert.deepEqual(r.trace.map((s) => [s.layer, s.outcome]), [['exact', 'miss'], ['score', 'hit']]);
  assert.ok(r.trace[1].score >= 0.5);
  assert.match(r.reason, /shipping-time .* via "how long does shipping take"/);
});

test('layer 2 tolerates one typo in a long word', async () => {
  const router = createRouter(base());
  assert.equal((await router.route('are stickrs waterprof')).answerId, 'waterproof');
});

test('typo tolerance never applies to words with digits', async () => {
  const router = createRouter({
    answers: [{ id: 'promo', reply: 'Code 20241 gives 10% off.', phrases: ['code 20241'] }],
    score: { minScore: 0.6 },
    fallback: FALLBACK,
  });
  assert.equal((await router.route('code 20241')).layer, 'exact');
  const r = await router.route('code 20242');
  assert.equal(r.layer, 'fallback');
  assert.equal(r.trace[1].score, 0.5);
});

test('typo tolerance can be turned off', async () => {
  const router = createRouter(base({ score: { typoTolerance: false } }));
  assert.equal((await router.route('are stickrs waterprof')).layer, 'fallback');
});

test('a score below minScore is a miss', async () => {
  const router = createRouter(base());
  // shares "ship" and "long" with a phrase, but most of the message is about something else
  const r = await router.route('long weekend ship party ideas with friends');
  assert.equal(r.layer, 'fallback');
  assert.equal(r.trace[1].outcome, 'miss');
  assert.match(r.trace[1].reason, /below minScore 0.5/);
});

test('raising minScore turns a hit into a miss', async () => {
  const loose = createRouter(base({ score: { minScore: 0.3 } }));
  const strict = createRouter(base({ score: { minScore: 0.9 } }));
  assert.equal((await loose.route('how long is delivery')).layer, 'score');
  assert.equal((await strict.route('how long is delivery')).layer, 'fallback');
});

test('two answers that fit equally well are ambiguous, not a coin flip', async () => {
  // With "what" as a stopword both phrases have two content words, so each
  // answer scores 2 * 1 / (2 + 2) = 0.5: a true tie.
  const router = createRouter(base({ stopwords: [...base().stopwords, 'what'] }));
  const r = await router.route('waterproof sizes');
  assert.equal(r.layer, 'fallback');
  assert.match(r.trace[1].reason, /^ambiguous:/);
});

test('a score exactly at minScore and a margin exactly at minMargin both answer', async () => {
  // 0.6 - 0.5 is 0.09999999999999998 in floating point; it must still count as 0.1.
  const router = createRouter({
    answers: [
      { id: 'a', reply: 'A', phrases: ['aaa bbb ccc ddd eee'] },
      { id: 'b', reply: 'B', phrases: ['aaa bbb zzz'] },
    ],
    score: { minScore: 0.6, minMargin: 0.1 },
    fallback: FALLBACK,
  });
  const r = await router.route('aaa bbb ccc qqq rrr');
  assert.equal(r.layer, 'score');
  assert.equal(r.answerId, 'a');
  assert.equal(r.trace[1].score, 0.6);
});

test('a score never exceeds 1 when two phrase words match one message word', async () => {
  const router = createRouter({
    answers: [{ id: 'refund', reply: 'R', phrases: ['refund refunds policy'] }],
    fallback: FALLBACK,
  });
  const r = await router.route('refund');
  assert.equal(r.trace[1].score, 0.5);
});

test('an avoid word keeps an answer out even when the rest matches', async () => {
  const router = createRouter(base());
  const r = await router.route('my delivery took long and arrived damaged');
  assert.equal(r.layer, 'fallback');
  assert.notEqual(r.answerId, 'shipping-time');
});

test('messages longer than maxTokens skip local scoring', async () => {
  const router = createRouter(base({ score: { maxTokens: 3 } }));
  const r = await router.route('how long shipping take for big orders');
  assert.equal(r.trace[1].outcome, 'skipped');
  assert.match(r.trace[1].reason, /above maxTokens 3/);
});

test('a message of only stopwords skips scoring', async () => {
  const r = await createRouter(base()).route('do you?');
  assert.equal(r.trace[1].outcome, 'skipped');
});

test('empty and non-string messages go straight to the fallback', async () => {
  const router = createRouter(base());
  for (const input of ['', '   ', undefined, 42]) {
    const r = await router.route(input);
    assert.equal(r.layer, 'fallback');
    assert.equal(r.reply, FALLBACK);
    assert.deepEqual(r.trace, []);
  }
});

test('a message of only punctuation or emoji misses both local layers', async () => {
  const r = await createRouter(base()).route('?! \u{1F44D}');
  assert.equal(r.layer, 'fallback');
  assert.deepEqual(r.trace.map((s) => s.outcome), ['miss', 'skipped']);
});

test('onResult sees every result and cannot break the turn', async () => {
  const seen = [];
  const router = createRouter(base({
    onResult: (r) => {
      seen.push(r.layer);
      throw new Error('logger down');
    },
  }));
  const r = await router.route('what sizes do you print');
  assert.equal(r.layer, 'exact');
  assert.deepEqual(seen, ['exact']);
});

test('an async onResult that rejects does not become an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const router = createRouter(base({
      onResult: async () => {
        throw new Error('log sink down');
      },
    }));
    const r = await router.route('what sizes do you print');
    assert.equal(r.layer, 'exact');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('null options and a signal that is not an AbortSignal do not break the turn', async () => {
  const classify = async () => ({ choice: 'sizes', confidence: 0.99 });
  const router = createRouter(base({ classifier: { classify } }));
  const withNull = await router.route('what sizes do you print', /** @type {any} */ (null));
  assert.equal(withNull.layer, 'exact');
  const fakeSignal = await router.route('how big can you go', /** @type {any} */ ({ signal: {} }));
  assert.equal(fakeSignal.layer, 'classifier');
  assert.equal(fakeSignal.answerId, 'sizes');
});

test('an already aborted signal returns the fallback without running layers', async () => {
  const r = await createRouter(base()).route('what sizes do you print', { signal: AbortSignal.abort() });
  assert.equal(r.layer, 'fallback');
  assert.equal(r.reason, 'aborted by caller');
});
