/**
 * Text normalization shared by every local layer.
 *
 * The goal is that two messages a person would call "the same question" end up
 * as the same string: case, accents, punctuation, apostrophes and repeated
 * whitespace are dropped. Synonyms and stopwords are supplied by the caller's
 * config.
 *
 * Only the accents of the Combining Diacritical Marks block (U+0300..U+036F,
 * used by Latin, Greek and Cyrillic after NFKD) are dropped. Marks of other
 * scripts are kept: in Devanagari, for example, they are vowels, and dropping
 * them would merge different words.
 */

const ACCENTS = /[\u0300-\u036f]+/g;
const APOSTROPHES = /['’ʼ`]/g;
const NOT_WORD = /[^\p{L}\p{M}\p{N}]+/gu;

/**
 * Lowercase, strip accents and punctuation, collapse whitespace.
 * "Whats   the PRICE?!" and "what's the price" both become "whats the price".
 * @param {unknown} text
 * @returns {string} '' for anything that is not a string
 */
export function normalize(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFKD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(NOT_WORD, ' ')
    .trim();
}

/**
 * Split a message into normalized tokens.
 * @param {unknown} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/**
 * Edit distance with adjacent transpositions (optimal string alignment),
 * stopping early once it is clear the result exceeds `max`.
 * @param {string} a
 * @param {string} b
 * @param {number} max
 * @returns {number} the distance, or max + 1 when it is larger than max
 */
export function editDistance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prevPrev[j - 2] + 1);
      }
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length];
}
