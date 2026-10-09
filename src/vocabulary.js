import { tokenize, editDistance } from './normalize.js';

/** Tokens shorter than this must match exactly; longer ones may be one edit away. */
const TYPO_MIN_LENGTH = 5;
/** Order numbers, dates and amounts must match exactly: "20241" is not "20242". */
const HAS_DIGIT = /\p{N}/u;

/**
 * Turns text into sets of content tokens: synonyms mapped to one canonical
 * word, stopwords dropped, and (optionally) one typo tolerated in long words
 * that contain no digits.
 * Shared by the scoring layer and by the `avoid` check every cheap layer runs.
 * @param {{
 *   synonyms: Readonly<Record<string, ReadonlyArray<string>>>,
 *   stopwords: ReadonlyArray<string>,
 *   typoTolerance: boolean,
 * }} options
 */
export function createVocabulary({ synonyms, stopwords, typoTolerance }) {
  /** @type {Map<string, string>} variant -> canonical */
  const canonicalOf = new Map();
  for (const [canonical, variants] of Object.entries(synonyms)) {
    const c = tokenize(canonical)[0];
    canonicalOf.set(c, c);
    for (const v of variants) canonicalOf.set(tokenize(v)[0], c);
  }
  const stop = new Set(stopwords.flatMap((w) => tokenize(w)));

  /** @param {string} t */
  const fuzzy = (t) => typoTolerance && t.length >= TYPO_MIN_LENGTH && !HAS_DIGIT.test(t);
  /** @param {string} a @param {string} b */
  const same = (a, b) => a === b || (fuzzy(a) && fuzzy(b) && editDistance(a, b, 1) <= 1);

  /** A misspelled synonym ("shiping") still maps to its canonical word. @param {string} t */
  const canonical = (t) => {
    const direct = canonicalOf.get(t);
    if (direct || !fuzzy(t)) return direct ?? t;
    for (const [variant, c] of canonicalOf) if (same(variant, t)) return c;
    return t;
  };

  /** @param {string} text @returns {Set<string>} */
  const contentTokens = (text) => {
    const out = new Set();
    for (const t of tokenize(text)) {
      const c = canonical(t);
      if (!stop.has(c) && !stop.has(t)) out.add(c);
    }
    return out;
  };

  /** @param {Set<string>} query @param {string} token */
  const inQuery = (query, token) => {
    if (query.has(token)) return true;
    for (const q of query) if (same(q, token)) return true;
    return false;
  };

  /**
   * The first avoid token present in the message, or null.
   * @param {Set<string>} query @param {ReadonlyArray<string>} avoid already content tokens
   */
  const avoidHit = (query, avoid) => avoid.find((t) => inQuery(query, t)) ?? null;

  return { contentTokens, inQuery, avoidHit };
}
