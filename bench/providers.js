// Providers the real-model benches can call, with the prices used to turn
// returned token usage into dollars. A price is an input with a source, not a
// measurement: check the provider's page before trusting a cost.

/** @param {unknown} u */
const num = (u) => (typeof u === 'number' && Number.isFinite(u) ? u : 0);

export const PROVIDERS = {
  deepseek: {
    kind: 'openai-compatible',
    keyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    // A classifier needs no chain of thought; DeepSeek's thinking mode is on by default.
    extraBody: { thinking: { type: 'disabled' } },
    prices: {
      inputCacheHit: 0.006, inputCacheMiss: 0.30, output: 1.20,
      unit: 'USD per million tokens',
      source: 'https://api-docs.deepseek.com/quick_start/pricing, deepseek-flash row, peak hours (the higher one)',
      fetched: '2026-11-11',
    },
    /** @param {any[]} usages */
    tokens: (usages) => ({
      prompt: usages.reduce((s, u) => s + num(u?.prompt_tokens), 0),
      promptCacheHit: usages.reduce((s, u) => s + num(u?.prompt_cache_hit_tokens), 0),
      completion: usages.reduce((s, u) => s + num(u?.completion_tokens), 0),
    }),
  },
  anthropic: {
    kind: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-haiku-5-5',
    prices: {
      inputCacheHit: 0.10, inputCacheMiss: 0.10, output: 0.50,
      unit: 'USD per million tokens',
      source: 'Claude Haiku 5.5 list price for prompts up to 100K tokens, as recorded in this repo on 2026-10-10; '
        + 'cache reads priced as input, an upper bound; never run here',
      fetched: '2026-10-10',
    },
    /** @param {any[]} usages */
    tokens: (usages) => ({
      prompt: usages.reduce((s, u) => s + num(u?.input_tokens) + num(u?.cache_read_input_tokens), 0),
      promptCacheHit: usages.reduce((s, u) => s + num(u?.cache_read_input_tokens), 0),
      completion: usages.reduce((s, u) => s + num(u?.output_tokens), 0),
    }),
  },
};

/**
 * Dollars for a list of usage objects, at the provider's prices.
 * @param {typeof PROVIDERS[keyof typeof PROVIDERS]} spec
 * @param {any[]} usages
 */
export function costUsd(spec, usages) {
  const { prices } = spec;
  const t = spec.tokens(usages);
  return ((t.prompt - t.promptCacheHit) * prices.inputCacheMiss + t.promptCacheHit * prices.inputCacheHit
    + t.completion * prices.output) / 1e6;
}
