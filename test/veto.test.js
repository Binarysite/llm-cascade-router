// An answer's avoid words veto it; they must never hand the win to the runner-up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, validateConfig, RouterConfigError } from '../src/index.js';
import { createStickerShopRouter } from '../examples/sticker-shop/router.js';

const FALLBACK = 'A person will reply soon.';

const twoAnswers = (overrides = {}) => ({
  answers: [
    { id: 'shipping-cost', reply: 'Flat $4.95.', phrases: ['shipping cost'], avoid: ['refund'] },
    { id: 'shipping-speed', reply: 'Two days.', phrases: ['shipping speed'] },
  ],
  synonyms: { ship: ['shipping'] },
  score: { minScore: 0.3 },
  fallback: FALLBACK,
  ...overrides,
});

test('a vetoed top answer is a miss: the runner-up does not win unopposed', async () => {
  // cost 0.8 (vetoed by "refund"), speed 0.4: before the fix speed won at 0.4.
  const r = await createRouter(twoAnswers()).route('shipping cost refund');
  assert.equal(r.layer, 'fallback');
  const step = r.trace[1];
  assert.equal(step.outcome, 'miss');
  assert.match(step.reason, /shipping-cost 0\.8 .*vetoed by avoid word "refund"/);
});

test('a vetoed runner-up still counts for the margin', async () => {
  const config = twoAnswers({
    answers: [
      { id: 'a', reply: 'A', phrases: ['aaa bbb ccc'] },
      { id: 'b', reply: 'B', phrases: ['aaa bbb ddd eee'], avoid: ['zzz'] },
    ],
    synonyms: {},
  });
  // a 0.667, b 0.571 (vetoed by zzz): a still has no 0.1 margin over b.
  const r = await createRouter(config).route('aaa bbb zzz');
  assert.equal(r.layer, 'fallback');
  assert.match(r.trace[1].reason, /^ambiguous:/);
});

test('the score step reports the margin over the runner-up', async () => {
  const r = await createRouter(twoAnswers()).route('shipping cost');
  assert.equal(r.layer, 'exact');
  const s = await createRouter(twoAnswers()).route('what is the shipping cost');
  assert.equal(s.layer, 'score');
  assert.equal(typeof s.trace[1].margin, 'number');
  assert.ok(s.trace[1].margin > 0);
});

test('avoid words match exactly: no typo tolerance unless the answer opts in', async () => {
  const answers = [
    { id: 'time', reply: 'T', phrases: ['shipping time'], avoid: ['change'] },
    { id: 'cost', reply: 'C', phrases: ['shipping cost price'], avoid: ['refund'] },
  ];
  const strict = createRouter({ answers, fallback: FALLBACK, score: { minScore: 0.3 } });
  // "charge" is one edit from "change": it must not veto the shipping-time answer.
  assert.equal((await strict.route('charge shipping time')).answerId, 'time');
  // "refunds" is not "refund".
  assert.equal((await strict.route('refunds shipping cost price')).answerId, 'cost');

  const fuzzy = createRouter({
    answers: answers.map((a) => (a.id === 'cost' ? { ...a, avoidTypos: true } : a)),
    fallback: FALLBACK,
    score: { minScore: 0.3 },
  });
  assert.equal((await fuzzy.route('refunds shipping cost price')).layer, 'fallback');
  assert.equal((await fuzzy.route('charge shipping time')).answerId, 'time', 'only the opted-in answer is fuzzy');
});

test('avoid words still match through synonyms', async () => {
  const router = createRouter({
    answers: [{ id: 'sizes', reply: 'S', phrases: ['sticker sizes'], avoid: ['refund'] }],
    synonyms: { refund: ['refunded', 'reimburse'] },
    fallback: FALLBACK,
    score: { minScore: 0.3 },
  });
  assert.equal((await router.route('reimburse sticker sizes')).layer, 'fallback');
});

test('the classifier choice is vetoed by the same exact rule', async () => {
  const router = createRouter({
    answers: [{ id: 'time', reply: 'T', phrases: ['shipping time'], avoid: ['change'] }],
    classifier: { classify: async () => ({ choice: 'time', confidence: 0.99 }) },
    fallback: FALLBACK,
  });
  assert.equal((await router.route('what do you charge, roughly')).layer, 'classifier');
  assert.equal((await router.route('can I change it')).layer, 'fallback');
});

test('"what do you charge for shipping" gets no fixed answer in the sticker shop', async () => {
  // Before the fix: "charge" was one edit from avoid words "change" (shipping time) and
  // "charged" (shipping cost), both were dropped, and international won alone at 0.5.
  const r = await createStickerShopRouter().route('what do you charge for shipping');
  assert.equal(r.layer, 'llm', `got ${r.layer} ${r.answerId}: ${r.trace.map((s) => s.reason).join(' | ')}`);
});

test('a multi-word avoid entry is rejected at setup instead of vetoing on each word', () => {
  const config = {
    answers: [{ id: 'hours', reply: 'H', phrases: ['what are your hours'], avoid: ['not happy'] }],
    fallback: FALLBACK,
  };
  assert.throws(() => validateConfig(config), (err) => err instanceof RouterConfigError
    && err.problems.some((p) => p.includes('avoid word "not happy" must be a single word')));
});

test('avoidTypos must be a boolean', () => {
  const config = {
    answers: [{ id: 'hours', reply: 'H', phrases: ['what are your hours'], avoid: ['late'], avoidTypos: 'yes' }],
    fallback: FALLBACK,
  };
  assert.throws(() => validateConfig(config), /avoidTypos must be a boolean/);
});

test('a 20,000-word message is skipped by layer 2 without scoring every word', async () => {
  const router = createStickerShopRouter();
  const big = Array.from({ length: 20000 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}xyz`).join(' ');
  const r = await router.route(big);
  const score = r.trace.find((s) => s.layer === 'score');
  assert.equal(score.outcome, 'skipped');
  assert.ok(score.latencyMs < 40, `layer 2 took ${score.latencyMs} ms`);
});
