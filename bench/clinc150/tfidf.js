// A local baseline: TF-IDF vectors and the single nearest training utterance by
// cosine similarity. Trained on every train utterance, banking or not, so it
// knows what out-of-domain traffic looks like; layers 1 and 2 only see banking.
import { tokenize } from '../../src/index.js';

/**
 * @param {ReadonlyArray<{ text: string, expect: string }>} train
 * @param {ReadonlyArray<string>} stopwords
 */
export function createNearestNeighbour(train, stopwords) {
  const stop = new Set(stopwords);
  const terms = (/** @type {string} */ text) => tokenize(text).filter((t) => !stop.has(t));
  const df = new Map();
  const docs = train.map(({ text, expect }) => {
    const tf = new Map();
    for (const t of terms(text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { expect, tf };
  });
  const n = docs.length;
  const idf = (/** @type {string} */ t) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
  /** @param {Map<string, number>} tf */
  const unit = (tf) => {
    const v = new Map([...tf].map(([t, c]) => [t, c * idf(t)]));
    const norm = Math.hypot(...v.values()) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  };
  /** term -> [doc index, weight] */
  const postings = new Map();
  docs.forEach((d, i) => {
    for (const [t, w] of unit(d.tf)) {
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push([i, w]);
    }
  });

  /** The nearest training utterance's label and its cosine similarity. @param {string} text */
  function nearest(text) {
    const tf = new Map();
    for (const t of terms(text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    const scores = new Float64Array(n);
    for (const [t, w] of unit(tf)) for (const [i, dw] of postings.get(t) ?? []) scores[i] += w * dw;
    let best = -1;
    let sim = 0;
    for (let i = 0; i < n; i += 1) if (scores[i] > sim) { sim = scores[i]; best = i; }
    // Rounded so an identical utterance scores exactly 1, not 0.9999999999999998.
    return { label: best < 0 ? 'llm' : docs[best].expect, similarity: Math.min(1, Math.round(sim * 1e9) / 1e9) };
  }

  /**
   * As a router classifier: the nearest utterance's intent when it is an answer, else abstain.
   * The similarity is the confidence, so minConfidence is the threshold.
   * @type {import('../../index.js').Classify}
   */
  const classify = ({ message }) => {
    const { label, similarity } = nearest(message);
    return { choice: label === 'llm' ? null : label, confidence: similarity };
  };
  return { nearest, classify };
}
