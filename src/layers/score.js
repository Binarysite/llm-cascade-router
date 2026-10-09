const round = (n) => Math.round(n * 1000) / 1000;
/** Absorbs float error, so 0.6 - 0.5 still counts as a margin of 0.1. */
const EPSILON = 1e-9;

/**
 * Layer 2: local token scoring against every answer's phrases.
 *
 * A message and a phrase are reduced to sets of content tokens (see
 * vocabulary.js). Their similarity is the Dice coefficient,
 * 2 * shared / (|message| + |phrase|), so extra words in the message lower the
 * score instead of being ignored. An answer whose avoid words appear is
 * skipped. An answer is chosen only if its best score clears `minScore` AND
 * beats the runner-up answer by `minMargin`; a near tie is a miss, because two
 * answers that both fit are a question for a smarter layer.
 *
 * @param {{
 *   answers: ReadonlyArray<{
 *     id: string, reply: string, phrases: ReadonlyArray<string>, avoid: ReadonlyArray<string>,
 *   }>,
 *   score: { minScore: number, minMargin: number, maxTokens: number },
 * }} config
 * @param {ReturnType<typeof import('../vocabulary.js').createVocabulary>} vocabulary
 * @returns {import('./types.js').Layer}
 */
export function createScoreLayer({ answers, score }, vocabulary) {
  const { minScore, minMargin, maxTokens } = score;
  const { contentTokens, inQuery, avoidHit } = vocabulary;

  const index = answers.map((a) => ({
    id: a.id,
    reply: a.reply,
    avoid: [...contentTokens(a.avoid.join(' '))],
    phrases: a.phrases
      .map((p) => {
        const set = contentTokens(p);
        return { text: p, tokens: [...set], set };
      })
      .filter((p) => p.tokens.length),
  }));

  return {
    name: 'score',
    async run({ message }) {
      const query = contentTokens(message);
      if (query.size === 0) return { outcome: 'skipped', reason: 'no content words after stopwords' };
      if (query.size > maxTokens) {
        return { outcome: 'skipped', reason: `${query.size} content words, above maxTokens ${maxTokens}` };
      }

      const ranked = [];
      for (const answer of index) {
        if (avoidHit(query, answer.avoid)) continue;
        let best = { score: 0, phrase: '' };
        for (const phrase of answer.phrases) {
          // With typo tolerance two phrase tokens can match one query token
          // ("refund", "refunds"), so count matches on both sides and take the
          // smaller: the score then never exceeds 1.
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
      if (top.score + EPSILON < minScore) {
        return { outcome: 'miss', reason: `best ${detail}, below minScore ${minScore}`, score: s };
      }
      if (top.score - runnerUp + EPSILON < minMargin) {
        return { outcome: 'miss', reason: `ambiguous: ${detail}, margin below ${minMargin}`, score: s };
      }
      return { outcome: 'hit', answerId: top.answer.id, reply: top.answer.reply, reason: detail, score: s };
    },
  };
}
