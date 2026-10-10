import { createRouter } from '../../src/index.js';
import { answers, synonyms, stopwords, fallback } from './answers.js';
import { createKeywordClassifier } from './classifier.js';
import { createMockLlm } from './llm.js';

/**
 * The sticker shop wired end to end. The thresholds here are example values
 * for this invented data set; tune yours on your own messages with the bench.
 * @param {{
 *   classify?: import('../../index.js').Classify,
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
    classifier: {
      classify: classify ?? createKeywordClassifier(), minConfidence: 0.65, timeoutMs: classifierTimeoutMs,
    },
    llm: { generate: generate ?? createMockLlm(), timeoutMs: 8000 },
    fallback,
    ...(onResult ? { onResult } : {}),
  });
}
