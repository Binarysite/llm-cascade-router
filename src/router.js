import { validateConfig } from './config.js';
import { normalize } from './normalize.js';
import { createVocabulary } from './vocabulary.js';
import { createExactLayer } from './layers/exact.js';
import { createScoreLayer } from './layers/score.js';
import { createClassifierLayer } from './layers/classifier.js';
import { createLlmLayer } from './layers/llm.js';
import { LayerTimeoutError, CallerAbortError } from './timeout.js';

const ms = (start) => Math.round((performance.now() - start) * 100) / 100;
const describe = (err) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

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
  });
  /** @type {import('./layers/types.js').Layer[]} */
  const layers = [createExactLayer(cfg), createScoreLayer(cfg, vocabulary)];
  if (cfg.classifier) layers.push(createClassifierLayer(cfg, vocabulary));
  if (cfg.llm) layers.push(createLlmLayer(cfg));

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

    const finish = (fields) => {
      const result = {
        ...fields,
        llmCalled: trace.some((step) => step.layer === 'llm'),
        latencyMs: ms(started),
        trace,
      };
      if (cfg.onResult) {
        // A broken logger must not break the turn: a sync throw is caught here
        // and an async logger's rejection is swallowed, so it never becomes an
        // unhandled rejection. onResult runs before route() resolves, so a slow
        // synchronous logger delays the reply; do slow work asynchronously.
        try {
          const pending = cfg.onResult(result);
          if (pending && typeof pending.then === 'function') pending.then(undefined, () => {});
        } catch {
          // ignored on purpose
        }
      }
      return result;
    };
    const fallback = (reason) => finish({ reply: cfg.fallback, layer: 'fallback', answerId: null, reason });

    if (typeof message !== 'string') return fallback('message is not a string');
    if (!message.trim()) return fallback('message is empty');
    // May be '' for a message of only emoji or punctuation: the local layers
    // then miss and the injected layers still get the raw message.
    const normalized = normalize(message);

    for (const layer of layers) {
      if (signal?.aborted) return fallback('aborted by caller');
      const t0 = performance.now();
      let out;
      try {
        out = await layer.run({ message, normalized, context, signal });
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
          reply,
          layer: layer.name,
          answerId: out.answerId ?? null,
          reason: out.reason,
          ...(output ? { llmOutput: output } : {}),
        });
      }
    }
    const last = trace.at(-1);
    return fallback(last?.layer === 'llm' ? `llm ${last.outcome}: ${last.reason}` : 'no layer answered');
  }

  return { route };
}
