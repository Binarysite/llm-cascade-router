import { tokenize } from '../../src/index.js';

/**
 * A deterministic stand-in for a cheap classifier, so the example runs with
 * no API key. In production this slot is a small model (for example Claude
 * Haiku with a short prompt that lists the choices), a fine-tuned intent
 * model or an embeddings lookup. It only has to honour the same contract:
 * `({ message, choices, signal }) => Promise<{ choice, confidence }>`.
 *
 * It counts keyword stems per answer. Confidence is hits / (hits + 1), so one
 * hit gives 0.5, two give 0.67, three give 0.75; a tie between two answers
 * halves it. These numbers are a toy calibration, not a model's.
 */
const KEYWORDS = {
  'shipping-time': ['when', 'long', 'fast', 'soon', 'quick', 'rush', 'days', 'week', 'deadline', 'arriv', 'receiv'],
  'shipping-cost': ['ship', 'cost', 'price', 'fee', 'free', 'postage', 'expens', 'cheap', 'pay'],
  international: ['country', 'countries', 'international', 'abroad', 'overseas', 'europe', 'mexico', 'uk', 'canada'],
  sizes: ['size', 'big', 'small', 'inch', 'cm', 'tiny', 'huge', 'large', 'dimension', 'laptop', 'bumper'],
  waterproof: ['water', 'rain', 'sun', 'outdoor', 'outside', 'wash', 'fade', 'peel', 'bottle', 'car'],
  'file-formats': ['file', 'png', 'jpg', 'jpeg', 'pdf', 'svg', 'eps', 'vector', 'dpi', 'resolution', 'upload', 'canva'],
  'minimum-order': ['minimum', 'least', 'only', 'one', 'single', 'few', 'quantity', 'many'],
  proof: ['proof', 'preview', 'mockup', 'approve', 'before', 'look', 'check'],
  contact: ['contact', 'email', 'phone', 'call', 'talk', 'human', 'person', 'hours', 'open', 'support'],
};

/**
 * @param {{ delayMs?: number }} [options] delayMs simulates network latency
 */
export function createKeywordClassifier({ delayMs = 0 } = {}) {
  return async function classify({ message, choices, signal }) {
    if (delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(signal.reason);
        }, { once: true });
      });
    }
    const tokens = tokenize(message);
    const scored = choices
      .map(({ id }) => ({
        id,
        hits: (KEYWORDS[id] ?? []).filter((k) => tokens.some((t) => t.startsWith(k))).length,
      }))
      .sort((a, b) => b.hits - a.hits);
    const [best, next] = scored;
    if (!best || best.hits === 0) return { choice: null, confidence: 0 };
    const confidence = best.hits / (best.hits + 1);
    return { choice: best.id, confidence: next && next.hits === best.hits ? confidence / 2 : confidence };
  };
}
