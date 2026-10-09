import { normalize } from '../normalize.js';

/**
 * Layer 1: the normalized message equals one of an answer's phrases.
 * A hash lookup, so it costs nothing and can only be wrong if the phrase list is.
 * @param {{ answers: ReadonlyArray<{ id: string, reply: string, phrases: ReadonlyArray<string> }> }} config
 * @returns {import('./types.js').Layer}
 */
export function createExactLayer({ answers }) {
  /** @type {Map<string, { id: string, reply: string, phrase: string }>} */
  const index = new Map();
  for (const a of answers) {
    for (const phrase of a.phrases) index.set(normalize(phrase), { id: a.id, reply: a.reply, phrase });
  }

  return {
    name: 'exact',
    async run({ normalized }) {
      const hit = index.get(normalized);
      if (!hit) return { outcome: 'miss', reason: 'no phrase matches the normalized message' };
      return { outcome: 'hit', answerId: hit.id, reply: hit.reply, reason: `matches phrase "${hit.phrase}"` };
    },
  };
}
