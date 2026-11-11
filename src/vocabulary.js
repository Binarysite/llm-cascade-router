import { tokenize, editDistance } from './normalize.js';

/** Tokens shorter than this must match exactly; longer ones may be one edit away. */
const TYPO_MIN_LENGTH = 5;
/** Order numbers, dates and amounts must match exactly: "20241" is not "20242". */
const HAS_DIGIT = /\p{N}/u;

/**
 * Turns text into sets of content tokens for scoring (synonyms mapped to one
 * canonical word, stopwords dropped, one typo tolerated in long words without
 * digits) and holds each answer's avoid words, which match exactly.
 * @param {{
 *   synonyms: Readonly<Record<string, ReadonlyArray<string>>>,
 *   stopwords: ReadonlyArray<string>,
 *   typoTolerance: boolean,
 *   answers?: ReadonlyArray<{ id: string, avoid: ReadonlyArray<string>, avoidTypos?: boolean }>,
 * }} options
 */
export function createVocabulary({ synonyms, stopwords, typoTolerance, answers = [] }) {
  /** @type {Map<string, string>} variant -> canonical */
  const canonicalOf = new Map();
  for (const [canonical, variants] of Object.entries(synonyms)) {
    const c = tokenize(canonical)[0];
    canonicalOf.set(c, c);
    for (const v of variants) canonicalOf.set(tokenize(v)[0], c);
  }
  const stop = new Set(stopwords.flatMap((w) => tokenize(w)));

  /** @param {string} t */
  const fuzzy = (t) => t.length >= TYPO_MIN_LENGTH && !HAS_DIGIT.test(t);
  /** @param {string} a @param {string} b */
  const near = (a, b) => fuzzy(a) && fuzzy(b) && editDistance(a, b, 1) <= 1;
  /** @param {string} a @param {string} b */
  const same = (a, b) => a === b || (typoTolerance && near(a, b));
  /** @param {string} t */
  const exactCanonical = (t) => canonicalOf.get(t) ?? t;

  /** A misspelled synonym ("shiping") still maps to its canonical word. @param {string} t */
  const canonical = (t) => {
    const direct = canonicalOf.get(t);
    if (direct || !typoTolerance || !fuzzy(t)) return direct ?? t;
    for (const [variant, c] of canonicalOf) if (same(variant, t)) return c;
    return t;
  };

  /** @param {ReadonlyArray<string>} tokens already normalized @returns {Set<string>} */
  const contentOf = (tokens) => {
    const out = new Set();
    for (const t of tokens) {
      const c = canonical(t);
      if (!stop.has(c) && !stop.has(t)) out.add(c);
    }
    return out;
  };

  /** @param {string} text @returns {Set<string>} */
  const contentTokens = (text) => contentOf(tokenize(text));

  /** @param {Set<string>} query @param {string} token */
  const inQuery = (query, token) => {
    if (query.has(token)) return true;
    if (!typoTolerance) return false;
    for (const q of query) if (same(q, token)) return true;
    return false;
  };

  /**
   * The words an avoid check compares against: every token, synonyms applied
   * exactly, stopwords kept. Build it once per message.
   * @param {ReadonlyArray<string>} tokens already normalized
   * @returns {Set<string>}
   */
  const avoidWords = (tokens) => new Set(tokens.map(exactCanonical));

  /** @type {Map<string, { entries: Array<{ word: string, key: string }>, typos: boolean }>} */
  const avoidOf = new Map();
  for (const a of answers) {
    if (avoidOf.has(a.id)) continue; // a duplicated id is a config error reported elsewhere
    avoidOf.set(a.id, {
      entries: a.avoid.flatMap((word) => tokenize(word).slice(0, 1).map((t) => ({ word, key: exactCanonical(t) }))),
      typos: a.avoidTypos === true,
    });
  }

  /**
   * The first avoid word of `answerId` present in the message, or null.
   * Exact after synonyms; one edit away only for an answer with `avoidTypos`.
   * @param {string} answerId
   * @param {Set<string>} words from avoidWords()
   * @returns {string | null}
   */
  const vetoOf = (answerId, words) => {
    const own = avoidOf.get(answerId);
    if (!own) return null;
    for (const { word, key } of own.entries) {
      if (words.has(key)) return word;
      if (own.typos && fuzzy(key)) for (const w of words) if (near(w, key)) return word;
    }
    return null;
  };

  return { contentOf, contentTokens, inQuery, avoidWords, vetoOf };
}
