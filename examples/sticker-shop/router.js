import { createRouter } from '../../src/index.js';
import { answers, synonyms, stopwords, fallback } from './answers.js';
import { createKeywordClassifier } from './classifier.js';
import { createMockLlm } from '../../src/eval.js';

/**
 * The sticker shop wired end to end. `classify: null` leaves layer 3 out; by
 * default it is the keyword mock.
 * @param {{
 *   classify?: import('../../index.js').Classify | null,
 *   generate?: import('../../index.js').Generate,
 *   classifierTimeoutMs?: number,
 *   onResult?: (result: import('../../index.js').RouteResult) => void | Promise<void>,
 * }} [overrides]
 */
export function createStickerShopRouter({ classify, generate, onResult, classifierTimeoutMs = 250 } = {}) {
  return createRouter({
    answers,
    synonyms,
    stopwords,
    score: { minScore: 0.5, minMargin: 0.1, maxTokens: 10 },
    classifier: classify === null ? null : {
      classify: classify ?? createKeywordClassifier(), minConfidence: 0.65, timeoutMs: classifierTimeoutMs,
    },
    llm: { generate: generate ?? createMockLlm(), timeoutMs: 8000 },
    fallback,
    ...(onResult ? { onResult } : {}),
  });
}
