import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRouter } from '../src/index.js';

const FALLBACK = 'A person will reply soon.';

/** @param {{ classify?: Function, generate: Function, timeoutMs?: number }} opts */
const routerWith = ({ classify, generate, timeoutMs }) => createRouter({
  answers: [{ id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] }],
  classifier: classify ? { classify } : undefined,
  llm: timeoutMs ? { generate, timeoutMs } : { generate },
  fallback: FALLBACK,
});

test('every layer runs in order, cheapest first, and the LLM answers last', async () => {
  const order = [];
  const router = routerWith({
    classify: async () => { order.push('classifier'); return { choice: null, confidence: 0 }; },
    generate: async () => { order.push('llm'); return 'Order 10482 shipped yesterday.'; },
  });
  const r = await router.route('where is order 10482');
  assert.deepEqual(r.trace.map((s) => s.layer), ['exact', 'score', 'classifier', 'llm']);
  assert.deepEqual(order, ['classifier', 'llm']);
  assert.equal(r.layer, 'llm');
  assert.equal(r.reply, 'Order 10482 shipped yesterday.');
  assert.equal(r.answerId, null);
  assert.equal(r.llmCalled, true);
});

test('the LLM is never called when a cheaper layer answers', async () => {
  let calls = 0;
  const router = routerWith({ generate: async () => { calls += 1; return 'x'; } });
  const r = await router.route('What sizes do you print?');
  assert.equal(r.layer, 'exact');
  assert.equal(r.llmCalled, false);
  assert.equal(calls, 0);
});

test('a classifier that times out still lets the LLM answer', async () => {
  const router = createRouter({
    answers: [{ id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] }],
    classifier: {
      timeoutMs: 15,
      classify: async () => {
        await sleep(300);
        return { choice: 'sizes', confidence: 1 };
      },
    },
    llm: { generate: async () => 'Answered by the model.' },
    fallback: FALLBACK,
  });
  const r = await router.route('can you do holographic');
  assert.equal(r.layer, 'llm');
  assert.deepEqual(r.trace.map((s) => s.outcome), ['miss', 'miss', 'timeout', 'hit']);
});

test('the LLM may return { reply, ... } and the whole object is kept on the result', async () => {
  const output = { reply: 'Sure.', toolCalls: [{ name: 'lookup_order', args: { orderId: '10482' } }] };
  const r = await routerWith({ generate: async () => output }).route('hi there');
  assert.equal(r.reply, 'Sure.');
  assert.deepEqual(r.llmOutput, output);
  assert.equal('output' in r.trace.at(-1), false);
  const plain = await routerWith({ generate: async () => 'Sure.' }).route('hi there');
  assert.equal('llmOutput' in plain, false);
});

test('an LLM that throws gives the fallback, never the error', async () => {
  const router = routerWith({
    generate: async () => { throw Object.assign(new Error('overloaded'), { status: 529 }); },
  });
  const r = await router.route('can you do holographic');
  assert.equal(r.layer, 'fallback');
  assert.equal(r.reply, FALLBACK);
  assert.equal(r.llmCalled, true);
  assert.equal(r.reason, 'llm error: Error: overloaded');
});

test('a slow LLM times out into the fallback and its signal is aborted', async () => {
  let aborted = false;
  const router = routerWith({
    timeoutMs: 20,
    generate: async ({ signal }) => {
      signal.addEventListener('abort', () => { aborted = true; });
      await sleep(500);
      return 'too late';
    },
  });
  const r = await router.route('can you do holographic');
  assert.equal(r.layer, 'fallback');
  assert.match(r.reason, /^llm timeout: .*within 20 ms/);
  assert.ok(aborted);
});

test('an empty LLM reply is not sent to the user', async () => {
  for (const out of ['', '   ', null, { reply: '' }, { text: 'wrong field' }]) {
    const r = await routerWith({ generate: async () => out }).route('can you do holographic');
    assert.equal(r.layer, 'fallback');
    assert.equal(r.reason, 'llm error: llm returned an empty reply');
  }
});

test('a synchronous throw inside generate is caught too', async () => {
  const r = await routerWith({ generate: () => { throw new TypeError('bad'); } }).route('hello');
  assert.equal(r.layer, 'fallback');
});

test('a message of only an emoji skips the local layers and reaches the LLM', async () => {
  const r = await routerWith({ generate: async ({ message }) => `got ${message}` }).route('\u{1F44D}');
  assert.equal(r.layer, 'llm');
  assert.equal(r.reply, 'got \u{1F44D}');
});

test('without an LLM configured, a miss ends in the fallback without calling anything', async () => {
  const router = createRouter({
    answers: [{ id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] }],
    fallback: FALLBACK,
  });
  const r = await router.route('can you do holographic');
  assert.deepEqual([r.layer, r.reason, r.llmCalled], ['fallback', 'no layer answered', false]);
});

test('llm config is validated', () => {
  assert.throws(() => routerWith({ generate: 'nope' }), /llm.generate must be a function/);
  assert.throws(() => routerWith({ generate: async () => 'x', timeoutMs: -1 }), /llm.timeoutMs/);
});
