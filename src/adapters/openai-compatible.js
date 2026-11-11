/**
 * Optional adapters for any OpenAI-compatible Chat Completions endpoint
 * (`POST {baseUrl}/chat/completions`): OpenAI itself, DeepSeek, a local
 * server. Over fetch, no SDK. Nothing in the router imports this file.
 *
 * `apiKey` defaults to the OPENAI_API_KEY environment variable and is sent as
 * a Bearer token to `baseUrl`, so point it only at hosts you trust. `model` is
 * required. `extraBody` is merged into every request for provider-specific
 * fields (DeepSeek: `{ thinking: { type: 'disabled' } }`).
 */
import { historyOf, errorIdentifier, parseClassifierReply, noAnswerValue } from './shared.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * @typedef {object} ClientOptions
 * @property {string} model
 * @property {string} [apiKey]
 * @property {string} [baseUrl] default https://api.openai.com/v1
 * @property {typeof fetch} [fetch]
 * @property {Record<string, unknown>} [extraBody]
 */

/**
 * @param {ClientOptions} options
 * @param {string} who
 */
function client({ model, apiKey, baseUrl = DEFAULT_BASE_URL, fetch: f, extraBody = {} }, who) {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error(`${who}: pass apiKey or set OPENAI_API_KEY`);
  if (typeof model !== 'string' || !model) throw new Error(`${who}: pass the model id to use`);
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const doFetch = f ?? globalThis.fetch;

  /**
   * @param {Record<string, unknown>} body
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ text: string, usage: unknown, model: string, finishReason: string }>}
   */
  return async function send(body, signal) {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...extraBody, model, ...body }),
      signal,
    });
    if (!res.ok) {
      // The body is never copied into the error: a provider can echo a masked key in it.
      const id = await errorIdentifier(res);
      throw Object.assign(new Error(`${who}: HTTP ${res.status}${id ? `: ${id}` : ''}`), { status: res.status });
    }
    const data = await res.json();
    const first = Array.isArray(data?.choices) ? data.choices[0] : undefined;
    const finishReason = String(first?.finish_reason ?? '');
    if (finishReason === 'length') throw new Error(`${who}: reply cut off at max_tokens`);
    if (finishReason === 'content_filter') throw new Error(`${who}: the provider filtered the reply`);
    const content = first?.message?.content;
    const text = typeof content === 'string' ? content.trim() : '';
    return { text, usage: data.usage, model: String(data.model ?? model), finishReason };
  };
}

/**
 * The LLM slot: `generate({ message, context, signal })` returns `{ reply, usage,
 * model, finishReason }`, which the router keeps as `result.llmOutput`. Earlier
 * turns go in `context.messages`; without them the call is single-turn.
 * @param {ClientOptions & { system?: string, maxTokens?: number, temperature?: number }} options
 */
export function createOpenAiCompatibleLlm({ system, maxTokens = 1024, temperature, ...rest }) {
  const send = client(rest, 'createOpenAiCompatibleLlm');
  /** @param {{ message: string, context?: unknown, signal?: AbortSignal }} input */
  return async function generate({ message, context, signal }) {
    const { text, usage, model, finishReason } = await send({
      max_tokens: maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...historyOf(context),
        { role: 'user', content: message },
      ],
    }, signal);
    return { reply: text, usage, model, finishReason };
  };
}

/**
 * The classifier slot: asks the model to pick one answer id, or the no-answer
 * value, as a JSON object `{ "choice", "confidence" }` (JSON mode on by default).
 * The choice is returned as the model gave it: an id that is not an answer is
 * not mapped to "no answer" here, so the router records it as an unknown choice
 * and a bench can count it. The confidence is the model's own estimate, not a
 * calibrated probability.
 * @param {ClientOptions & {
 *   instructions?: string, maxTokens?: number, temperature?: number, jsonMode?: boolean,
 * }} options
 */
export function createOpenAiCompatibleClassifier({
  instructions, maxTokens = 100, temperature = 0, jsonMode = true, ...rest
}) {
  const who = 'createOpenAiCompatibleClassifier';
  const send = client(rest, who);
  const system = instructions ?? [
    'You route customer messages to prepared answers.',
    'Pick the one answer that fully answers the message, or the no-answer value if no single answer does,',
    'if the message is about a specific order or account, or if it asks several things at once.',
    'Reply with a JSON object only: {"choice": "<answer id or the no-answer value>", "confidence": <0 to 1>}.',
    'confidence is your probability that the chosen answer is right.',
  ].join(' ');

  /**
   * @param {{
   *   message: string, choices: ReadonlyArray<{ id: string, description: string }>, signal?: AbortSignal,
   * }} input
   */
  return async function classify({ message, choices, signal }) {
    const none = noAnswerValue(choices.map((c) => c.id));
    const list = choices.map((c) => `- ${c.id}: ${c.description}`).join('\n');
    const { text, usage } = await send({
      max_tokens: maxTokens,
      temperature,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Answers:\n${list}\n\nNo answer fits: "${none}"\n\nMessage:\n${message}` },
      ],
    }, signal);
    const out = parseClassifierReply(text, who);
    const confidence = typeof out.confidence === 'string' && out.confidence.trim() !== ''
      ? Number(out.confidence) : out.confidence;
    // The router checks both at runtime: an unknown id is a miss, a bad confidence an error.
    const choice = /** @type {string | null} */ (out.choice === none ? null : out.choice);
    return { choice, confidence: /** @type {number} */ (confidence), usage };
  };
}
