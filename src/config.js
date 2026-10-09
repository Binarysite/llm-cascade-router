import { normalize } from './normalize.js';
import { createVocabulary } from './vocabulary.js';

/**
 * Defaults for the tunable knobs. They are starting points picked for the
 * bundled example, not values measured on real traffic: run the benchmark on
 * your own messages and adjust. The classifier timeout leaves room for one
 * HTTP call to a small model; a local classifier can use far less.
 */
export const DEFAULTS = Object.freeze({
  score: Object.freeze({ minScore: 0.5, minMargin: 0.1, maxTokens: 12, typoTolerance: true }),
  classifier: Object.freeze({ minConfidence: 0.8, timeoutMs: 1000 }),
  llm: Object.freeze({ timeoutMs: 10_000 }),
});

const TOP_LEVEL = new Set(['answers', 'synonyms', 'stopwords', 'score', 'classifier', 'llm', 'fallback', 'onResult']);
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

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isUnit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

/**
 * Check a raw config and return a normalized copy with defaults filled in.
 * The result is itself a valid config: validating it again returns an equal one.
 * Setup is the one place this library throws: a bad config should fail at
 * boot, not on the first customer message.
 * @param {any} raw
 * @returns {any} the normalized config (frozen)
 */
export function validateConfig(raw) {
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

  const vocabulary = createVocabulary({ synonyms, stopwords, typoTolerance: score.typoTolerance });
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
    fallback: raw.fallback,
    onResult: raw.onResult ?? null,
  });
}

/**
 * An avoid word that (after synonyms and typo tolerance) equals a word of the
 * answer's own phrases would veto the answer on its own questions. Easy to do
 * by accident with a synonym list, so it fails at setup instead.
 * @param {ReadonlyArray<{ id: string, phrases: ReadonlyArray<string>, avoid: ReadonlyArray<string> }>} answers
 * @param {ReturnType<typeof createVocabulary>} vocabulary
 * @param {string[]} problems
 */
function checkAvoidAgainstPhrases(answers, vocabulary, problems) {
  for (const a of answers) {
    const own = vocabulary.contentTokens(a.phrases.join(' '));
    for (const word of a.avoid) {
      const clash = [...vocabulary.contentTokens(word)].find((t) => vocabulary.inQuery(own, t));
      if (clash) problems.push(`answer "${a.id}": avoid word "${word}" matches "${clash}" in its own phrases`);
    }
  }
}

function validateAnswers(list, problems) {
  if (!Array.isArray(list) || list.length === 0) {
    problems.push('answers must be a non-empty array');
    return [];
  }
  const ids = new Set();
  const owners = new Map(); // normalized phrase -> answer id
  return list.map((a, i) => {
    const at = `answers[${i}]`;
    if (!isObject(a)) {
      problems.push(`${at} must be an object`);
      return null;
    }
    for (const key of Object.keys(a)) {
      if (!['id', 'reply', 'phrases', 'avoid', 'description'].includes(key)) {
        problems.push(`${at}: unknown key "${key}"`);
      }
    }
    if (!isText(a.id) || !ID.test(a.id)) problems.push(`${at}.id must match ${ID}`);
    else if (ids.has(a.id)) problems.push(`${at}.id "${a.id}" is duplicated`);
    else ids.add(a.id);
    if (!isText(a.reply)) problems.push(`${at}.reply must be a non-empty string`);
    if (a.description !== undefined && !isText(a.description)) {
      problems.push(`${at}.description must be a non-empty string when given`);
    }

    const phrases = textList(a.phrases, `${at}.phrases`, problems, { required: true });
    for (const p of phrases) {
      const n = normalize(p);
      if (!n) {
        problems.push(`${at}.phrases: "${p}" is empty after normalization`);
        continue;
      }
      const owner = owners.get(n);
      if (owner && owner !== a.id) {
        problems.push(`${at}.phrases: "${p}" also belongs to "${owner}", an exact match would be ambiguous`);
      }
      owners.set(n, a.id);
    }
    const avoid = textList(a.avoid, `${at}.avoid`, problems, { required: false });
    return Object.freeze({
      id: a.id,
      reply: a.reply,
      phrases: Object.freeze(phrases),
      avoid: Object.freeze(avoid),
      description: a.description ?? phrases[0],
    });
  }).filter(Boolean);
}

function textList(value, at, problems, { required }) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0)) {
    problems.push(`${at} must be ${required ? 'a non-empty' : 'an'} array of strings`);
    return [];
  }
  const bad = value.filter((v) => !isText(v));
  if (bad.length) problems.push(`${at} must contain only non-empty strings`);
  return value.filter(isText);
}

function validateSynonyms(value, problems) {
  if (value === undefined) return Object.freeze({});
  if (!isObject(value)) {
    problems.push('synonyms must be an object of { canonical: [variants] }');
    return Object.freeze({});
  }
  /** @type {Record<string, string[]>} */
  const out = {};
  const groupOf = new Map(); // normalized word -> canonical of the group that claimed it
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
    const list = textList(variants, at, problems, { required: true });
    for (const v of list) {
      if (normalize(v).includes(' ')) problems.push(`${at}: "${v}" must be a single word`);
      claim(v, canonical, at);
    }
    out[canonical] = list;
  }
  return Object.freeze(out);
}

function validateStopwords(value, problems) {
  if (value === undefined) return Object.freeze([]);
  return Object.freeze(textList(value, 'stopwords', problems, { required: false }));
}

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
  return Object.freeze(out);
}

// null is accepted like undefined, so `classifier: cond ? {...} : null` works and
// validateConfig(validateConfig(c)) gives the same config back.
function validateClassifier(value, problems) {
  if (value == null) return null;
  if (!isObject(value)) {
    problems.push('classifier must be an object with a classify function');
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!['classify', 'minConfidence', 'timeoutMs'].includes(key)) problems.push(`classifier: unknown key "${key}"`);
  }
  const out = { ...DEFAULTS.classifier, ...value };
  if (typeof out.classify !== 'function') problems.push('classifier.classify must be a function');
  if (!isUnit(out.minConfidence)) problems.push('classifier.minConfidence must be a number between 0 and 1');
  if (!isPositiveInt(out.timeoutMs)) problems.push('classifier.timeoutMs must be a positive integer (ms)');
  return Object.freeze(out);
}

function validateLlm(value, problems) {
  if (value == null) return null;
  if (!isObject(value)) {
    problems.push('llm must be an object with a generate function');
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!['generate', 'timeoutMs'].includes(key)) problems.push(`llm: unknown key "${key}"`);
  }
  const out = { ...DEFAULTS.llm, ...value };
  if (typeof out.generate !== 'function') problems.push('llm.generate must be a function');
  if (!isPositiveInt(out.timeoutMs)) problems.push('llm.timeoutMs must be a positive integer (ms)');
  return Object.freeze(out);
}
