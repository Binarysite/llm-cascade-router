import { validateConfig } from './config.js';
import { normalize } from './normalize.js';
import { createVocabulary } from './vocabulary.js';
import { createExactLayer } from './layers/exact.js';
import { createScoreLayer } from './layers/score.js';
import { createClassifierLayer } from './layers/classifier.js';
import { createLlmLayer } from './layers/llm.js';
import { LayerTimeoutError, CallerAbortError } from './timeout.js';

/** Longest error message copied from an injected function into the trace. */
export const MAX_ERROR_CHARS = 200;

/** @param {number} start */
const ms = (start) => Math.round((performance.now() - start) * 100) / 100;
/** @param {string} text @param {number} max */
const cap = (text, max) => (text.length > max ? `${text.slice(0, max)}...` : text);
/**
 * What the trace keeps of an error thrown by an injected function: its name and
 * at most MAX_ERROR_CHARS of its message (a provider error can be long, or echo input).
 * @param {unknown} err
 */
const describe = (err) => {
  if (!(err instanceof Error)) return cap(String(err), MAX_ERROR_CHARS);
  return `${cap(String(err.name), 60)}: ${cap(String(err.message), MAX_ERROR_CHARS)}`;
};

/**
 * Build a router from a config. Throws RouterConfigError on a bad config;
 * after that, `route` never throws: a layer that fails, times out or returns
 * garbage is recorded in the trace and the next layer runs. When nothing
 * answers, the reply is `config.fallback`.
 * @param {import('../index.js').RouterConfig} config
 * @returns {import('../index.js').Router}
 */
export function createRouter(config) {
  const cfg = validateConfig(config);
  const vocabulary = createVocabulary({
    synonyms: cfg.synonyms,
    stopwords: cfg.stopwords,
    typoTolerance: cfg.score.typoTolerance,
    answers: cfg.answers,
  });
  /** @type {import('./layers/types.js').Layer[]} */
  const layers = [createExactLayer(cfg), createScoreLayer(cfg, vocabulary)];
  if (cfg.classifier) layers.push(createClassifierLayer(cfg.answers, cfg.classifier, vocabulary));
  if (cfg.llm) layers.push(createLlmLayer(cfg.llm));

  /**
   * Answer one message with the cheapest layer that can.
   * @param {unknown} message
   * @param {import('../index.js').RouteOptions | null} [options]
   * @returns {Promise<import('../index.js').RouteResult>}
   */
  async function route(message, options) {
    // route() must not reject, so bad options are tolerated: null means none,
    // and a signal that is not an AbortSignal is ignored.
    const context = options?.context;
    const signal = options?.signal instanceof AbortSignal ? options.signal : undefined;
    const started = performance.now();
    /** @type {import('../index.js').TraceStep[]} */
    const trace = [];

    /** @param {Omit<import('../index.js').RouteResult, 'llmCalled' | 'latencyMs' | 'trace'>} fields */
    const finish = (fields) => {
      const result = {
        ...fields,
        llmCalled: trace.some((step) => step.layer === 'llm'),
        latencyMs: ms(started),
        trace,
      };
      if (cfg.onResult) {
        // A broken logger must not break the turn: sync throws and async rejections are both swallowed.
        try {
          const pending = cfg.onResult(result);
          if (pending && typeof pending.then === 'function') pending.then(undefined, () => {});
        } catch {
          // ignored on purpose
        }
      }
      return result;
    };
    /** @param {string} reason */
    const fallback = (reason) => finish({ reply: cfg.fallback, layer: 'fallback', answerId: null, reason });

    if (typeof message !== 'string') return fallback('message is not a string');
    if (!message.trim()) return fallback('message is empty');
    // May be '' for a message of only emoji or punctuation: the local layers
    // then miss and the injected layers still get the raw message.
    const normalized = normalize(message);
    const tokens = normalized ? normalized.split(' ') : [];
    const avoidWords = vocabulary.avoidWords(tokens);

    for (const layer of layers) {
      if (signal?.aborted) return fallback('aborted by caller');
      const t0 = performance.now();
      /** @type {import('./layers/types.js').LayerOutcome} */
      let out;
      try {
        out = await layer.run({ message, normalized, tokens, avoidWords, context, signal });
      } catch (err) {
        if (err instanceof CallerAbortError) {
          trace.push({ layer: layer.name, outcome: 'aborted', reason: err.message, latencyMs: ms(t0) });
          return fallback('aborted by caller');
        }
        out = { outcome: err instanceof LayerTimeoutError ? 'timeout' : 'error', reason: describe(err) };
      }
      const { reply, output, ...step } = out;
      trace.push({ layer: layer.name, ...step, latencyMs: ms(t0) });
      if (out.outcome === 'hit') {
        return finish({
          reply: /** @type {string} */ (reply),
          layer: layer.name,
          answerId: out.answerId ?? null,
          reason: out.reason,
          ...(output ? { llmOutput: /** @type {import('../index.js').LlmOutput} */ (output) } : {}),
        });
      }
    }
    const last = trace.at(-1);
    return fallback(last?.layer === 'llm' ? `llm ${last.outcome}: ${last.reason}` : 'no layer answered');
  }

  return { route };
}
