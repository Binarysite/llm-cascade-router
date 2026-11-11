// CLINC150 as a fixed-answer support bench. The 15 intents of the "banking"
// domain get a fixed answer each; the other 135 intents and the out-of-scope
// queries must reach the LLM. Phrases come from the train split only; nothing
// here is derived from the validation or test splits.
import { normalize } from '../../src/index.js';
import { readChecked } from './fetch.js';

export const DOMAIN = 'banking';

/** Written from the intent names and a look at train examples, before any run. */
export const DESCRIPTIONS = {
  freeze_account: 'freeze or block my bank account',
  routing: 'the routing number of my bank account',
  pin_change: 'change the PIN of my bank account',
  bill_due: 'when a bill is due',
  pay_bill: 'pay a bill',
  account_blocked: 'why my bank account is blocked or on hold',
  interest_rate: 'the interest rate on my bank account',
  min_payment: 'the minimum payment due on a bill',
  bill_balance: 'how much a bill is',
  transfer: 'transfer money between accounts',
  order_checks: 'order new checks or checkbooks',
  balance: 'the balance of my bank account',
  spending_history: 'how much I spent on something recently',
  transactions: 'my recent transactions',
  report_fraud: 'report fraud on my account',
};

/** A fixed list of English function words, chosen before any run and never tuned. */
export const STOPWORDS = [
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'i', 'im', 'me', 'my',
  'mine', 'you', 'your', 'we', 'our', 'us', 'it', 'its', 'they', 'them', 'their', 'he', 'she', 'his', 'her', 'to',
  'of', 'for', 'on', 'in', 'at', 'by', 'with', 'from', 'about', 'as', 'and', 'or', 'but', 'if', 'so', 'than',
  'that', 'this', 'these', 'those', 'what', 'whats', 'which', 'who', 'can', 'could', 'will', 'would', 'should',
  'may', 'might', 'must', 'please', 'hi', 'hello', 'hey', 'thanks', 'thank', 'just', 'any', 'some', 'there',
  'here', 'tell', 'know', 'want', 'need', 'id', 'like', 'get', 'have', 'has', 'had',
];

/**
 * @typedef {{ text: string, intent: string, expect: string }} Example
 * `expect` is the answer id (the intent) for the 15 banking intents, 'llm' for everything else.
 */

/** @returns {Promise<{ train: Example[], val: Example[], test: Example[], intents: string[] }>} */
export async function loadClinc() {
  const data = await readChecked('data_full.json');
  const domains = await readChecked('domains.json');
  const intents = [...domains[DOMAIN]].sort();
  const answerable = new Set(intents);
  /** @param {unknown} rows @param {string} split */
  const examples = (rows, split) => {
    if (!Array.isArray(rows)) throw new Error(`${split} is not an array`);
    return rows.map((row, i) => {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'string') {
        throw new Error(`${split}[${i}] is not [text, intent]`);
      }
      return { text: row[0], intent: row[1], expect: answerable.has(row[1]) ? row[1] : 'llm' };
    });
  };
  return {
    train: [...examples(data.train, 'train'), ...examples(data.oos_train, 'oos_train')],
    val: [...examples(data.val, 'val'), ...examples(data.oos_val, 'oos_val')],
    test: [...examples(data.test, 'test'), ...examples(data.oos_test, 'oos_test')],
    intents,
  };
}

/**
 * The router config: one answer per banking intent, its train utterances as
 * phrases. A normalized utterance that appears under two intents is dropped from
 * both, since setup rejects an exact match that would be ambiguous.
 * @param {Example[]} train
 * @param {string[]} intents
 * @param {{ minScore: number, minMargin: number }} score
 */
export function buildConfig(train, intents, score) {
  const owners = new Map();
  for (const ex of train) {
    if (ex.expect === 'llm') continue;
    const n = normalize(ex.text);
    if (!n) continue;
    if (!owners.has(n)) owners.set(n, new Set());
    owners.get(n).add(ex.intent);
  }
  const answers = intents.map((id) => {
    const phrases = [...owners].filter(([, set]) => set.size === 1 && set.has(id)).map(([n]) => n);
    return { id, reply: `[fixed answer: ${id}]`, phrases, description: DESCRIPTIONS[id] };
  });
  return {
    answers,
    stopwords: STOPWORDS,
    score: { ...score, maxTokens: 12 },
    fallback: '[fallback]',
  };
}
