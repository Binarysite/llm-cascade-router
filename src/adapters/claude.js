/**
 * Optional adapters that plug Claude into the classifier and LLM slots, using
 * the Messages API over fetch (no SDK, so the package keeps zero runtime
 * dependencies). Nothing in the router imports this file.
 *
 * The API key comes from `apiKey` or the ANTHROPIC_API_KEY environment
 * variable. `model` is required: model ids change, so pick one on purpose
 * (a Claude Haiku model is the natural fit for the classifier).
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * @param {{ apiKey?: string, model?: string, fetch?: typeof fetch, url?: string }} options
 *   `url` overrides the endpoint (for a local fake server in tests). The API key
 *   is sent to it, so only point it at hosts you trust.
 * @param {string} who
 */
function client({ apiKey, model, fetch: f, url }, who) {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error(`${who}: set ANTHROPIC_API_KEY or pass apiKey`);
  if (typeof model !== 'string' || !model) throw new Error(`${who}: pass the model id to use`);
  const doFetch = f ?? globalThis.fetch;

  /**
   * @param {Record<string, unknown>} body
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ text: string, usage: unknown, model: string, stopReason: string }>}
   */
  return async function send(body, signal) {
    const res = await doFetch(url ?? API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
      body: JSON.stringify({ model, ...body }),
      signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw Object.assign(new Error(`${who}: HTTP ${res.status} ${detail}`.trim()), { status: res.status });
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error(`${who}: the model declined`);
    if (data.stop_reason === 'max_tokens') throw new Error(`${who}: reply cut off at max_tokens`);
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return { text, usage: data.usage, model: data.model, stopReason: data.stop_reason };
  };
}

/**
 * The LLM slot: `generate({ message, signal })` returns `{ reply, usage, model,
 * stopReason }`. The router keeps that object as `result.llmOutput`, so the
 * token usage of every LLM turn reaches your onResult logger.
 * @param {{
 *   model: string, system?: string, maxTokens?: number,
 *   apiKey?: string, fetch?: typeof fetch, url?: string,
 * }} options
 */
export function createClaudeLlm({ system, maxTokens = 2048, ...rest }) {
  const send = client(rest, 'createClaudeLlm');
  /** @param {{ message: string, signal?: AbortSignal }} input */
  return async function generate({ message, signal }) {
    const { text, usage, model, stopReason } = await send({
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: message }],
    }, signal);
    return { reply: text, usage, model, stopReason };
  };
}

/**
 * The classifier slot: asks Claude to pick one answer id (or none) and return
 * its confidence as structured JSON. The confidence is the model's own
 * estimate, not a calibrated probability: set `minConfidence` from a run of
 * the benchmark on your messages, not from intuition. The result also carries
 * the call's `usage`, which the router copies to the classifier's trace step.
 *
 * "No answer" is the enum value "none". An answer id can be "none" too, so in
 * that case the adapter uses "_none", which can never be an id (ids start with
 * a letter or digit).
 * @param {{
 *   model: string, instructions?: string, effort?: string | null, maxTokens?: number,
 *   apiKey?: string, fetch?: typeof fetch, url?: string,
 * }} options effort is not sent unless you pass one. Not every model accepts
 * `output_config.effort` (older Haiku models reject it with HTTP 400, which the
 * router would only show as a classifier error on every turn), so it is opt-in.
 * On a model that accepts it and thinks by default, 'low' keeps the call short.
 */
export function createClaudeClassifier({ instructions, effort = null, maxTokens = 1024, ...rest }) {
  const send = client(rest, 'createClaudeClassifier');
  const system = instructions ?? [
    'You route customer messages to prepared answers.',
    'Pick the one answer that fully answers the message, or the no-answer value if no single answer does,',
    'if the message is about a specific order or account, or if it asks several things at once.',
    'confidence is your probability, between 0 and 1, that the chosen answer is right.',
  ].join(' ');

  /**
   * @param {{
   *   message: string, choices: ReadonlyArray<{ id: string, description: string }>, signal?: AbortSignal,
   * }} input
   */
  return async function classify({ message, choices, signal }) {
    const ids = choices.map((c) => c.id);
    const none = ids.includes('none') ? '_none' : 'none';
    const schema = {
      type: 'object',
      properties: { choice: { type: 'string', enum: [...ids, none] }, confidence: { type: 'number' } },
      required: ['choice', 'confidence'],
      additionalProperties: false,
    };
    const list = choices.map((c) => `- ${c.id}: ${c.description}`).join('\n');
    const content = `Answers:\n${list}\n\nNo answer fits: "${none}"\n\nMessage:\n${message}`;
    const { text, usage } = await send({
      max_tokens: maxTokens,
      system,
      output_config: { ...(effort ? { effort } : {}), format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    }, signal);
    const out = JSON.parse(text);
    return { choice: out.choice === none ? null : out.choice, confidence: out.confidence, usage };
  };
}
