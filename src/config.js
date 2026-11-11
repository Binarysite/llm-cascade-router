import { normalize } from './normalize.js';
import { createVocabulary } from './vocabulary.js';

/** @typedef {import('../index.js').NormalizedConfig} NormalizedConfig */
/** @typedef {import('../index.js').NormalizedAnswer} NormalizedAnswer */

/**
 * Defaults for the tunable knobs: starting points for the bundled example, not
 * values measured on real traffic. The classifier timeout leaves room for one
 * HTTP call to a small model.
 */
export const DEFAULTS = Object.freeze({
  score: Object.freeze({ minScore: 0.5, minMargin: 0.1, maxTokens: 12, typoTolerance: true }),
  classifier: Object.freeze({ minConfidence: 0.8, timeoutMs: 1000 }),
  llm: Object.freeze({ timeoutMs: 10_000 }),
});

/** setTimeout clamps anything above this to 1 ms, which would time out every call. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

const TOP_LEVEL = new Set(['answers', 'synonyms', 'stopwords', 'score', 'classifier', 'llm', 'fallback', 'onResult']);
const ANSWER_KEYS = new Set(['id', 'reply', 'phrases', 'avoid', 'avoidTypos', 'description']);
const SCORE_KEYS = new Set(Object.keys(DEFAULTS.score));
const ID = /^[a-z0-9][a-z0-9_.-]*$/i;

/** Thrown by createRouter when the config is invalid. Lists every problem, not just the first. */
export class RouterConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`invalid router config:\n  - ${problems.join('\n  - ')}`);
    this.name = 'RouterConfigError';
    this.problems = problems;
  }
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v @returns {v is string} */
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is number} */
const isUnit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
/** @param {unknown} v @returns {v is number} */
const isPositiveInt = (v) => Number.isInteger(v) && /** @type {number} */ (v) > 0;
/** @param {unknown} v @returns {v is number} */
const isTimeout = (v) => isPositiveInt(v) && v <= MAX_TIMEOUT_MS;

/**
 * Check a raw config and return a frozen, normalized copy with defaults filled
 * in. The result is itself a valid config: validating it again returns an
 * equal one. Setup is the one place this library throws, so a bad config fails
 * at boot, not on the first customer message.
 * @param {unknown} raw
 * @returns {NormalizedConfig}
 */
export function validateConfig(raw) {
  /** @type {string[]} */
  const problems = [];
  if (!isObject(raw)) throw new RouterConfigError(['config must be an object']);

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL.has(key)) problems.push(`unknown key "${key}"`);
  }

  const answers = validateAnswers(raw.answers, problems);
  const synonyms = validateSynonyms(raw.synonyms, problems);
  const stopwords = validateStopwords(raw.stopwords, problems);
  const score = validateScore(raw.score, problems);
  const classifier = validateClassifier(raw.classifier, problems);
  const llm = validateLlm(raw.llm, problems);

  const stop = new Set(stopwords.map(normalize));
  for (const a of answers) {
    for (const word of a.avoid) {
      if (stop.has(normalize(word))) {
        problems.push(`answer "${a.id}": avoid word "${word}" is also a stopword, so it would never match`);
      }
    }
  }

  const vocabulary = createVocabulary({ synonyms, stopwords, typoTolerance: score.typoTolerance, answers });
  checkAvoidAgainstPhrases(answers, vocabulary, problems);

  if (!isText(raw.fallback)) problems.push('fallback must be a non-empty string');
  if (raw.onResult != null && typeof raw.onResult !== 'function') {
    problems.push('onResult must be a function');
  }

  if (problems.length) throw new RouterConfigError(problems);
  return Object.freeze({
    answers,
    synonyms,
    stopwords,
    score,
    classifier,
    llm,
    fallback: /** @type {string} */ (raw.fallback),
    onResult: /** @type {NormalizedConfig['onResult']} */ (raw.onResult ?? null),
  });
}

/**
 * An avoid word that (through synonyms, or a typo when the answer opts in)
 * appears in one of the answer's own phrases would veto the answer on its own
 * questions. Easy to do by accident with a synonym list, so it fails at setup.
 * @param {ReadonlyArray<NormalizedAnswer>} answers
 * @param {ReturnType<typeof createVocabulary>} vocabulary
 * @param {string[]} problems
 */
function checkAvoidAgainstPhrases(answers, vocabulary, problems) {
  for (const a of answers) {
    for (const phrase of a.phrases) {
      const word = vocabulary.vetoOf(a.id, vocabulary.avoidWords(normalize(phrase).split(' ')));
      if (word) problems.push(`answer "${a.id}": avoid word "${word}" matches its own phrase "${phrase}"`);
    }
  }
}

/**
 * @param {unknown} list
 * @param {string[]} problems
 * @returns {ReadonlyArray<NormalizedAnswer>}
 */
function validateAnswers(list, problems) {
  if (!Array.isArray(list) || list.length === 0) {
    problems.push('answers must be a non-empty array');
    return Object.freeze([]);
  }
  const ids = new Set();
  const owners = new Map(); // normalized phrase -> answer id
  /** @type {NormalizedAnswer[]} */
  const out = [];
  list.forEach((a, i) => {
    const at = `answers[${i}]`;
    if (!isObject(a)) {
      problems.push(`${at} must be an object`);
      return;
    }
    for (const key of Object.keys(a)) {
      if (!ANSWER_KEYS.has(key)) problems.push(`${at}: unknown key "${key}"`);
    }
    const id = isText(a.id) && ID.test(a.id) ? a.id : null;
    if (id === null) problems.push(`${at}.id must match ${ID}`);
    else if (ids.has(id)) problems.push(`${at}.id "${id}" is duplicated`);
    else ids.add(id);
    if (!isText(a.reply)) problems.push(`${at}.reply must be a non-empty string`);
    if (a.description !== undefined && !isText(a.description)) {
      problems.push(`${at}.description must be a non-empty string when given`);
    }

    const phrases = textList(a.phrases, `${at}.phrases`, problems, true);
    for (const p of phrases) {
      const n = normalize(p);
      if (!n) {
        problems.push(`${at}.phrases: "${p}" is empty after normalization`);
        continue;
      }
      const owner = owners.get(n);
      if (owner && owner !== id) {
        problems.push(`${at}.phrases: "${p}" also belongs to "${owner}", an exact match would be ambiguous`);
      }
      owners.set(n, id);
    }
    const avoid = textList(a.avoid, `${at}.avoid`, problems, false);
    for (const word of avoid) {
      const n = normalize(word);
      if (!n) problems.push(`${at}.avoid: "${word}" is empty after normalization`);
      else if (n.includes(' ')) problems.push(`${at}: avoid word "${word}" must be a single word`);
    }
    if (a.avoidTypos !== undefined && typeof a.avoidTypos !== 'boolean') {
      problems.push(`${at}.avoidTypos must be a boolean`);
    }
    out.push(Object.freeze({
      id: id ?? '',
      reply: isText(a.reply) ? a.reply : '',
      phrases: Object.freeze(phrases),
      avoid: Object.freeze(avoid),
      avoidTypos: a.avoidTypos === true,
      description: isText(a.description) ? a.description : (phrases[0] ?? ''),
    }));
  });
  return Object.freeze(out);
}

/**
 * @param {unknown} value
 * @param {string} at
 * @param {string[]} problems
 * @param {boolean} required
 * @returns {string[]}
 */
function textList(value, at, problems, required) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0)) {
    problems.push(`${at} must be ${required ? 'a non-empty' : 'an'} array of strings`);
    return [];
  }
  if (!value.every(isText)) problems.push(`${at} must contain only non-empty strings`);
  return value.filter(isText);
}

/**
 * @param {unknown} value
 * @param {string[]} problems
 * @returns {NormalizedConfig['synonyms']}
 */
function validateSynonyms(value, problems) {
  // A null prototype keeps a "__proto__" group (possible from JSON.parse) as an ordinary key.
  /** @type {Record<string, ReadonlyArray<string>>} */
  const out = Object.create(null);
  if (value === undefined) return Object.freeze(out);
  if (!isObject(value)) {
    problems.push('synonyms must be an object of { canonical: [variants] }');
    return Object.freeze(out);
  }
  const groupOf = new Map(); // normalized word -> canonical of the group that claimed it
  /** @param {string} word @param {string} canonical @param {string} at */
  const claim = (word, canonical, at) => {
    const n = normalize(word);
    const other = groupOf.get(n);
    if (other !== undefined && other !== canonical) {
      problems.push(`${at}: "${word}" is also in synonyms.${other}; a word can belong to one group only`);
    }
    groupOf.set(n, canonical);
  };
  for (const [canonical, variants] of Object.entries(value)) {
    const at = `synonyms.${canonical}`;
    if (normalize(canonical).includes(' ') || !normalize(canonical)) {
      problems.push(`${at}: the canonical form must be a single word`);
    }
    claim(canonical, canonical, at);
    const list = textList(variants, at, problems, true);
    for (const v of list) {
      if (normalize(v).includes(' ')) problems.push(`${at}: "${v}" must be a single word`);
      claim(v, canonical, at);
    }
    out[canonical] = Object.freeze(list);
  }
  return Object.freeze(out);
}

/**
 * @param {unknown} value
 * @param {string[]} problems
 * @returns {ReadonlyArray<string>}
 */
function validateStopwords(value, problems) {
  if (value === undefined) return Object.freeze([]);
  return Object.freeze(textList(value, 'stopwords', problems, false));
}

/**
 * @param {unknown} value
 * @param {string[]} problems
 * @returns {NormalizedConfig['score']}
 */
function validateScore(value, problems) {
  if (value === undefined) return DEFAULTS.score;
  if (!isObject(value)) {
    problems.push('score must be an object');
    return DEFAULTS.score;
  }
  for (const key of Object.keys(value)) {
    if (!SCORE_KEYS.has(key)) problems.push(`score: unknown key "${key}"`);
  }
  const out = { ...DEFAULTS.score, ...value };
  if (!isUnit(out.minScore)) problems.push('score.minScore must be a number between 0 and 1');
  if (!isUnit(out.minMargin)) problems.push('score.minMargin must be a number between 0 and 1');
  if (!isPositiveInt(out.maxTokens)) problems.push('score.maxTokens must be a positive integer');
  if (typeof out.typoTolerance !== 'boolean') problems.push('score.typoTolerance must be a boolean');
  return Object.freeze(/** @type {NormalizedConfig['score']} */ (out));
}

/**
 * The shared shape of the two injected slots. null is accepted like undefined,
 * so `classifier: cond ? {...} : null` works and a normalized config validates again.
 * @param {unknown} value
 * @param {string[]} problems
 * @param {{ name: string, fn: string, keys: string[], defaults: Record<string, number> }} spec
 * @returns {Record<string, unknown> | null}
 */
function validateSlot(value, problems, { name, fn, keys, defaults }) {
  if (value == null) return null;
  if (!isObject(value)) {
    problems.push(`${name} must be an object with a ${fn} function`);
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) problems.push(`${name}: unknown key "${key}"`);
  }
  const out = { ...defaults, ...value };
  if (typeof out[fn] !== 'function') problems.push(`${name}.${fn} must be a function`);
  if (!isTimeout(out.timeoutMs)) {
    problems.push(`${name}.timeoutMs must be a positive integer (ms) up to ${MAX_TIMEOUT_MS}`);
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {string[]} problems
 * @returns {NormalizedConfig['classifier']}
 */
function validateClassifier(value, problems) {
  const out = validateSlot(value, problems, {
    name: 'classifier', fn: 'classify', keys: ['classify', 'minConfidence', 'timeoutMs'], defaults: DEFAULTS.classifier,
  });
  if (out === null) return null;
  if (!isUnit(out.minConfidence)) problems.push('classifier.minConfidence must be a number between 0 and 1');
  return Object.freeze(/** @type {NonNullable<NormalizedConfig['classifier']>} */ (out));
}

/**
 * @param {unknown} value
 * @param {string[]} problems
 * @returns {NormalizedConfig['llm']}
 */
function validateLlm(value, problems) {
  const out = validateSlot(value, problems, {
    name: 'llm', fn: 'generate', keys: ['generate', 'timeoutMs'], defaults: DEFAULTS.llm,
  });
  return out === null ? null : Object.freeze(/** @type {NonNullable<NormalizedConfig['llm']>} */ (out));
}
