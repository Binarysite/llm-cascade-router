import { withTimeout } from '../timeout.js';

/**
 * Layer 4: the injected LLM, called only when every cheaper layer missed.
 *
 * `generate({ message, context, signal })` returns the reply as a string or as
 * `{ reply, ...anything }`; the whole object comes back as `result.llmOutput`,
 * so tool calls or token usage are not lost. A throw, a timeout or an empty reply is not passed on to the
 * user: the router answers with the configured fallback instead.
 *
 * @param {{ llm: { generate: Function, timeoutMs: number } }} config
 * @returns {import('./types.js').Layer}
 */
export function createLlmLayer({ llm }) {
  const { generate, timeoutMs } = llm;
  return {
    name: 'llm',
    async run({ message, context, signal }) {
      const out = await withTimeout('llm', (s) => generate({ message, context, signal: s }), timeoutMs, signal);
      const reply = typeof out === 'string' ? out : out?.reply;
      if (typeof reply !== 'string' || !reply.trim()) {
        return { outcome: 'error', reason: 'llm returned an empty reply' };
      }
      /** @type {import('./types.js').LayerOutcome} */
      const hit = { outcome: 'hit', answerId: null, reply, reason: 'no cheaper layer answered' };
      return typeof out === 'string' ? hit : { ...hit, output: out };
    },
  };
}
