// The OpenAI-compatible adapters against a fake fetch: request shape, parsing and errors.
// No network call is made and no API key is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAiCompatibleClassifier, createOpenAiCompatibleLlm } from '../src/adapters/openai-compatible.js';
import { createRouter } from '../src/index.js';

const USAGE = { prompt_tokens: 210, completion_tokens: 12, prompt_cache_hit_tokens: 192 };

/** @param {any} reply @param {number} [status] */
function fakeFetch(reply, status = 200) {
  const calls = [];
  /** @type {any} */
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const ok = status >= 200 && status < 300;
    return { ok, status, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  return { f, calls };
}
const completion = (content, finish = 'stop') => ({
  model: 'served-model', choices: [{ message: { role: 'assistant', content }, finish_reason: finish }], usage: USAGE,
});
const CHOICES = [{ id: 'sizes', description: 'sticker sizes' }, { id: 'proof', description: 'the digital proof' }];

test('the classifier sends a JSON-mode chat completion to baseUrl and returns choice, confidence, usage', async () => {
  const { f, calls } = fakeFetch(completion('{"choice":"sizes","confidence":0.92}'));
  const classify = createOpenAiCompatibleClassifier({
    apiKey: 'test-key', model: 'small', baseUrl: 'https://api.example.com/', fetch: f,
    extraBody: { thinking: { type: 'disabled' } },
  });
  const signal = AbortSignal.timeout(1000);
  assert.deepEqual(await classify({ message: 'laptop lid size?', choices: CHOICES, signal }),
    { choice: 'sizes', confidence: 0.92, usage: USAGE });
  const [call] = calls;
  assert.equal(call.url, 'https://api.example.com/chat/completions');
  assert.equal(call.init.headers.authorization, 'Bearer test-key');
  assert.equal(call.init.signal, signal);
  assert.equal(call.body.model, 'small');
  assert.equal(call.body.temperature, 0);
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.deepEqual(call.body.thinking, { type: 'disabled' });
  assert.equal(call.body.messages[0].role, 'system');
  const user = call.body.messages[1].content;
  assert.match(user, /- sizes: sticker sizes\n- proof: the digital proof\n\nNo answer fits: "none"/);
  assert.match(call.body.messages[1].content, /Message:\nlaptop lid size\?$/);
});

test('"none" maps to null, an invented id comes back as given, and a string confidence becomes a number', async () => {
  const run = async (content, choices = CHOICES) => createOpenAiCompatibleClassifier({
    apiKey: 'k', model: 'm', fetch: fakeFetch(completion(content)).f,
  })({ message: 'x', choices });
  assert.equal((await run('{"choice":"none","confidence":0.7}')).choice, null);
  assert.equal((await run('{"choice":"shipping-to-europe","confidence":0.9}')).choice, 'shipping-to-europe');
  assert.equal((await run('```json\n{"choice":"proof","confidence":"0.8"}\n```')).confidence, 0.8);
  const withNoneId = [{ id: 'none', description: 'no minimum' }];
  assert.equal((await run('{"choice":"none","confidence":0.9}', withNoneId)).choice, 'none');
  assert.equal((await run('{"choice":"_none","confidence":0.9}', withNoneId)).choice, null);
});

test('an invented id reaches the router as an unknown choice, not as an abstention', async () => {
  const router = createRouter({
    answers: [{ id: 'sizes', reply: 'From 1 to 12 inches.', phrases: ['what sizes do you print'] }],
    classifier: { classify: createOpenAiCompatibleClassifier({
      apiKey: 'k', model: 'm', fetch: fakeFetch(completion('{"choice":"europe","confidence":0.95}')).f,
    }) },
    fallback: 'fallback',
  });
  const step = (await router.route('laptop lid')).trace.at(-1);
  assert.equal(step.outcome, 'miss');
  assert.equal(step.reason, 'unknown choice "europe"');
  assert.deepEqual(step.usage, USAGE);
});

test('a reply that is not a JSON object is an error that does not quote the reply', async () => {
  for (const content of ['sizes, probably, for "my secret message"', '[1, 2]', '']) {
    const { f } = fakeFetch(completion(content));
    const classify = createOpenAiCompatibleClassifier({ apiKey: 'k', model: 'm', fetch: f });
    await assert.rejects(classify({ message: 'x', choices: CHOICES }), (err) => {
      assert.match(err.message, /^createOpenAiCompatibleClassifier: the reply is not a? ?JSON/);
      assert.ok(!err.message.includes('secret'));
      return true;
    });
  }
});

test('an HTTP error keeps the status and a plain error identifier, never the body', async () => {
  const echoed = 'Authentication Fails, your api key: sk-ab****yz is invalid';
  const cases = [
    [{ error: { message: echoed, type: 'authentication_error' } }, 401, 'HTTP 401: authentication_error'],
    [{ error: { message: echoed, code: 'invalid_api_key' } }, 401, 'HTTP 401: invalid_api_key'],
    [{ error: { message: echoed, type: 'sk-ab****yz' } }, 402, 'HTTP 402'],
    ['upstream down sk-ab****yz', 503, 'HTTP 503'],
  ];
  for (const [body, status, message] of cases) {
    const generate = createOpenAiCompatibleLlm({ apiKey: 'k', model: 'm', fetch: fakeFetch(body, status).f });
    await assert.rejects(generate({ message: 'x' }), (err) => {
      assert.equal(err.message, `createOpenAiCompatibleLlm: ${message}`);
      assert.equal(err.status, status);
      assert.ok(!err.message.includes('sk-'));
      return true;
    });
  }
});

test('the LLM sends system, earlier turns and the message, and reports usage and finish reason', async () => {
  const { f, calls } = fakeFetch(completion('We ship to the US and Canada.'));
  const generate = createOpenAiCompatibleLlm({
    apiKey: 'k', model: 'big', system: 'Be brief.', temperature: 0.2, fetch: f,
  });
  const out = await generate({
    message: 'and to canada?',
    context: {
      messages: [{ role: 'user', content: 'mexico?' }, { role: 'assistant', content: 'No.' }, { role: 'tool' }],
    },
  });
  assert.deepEqual(out, {
    reply: 'We ship to the US and Canada.', usage: USAGE, model: 'served-model', finishReason: 'stop',
  });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].body.temperature, 0.2);
  assert.equal(calls[0].body.max_tokens, 1024);
  assert.deepEqual(calls[0].body.messages, [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'mexico?' },
    { role: 'assistant', content: 'No.' },
    { role: 'user', content: 'and to canada?' },
  ]);
  const plain = fakeFetch(completion('ok'));
  await createOpenAiCompatibleLlm({ apiKey: 'k', model: 'm', fetch: plain.f })({ message: 'hi' });
  assert.deepEqual(plain.calls[0].body.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal('temperature' in plain.calls[0].body, false);
});

test('truncation, a filtered reply and an empty body are errors or an empty reply', async () => {
  const llm = (reply) => createOpenAiCompatibleLlm({ apiKey: 'k', model: 'm', fetch: fakeFetch(reply).f });
  await assert.rejects(llm(completion('half', 'length'))({ message: 'x' }), /cut off at max_tokens/);
  await assert.rejects(llm(completion('', 'content_filter'))({ message: 'x' }), /filtered/);
  const empty = await llm({})({ message: 'x' });
  assert.equal(empty.reply, '');
  assert.equal(empty.model, 'm');
});

test('the adapters refuse to start without a key or a model', () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.throws(() => createOpenAiCompatibleLlm({ model: 'm' }), /OPENAI_API_KEY/);
    assert.throws(() => createOpenAiCompatibleClassifier({ apiKey: 'k', model: '' }), /model id/);
    process.env.OPENAI_API_KEY = 'from-env';
    assert.doesNotThrow(() => createOpenAiCompatibleLlm({ model: 'm' }));
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  }
});
