import { withTimeout } from '../timeout.js';

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Layer 3: an injected, cheap classifier picks one of the answers.
 *
 * The router does not care what the classifier is: a small model such as
 * Claude Haiku behind a short prompt, a fine-tuned intent model, embeddings
 * with nearest-neighbour search, or plain keyword rules. It receives the
 * message and the list of choices and must return `{ choice, confidence }`,
 * where choice is an answer id or null to abstain. Anything else (an unknown
 * id, a confidence outside 0..1, a throw, a timeout) is treated as "no answer"
 * and the router moves on. So is a choice whose `avoid` words appear in the
 * message: the classifier proposes, the config has the last word.
 *
 * @param {{
 *   answers: ReadonlyArray<{ id: string, reply: string, description: string, avoid: ReadonlyArray<string> }>,
 *   classifier: { classify: Function, minConfidence: number, timeoutMs: number },
 * }} config
 * @param {ReturnType<typeof import('../vocabulary.js').createVocabulary>} vocabulary
 * @returns {import('./types.js').Layer}
 */
export function createClassifierLayer({ answers, classifier }, vocabulary) {
  const { classify, minConfidence, timeoutMs } = classifier;
  const choices = Object.freeze(answers.map((a) => Object.freeze({ id: a.id, description: a.description })));
  const byId = new Map(answers.map((a) => [a.id, a]));
  const avoidOf = new Map(answers.map((a) => [a.id, [...vocabulary.contentTokens(a.avoid.join(' '))]]));

  return {
    name: 'classifier',
    async run({ message, context, signal }) {
      const out = await withTimeout(
        'classifier',
        (s) => classify({ message, choices, context, signal: s }),
        timeoutMs,
        signal,
      );
      if (out === null || typeof out !== 'object' || Array.isArray(out)) {
        return { outcome: 'error', reason: 'classifier must return { choice, confidence }' };
      }
      // A classifier that reports token usage (the Claude adapter does) gets it
      // into the trace on every outcome, so a logger can count what layer 3
      // costs on the turns it answers and on the ones it passes on.
      const { choice, confidence, usage } = out;
      const extra = usage === undefined ? {} : { usage };
      const step = (fields) => ({ ...fields, ...extra });
      if (choice === null || choice === undefined) return step({ outcome: 'miss', reason: 'classifier abstained' });
      if (typeof choice !== 'string') {
        return step({ outcome: 'error', reason: `choice must be an answer id or null, got ${typeof choice}` });
      }
      if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) {
        return step({
          outcome: 'error',
          reason: `confidence must be a number between 0 and 1, got ${String(confidence)}`,
        });
      }
      const answer = byId.get(choice);
      if (!answer) {
        return step({ outcome: 'miss', reason: `unknown choice "${String(choice)}"`, confidence: round(confidence) });
      }
      // The same guard as layer 2: an answer's avoid words veto it here too.
      const vetoed = vocabulary.avoidHit(vocabulary.contentTokens(message), avoidOf.get(choice));
      if (vetoed) {
        return step({
          outcome: 'miss',
          reason: `${choice} vetoed by avoid word "${vetoed}"`,
          confidence: round(confidence),
        });
      }
      if (confidence < minConfidence) {
        return step({
          outcome: 'miss',
          reason: `${choice} at ${round(confidence)}, below minConfidence ${minConfidence}`,
          confidence: round(confidence),
        });
      }
      return step({
        outcome: 'hit',
        answerId: answer.id,
        reply: answer.reply,
        reason: `${choice} at ${round(confidence)}`,
        confidence: round(confidence),
      });
    },
  };
}
