// Config and input edge cases: timeouts Node would clamp, error text copied into
// the trace, frozen results, a "__proto__" synonym group, and adapter history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, validateConfig } from '../src/index.js';
import { createClaudeLlm } from '../src/adapters/claude.js';

const FALLBACK = 'A person will reply soon.';
const answers = [{ id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] }];

test('a timeout above the setTimeout limit is rejected instead of firing after 1 ms', () => {
  const classify = async () => ({ choice: null, confidence: 0 });
  const generate = async () => 'x';
  assert.throws(() => validateConfig({ answers, fallback: FALLBACK, classifier: { classify, timeoutMs: 3e9 } }),
    /classifier.timeoutMs must be a positive integer \(ms\) up to 2147483647/);
  assert.throws(() => validateConfig({ answers, fallback: FALLBACK, llm: { generate, timeoutMs: 2 ** 31 } }),
    /llm.timeoutMs/);
  assert.doesNotThrow(() => validateConfig({ answers, fallback: FALLBACK, llm: { generate, timeoutMs: 2 ** 31 - 1 } }));
});

test('an injected function\'s error reaches the trace with its name and at most 200 characters', async () => {
  const long = `upstream said: ${'x'.repeat(5000)}`;
  const router = createRouter({
    answers,
    classifier: { classify: async () => { throw new TypeError(long); } },
    llm: { generate: async () => { throw 'a plain string thrown, '.repeat(50); } },
    fallback: FALLBACK,
  });
  const r = await router.route('hello there');
  const classifier = r.trace.find((s) => s.layer === 'classifier');
  assert.equal(classifier.outcome, 'error');
  assert.match(classifier.reason, /^TypeError: upstream said: x+\.\.\.$/);
  assert.ok(classifier.reason.length <= 'TypeError: '.length + 203, `${classifier.reason.length} chars`);
  const llm = r.trace.find((s) => s.layer === 'llm');
  assert.ok(llm.reason.length <= 203);
  assert.ok(r.reason.length < 230);
});

test('an unknown classifier choice is shown in the trace cut to 60 characters', async () => {
  const router = createRouter({
    answers,
    classifier: { classify: async () => ({ choice: 'z'.repeat(500), confidence: 1 }) },
    fallback: FALLBACK,
  });
  const step = (await router.route('hello there')).trace.at(-1);
  assert.equal(step.reason, `unknown choice "${'z'.repeat(60)}..."`);
});

test('validateConfig freezes the answers array and every answer, as documented', () => {
  const cfg = validateConfig({ answers, fallback: FALLBACK });
  assert.ok(Object.isFrozen(cfg));
  assert.ok(Object.isFrozen(cfg.answers));
  assert.ok(Object.isFrozen(cfg.answers[0]));
  assert.ok(Object.isFrozen(cfg.answers[0].phrases));
  assert.ok(Object.isFrozen(cfg.synonyms));
});

test('mutating the input config after createRouter does not change the router', async () => {
  const input = [{ id: 'hello', reply: 'Hi!', phrases: ['hello world'] }];
  const router = createRouter({ answers: input, fallback: FALLBACK });
  input[0].reply = 'MUTATED';
  input[0].phrases.push('see you later');
  assert.equal((await router.route('hello world')).reply, 'Hi!');
  assert.equal((await router.route('see you later')).layer, 'fallback');
});

test('a "__proto__" synonym group from JSON is kept as an ordinary group', async () => {
  const raw = JSON.parse('{"answers":[{"id":"a","reply":"A","phrases":["proto time"]}],'
    + '"synonyms":{"__proto__":["prototype"]},"fallback":"f","score":{"minScore":0.5}}');
  const cfg = validateConfig(raw);
  assert.deepEqual(Object.keys(cfg.synonyms), ['__proto__']);
  assert.deepEqual(cfg.synonyms.__proto__, ['prototype']);
  const r = await createRouter(raw).route('prototype time');
  assert.equal(r.layer, 'score');
  assert.equal(r.answerId, 'a');
});

test('createClaudeLlm sends earlier turns from context.messages and drops malformed ones', async () => {
  const bodies = [];
  /** @type {any} */
  const f = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const data = { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' };
    return { ok: true, status: 200, json: async () => data };
  };
  const generate = createClaudeLlm({ apiKey: 'k', model: 'm', fetch: f });
  await generate({
    message: 'and to canada?',
    context: { messages: [
      { role: 'user', content: 'do you ship to mexico?' },
      { role: 'assistant', content: 'Not yet.' },
      { role: 'system', content: 'ignored: not a turn' },
      { role: 'user', content: 42 },
      null,
    ] },
  });
  await generate({ message: 'hi', context: 'not an object' });
  assert.deepEqual(bodies[0].messages, [
    { role: 'user', content: 'do you ship to mexico?' },
    { role: 'assistant', content: 'Not yet.' },
    { role: 'user', content: 'and to canada?' },
  ]);
  assert.deepEqual(bodies[1].messages, [{ role: 'user', content: 'hi' }]);
});
