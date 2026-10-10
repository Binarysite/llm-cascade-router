// The Claude adapters against a fake fetch: request shape and error handling.
// No network call is made and no API key is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeLlm, createClaudeClassifier } from '../src/adapters/claude.js';
import { createRouter } from '../src/index.js';

/** @param {any} reply @param {number} [status] */
function fakeFetch(reply, status = 200) {
  const calls = [];
  /** @type {any} */
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply,
      text: async () => JSON.stringify(reply),
    };
  };
  return { f, calls };
}

const USAGE = { input_tokens: 120, output_tokens: 18 };
const text = (t, stop = 'end_turn') => ({
  model: 'model-under-test',
  content: [{ type: 'text', text: t }],
  stop_reason: stop,
  usage: USAGE,
});

test('createClaudeLlm sends a Messages API request and returns the reply with its usage', async () => {
  const { f, calls } = fakeFetch(text('We print from 1 to 12 inches.'));
  const generate = createClaudeLlm({ apiKey: 'test-key', model: 'model-under-test', system: 'Be brief.', fetch: f });
  const controller = new AbortController();
  const reply = await generate({ message: 'how big?', signal: controller.signal });

  assert.deepEqual(reply, {
    reply: 'We print from 1 to 12 inches.',
    usage: USAGE,
    model: 'model-under-test',
    stopReason: 'end_turn',
  });
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].init.headers['x-api-key'], 'test-key');
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01');
  assert.equal(calls[0].init.signal, controller.signal);
  assert.deepEqual(calls[0].body, {
    model: 'model-under-test',
    max_tokens: 2048,
    system: 'Be brief.',
    messages: [{ role: 'user', content: 'how big?' }],
  });
});

test('createClaudeLlm turns HTTP errors, refusals and truncation into throws', async () => {
  const overloaded = createClaudeLlm({ apiKey: 'k', model: 'm', fetch: fakeFetch({ error: 'overloaded' }, 529).f });
  await assert.rejects(overloaded({ message: 'x' }), (err) => err.status === 529);
  const refused = createClaudeLlm({ apiKey: 'k', model: 'm', fetch: fakeFetch(text('', 'refusal')).f });
  await assert.rejects(refused({ message: 'x' }), /declined/);
  const cut = createClaudeLlm({ apiKey: 'k', model: 'm', fetch: fakeFetch(text('half a', 'max_tokens')).f });
  await assert.rejects(cut({ message: 'x' }), /max_tokens/);
});

test('an HTTP error keeps the status and the standard error.type, never the body', async () => {
  const echoed = 'invalid x-api-key sk-xxxx, seen as sk-ab***yz';
  const json = fakeFetch({ type: 'error', error: { type: 'authentication_error', message: echoed } }, 401).f;
  const plain = async () => ({ ok: false, status: 503, text: async () => `upstream down, key sk-xxxx` });
  const weird = async () => ({ ok: false, status: 400, text: async () => '{"error":{"type":"sk-xxxx"}}' });
  const cases = [
    [json, 401, 'createClaudeLlm: HTTP 401: authentication_error'],
    [plain, 503, 'createClaudeLlm: HTTP 503'],
    [weird, 400, 'createClaudeLlm: HTTP 400'],
  ];
  for (const [f, status, message] of cases) {
    const generate = createClaudeLlm({ apiKey: 'k', model: 'm', fetch: f });
    await assert.rejects(generate({ message: 'x' }), (err) => {
      assert.equal(err.message, message);
      assert.equal(err.status, status);
      assert.ok(!err.message.includes('sk-'), err.message);
      return true;
    });
  }
});

test('the adapters refuse to start without a key or a model', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.throws(() => createClaudeLlm({ model: 'm' }), /ANTHROPIC_API_KEY/);
    assert.throws(() => createClaudeClassifier({ apiKey: 'k', model: '' }), /model id/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('createClaudeClassifier asks for structured JSON over the answer ids and maps "none" to null', async () => {
  const { f, calls } = fakeFetch(text('{"choice":"sizes","confidence":0.91}'));
  const classify = createClaudeClassifier({ apiKey: 'k', model: 'small-model', effort: 'low', fetch: f });
  const out = await classify({
    message: 'laptop lid size?',
    choices: [{ id: 'sizes', description: 'sticker sizes' }, { id: 'proof', description: 'the digital proof' }],
  });
  assert.deepEqual(out, { choice: 'sizes', confidence: 0.91, usage: USAGE });
  const body = calls[0].body;
  assert.equal(body.output_config.effort, 'low');
  assert.deepEqual(body.output_config.format.schema.properties.choice.enum, ['sizes', 'proof', 'none']);
  assert.match(body.messages[0].content, /- sizes: sticker sizes\n- proof: the digital proof/);

  const abstain = fakeFetch(text('{"choice":"none","confidence":0.8}'));
  const none = createClaudeClassifier({ apiKey: 'k', model: 'm', fetch: abstain.f });
  const result = await none({ message: 'x', choices: [{ id: 'sizes', description: 'd' }] });
  assert.deepEqual(result, { choice: null, confidence: 0.8, usage: USAGE });
  assert.equal('effort' in abstain.calls[0].body.output_config, false, 'effort is opt-in');
});

test('an answer id "none" does not collide with the no-answer value', async () => {
  const pickedNone = fakeFetch(text('{"choice":"none","confidence":0.9}'));
  const classify = createClaudeClassifier({ apiKey: 'k', model: 'm', fetch: pickedNone.f });
  const choices = [{ id: 'none', description: 'we have no minimum' }, { id: 'sizes', description: 'sizes' }];
  const out = await classify({ message: 'is there a minimum', choices });
  assert.equal(out.choice, 'none');
  const { schema } = pickedNone.calls[0].body.output_config.format;
  assert.deepEqual(schema.properties.choice.enum, ['none', 'sizes', '_none']);

  const abstained = fakeFetch(text('{"choice":"_none","confidence":0.9}'));
  const classify2 = createClaudeClassifier({ apiKey: 'k', model: 'm', fetch: abstained.f });
  assert.equal((await classify2({ message: 'x', choices })).choice, null);
});

test('the LLM adapter output reaches the result as llmOutput, usage included', async () => {
  const router = createRouter({
    answers: [{ id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] }],
    llm: { generate: createClaudeLlm({ apiKey: 'k', model: 'm', fetch: fakeFetch(text('Order 10482 shipped.')).f }) },
    fallback: 'fallback',
  });
  const r = await router.route('where is order 10482');
  assert.equal(r.reply, 'Order 10482 shipped.');
  assert.deepEqual(r.llmOutput.usage, USAGE);
});

test('the classifier adapter usage reaches the trace step on a hit and on a miss', async () => {
  const routerFor = (reply) => createRouter({
    answers: [{ id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] }],
    classifier: { classify: createClaudeClassifier({ apiKey: 'k', model: 'm', fetch: fakeFetch(text(reply)).f }) },
    fallback: 'fallback',
  });
  const hit = await routerFor('{"choice":"sizes","confidence":0.95}').route('laptop lid size');
  assert.equal(hit.layer, 'classifier');
  assert.deepEqual(hit.trace.at(-1).usage, USAGE);

  const miss = await routerFor('{"choice":"sizes","confidence":0.3}').route('laptop lid size');
  assert.equal(miss.layer, 'fallback');
  assert.equal(miss.trace.at(-1).outcome, 'miss');
  assert.deepEqual(miss.trace.at(-1).usage, USAGE);
});

test('a classifier reply that is not JSON becomes a classifier error, and the router moves on', async () => {
  const router = createRouter({
    answers: [{ id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] }],
    classifier: {
      classify: createClaudeClassifier({ apiKey: 'k', model: 'm', fetch: fakeFetch(text('sizes, probably')).f }),
    },
    llm: { generate: async () => 'model answer' },
    fallback: 'fallback',
  });
  const r = await router.route('can you do a laptop lid');
  assert.equal(r.layer, 'llm');
  assert.equal(r.trace[2].outcome, 'error');
  assert.match(r.trace[2].reason, /SyntaxError/);
});
