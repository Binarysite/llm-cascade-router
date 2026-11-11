/** @param {number} n */
const round = (n) => Math.round(n * 1000) / 1000;
/** Absorbs float error, so 0.6 - 0.5 still counts as a margin of 0.1. */
const EPSILON = 1e-9;
/** Raw words allowed per content word of maxTokens before layer 2 skips without scoring. */
const RAW_PER_CONTENT = 4;

/**
 * Layer 2: local token scoring against every answer's phrases.
 *
 * A message and a phrase are reduced to sets of content tokens (see
 * vocabulary.js). Their similarity is the Dice coefficient,
 * 2 * shared / (|message| + |phrase|), so extra words in the message lower the
 * score. Every answer is ranked, vetoed or not. The top answer is chosen only
 * if no avoid word vetoes it, its score clears `minScore`, and it beats the
 * runner-up (vetoed or not) by `minMargin`. A vetoed answer that fits best is
 * therefore a miss, never a win for the second best.
 *
 * @param {{
 *   answers: ReadonlyArray<{ id: string, reply: string, phrases: ReadonlyArray<string> }>,
 *   score: { minScore: number, minMargin: number, maxTokens: number },
 * }} config
 * @param {ReturnType<typeof import('../vocabulary.js').createVocabulary>} vocabulary
 * @returns {import('./types.js').Layer}
 */
export function createScoreLayer({ answers, score }, vocabulary) {
  const { minScore, minMargin, maxTokens } = score;
  const { contentOf, contentTokens, inQuery, vetoOf } = vocabulary;

  const index = answers.map((a) => ({
    id: a.id,
    reply: a.reply,
    phrases: a.phrases
      .map((p) => {
        const set = contentTokens(p);
        return { text: p, tokens: [...set], set };
      })
      .filter((p) => p.tokens.length),
  }));

  return {
    name: 'score',
    async run({ tokens, avoidWords }) {
      // Checked before any synonym or typo lookup, so a huge message costs one split.
      if (tokens.length > maxTokens * RAW_PER_CONTENT) {
        const reason = `${tokens.length} words, above ${RAW_PER_CONTENT} x maxTokens ${maxTokens}`;
        return { outcome: 'skipped', reason };
      }
      const query = contentOf(tokens);
      if (query.size === 0) return { outcome: 'skipped', reason: 'no content words after stopwords' };
      if (query.size > maxTokens) {
        return { outcome: 'skipped', reason: `${query.size} content words, above maxTokens ${maxTokens}` };
      }

      const ranked = [];
      for (const answer of index) {
        let best = { score: 0, phrase: '' };
        for (const phrase of answer.phrases) {
          // Typo tolerance can match two phrase tokens to one query token; the smaller count keeps the score <= 1.
          const phraseMatched = phrase.tokens.filter((t) => inQuery(query, t)).length;
          const queryMatched = phraseMatched && [...query].filter((q) => inQuery(phrase.set, q)).length;
          const shared = Math.min(phraseMatched, queryMatched);
          const s = (2 * shared) / (query.size + phrase.tokens.length);
          if (s > best.score) best = { score: s, phrase: phrase.text };
        }
        if (best.score > 0) ranked.push({ answer, ...best });
      }
      ranked.sort((x, y) => y.score - x.score);

      const [top, second] = ranked;
      if (!top) return { outcome: 'miss', reason: 'no answer shares a content word', score: 0 };
      const runnerUp = second ? second.score : 0;
      const detail = `${top.answer.id} ${round(top.score)} via "${top.phrase}"`
        + (second ? `, next ${second.answer.id} ${round(runnerUp)}` : '');
      const s = round(top.score);
      const margin = round(top.score - runnerUp);
      const veto = vetoOf(top.answer.id, avoidWords);
      if (veto) {
        const reason = `best ${detail}; ${top.answer.id} vetoed by avoid word "${veto}"`;
        return { outcome: 'miss', reason, score: s, margin };
      }
      if (top.score + EPSILON < minScore) {
        return { outcome: 'miss', reason: `best ${detail}, below minScore ${minScore}`, score: s, margin };
      }
      if (top.score - runnerUp + EPSILON < minMargin) {
        return { outcome: 'miss', reason: `ambiguous: ${detail}, margin below ${minMargin}`, score: s, margin };
      }
      return { outcome: 'hit', answerId: top.answer.id, reply: top.answer.reply, reason: detail, score: s, margin };
    },
  };
}
