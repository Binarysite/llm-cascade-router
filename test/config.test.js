import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, validateConfig, RouterConfigError, DEFAULTS } from '../src/index.js';

const minimal = () => ({
  answers: [{ id: 'hours', reply: 'We answer 9 to 5.', phrases: ['what are your hours'] }],
  fallback: 'Someone will get back to you.',
});

/** @param {any} config */
const problemsOf = (config) => {
  try {
    validateConfig(config);
  } catch (err) {
    assert.ok(err instanceof RouterConfigError);
    return err.problems;
  }
  assert.fail('expected RouterConfigError');
};

test('a minimal config gets the documented defaults', () => {
  const cfg = validateConfig(minimal());
  assert.deepEqual(cfg.score, DEFAULTS.score);
  const withClassifier = validateConfig({ ...minimal(), classifier: { classify: async () => null } });
  assert.equal(withClassifier.classifier.timeoutMs, DEFAULTS.classifier.timeoutMs);
  assert.equal(cfg.answers[0].description, 'what are your hours');
  assert.deepEqual(cfg.answers[0].avoid, []);
  assert.ok(Object.isFrozen(cfg));
});

test('every problem is reported at once', () => {
  const problems = problemsOf({
    answers: [
      { id: 'a', reply: '', phrases: [] },
      { id: 'a', reply: 'x', phrases: ['hi'], extra: true },
    ],
    score: { minScore: 2, maxTokens: 0, typo: true },
    fallback: '  ',
    nope: 1,
  });
  for (const fragment of [
    'unknown key "nope"',
    'answers[0].reply',
    'answers[0].phrases',
    'answers[1].id "a" is duplicated',
    'answers[1]: unknown key "extra"',
    'score: unknown key "typo"',
    'score.minScore',
    'score.maxTokens',
    'fallback',
  ]) {
    assert.ok(problems.some((p) => p.includes(fragment)), `missing problem: ${fragment}\n${problems.join('\n')}`);
  }
});

test('the same phrase on two answers is rejected as ambiguous', () => {
  const config = minimal();
  config.answers.push({ id: 'open', reply: 'Open now.', phrases: ['What are your HOURS?'] });
  const problems = problemsOf(config);
  assert.ok(problems.some((p) => p.includes('also belongs to "hours"')));
});

test('a phrase that normalizes to nothing is rejected', () => {
  const config = minimal();
  config.answers[0].phrases.push('?!');
  assert.ok(problemsOf(config).some((p) => p.includes('empty after normalization')));
});

test('synonyms must map one word to single-word variants', () => {
  const problems = problemsOf({ ...minimal(), synonyms: { ship: ['deliver', 'send out'], 'two words': ['x'] } });
  assert.ok(problems.some((p) => p.includes('"send out" must be a single word')));
  assert.ok(problems.some((p) => p.includes('canonical form must be a single word')));
});

test('null classifier, llm and onResult mean "not configured", like undefined', () => {
  const cfg = validateConfig({ ...minimal(), classifier: null, llm: null, onResult: null });
  assert.equal(cfg.classifier, null);
  assert.equal(cfg.llm, null);
  assert.equal(cfg.onResult, null);
});

test('validateConfig is idempotent: a normalized config validates to an equal one', () => {
  const full = {
    ...minimal(),
    synonyms: { hours: ['open', 'opening'] },
    stopwords: ['what', 'are', 'your'],
    classifier: { classify: async () => ({ choice: null, confidence: 0 }) },
    llm: { generate: async () => 'x' },
    onResult: () => {},
  };
  for (const config of [minimal(), full]) {
    const once = validateConfig(config);
    const twice = validateConfig(once);
    assert.deepEqual(twice, once);
    assert.doesNotThrow(() => createRouter(once));
  }
});

test('a word in two synonym groups is rejected instead of silently taking the last one', () => {
  const problems = problemsOf({ ...minimal(), synonyms: { ship: ['delivery', 'send'], cost: ['price', 'Delivery'] } });
  assert.ok(problems.some((p) => p.includes('"Delivery" is also in synonyms.ship')));
  const canonicalReused = problemsOf({ ...minimal(), synonyms: { ship: ['delivery'], delivery: ['courier'] } });
  assert.ok(canonicalReused.some((p) => p.includes('"delivery" is also in synonyms.ship')));
});

test('createRouter throws on a non-object config', () => {
  assert.throws(() => createRouter(null), RouterConfigError);
  assert.throws(() => createRouter([]), RouterConfigError);
});

test('an avoid word that is also a stopword is rejected, since it could never match', () => {
  const config = minimal();
  config.answers[0].avoid = ['not'];
  config.stopwords = ['not', 'the'];
  assert.ok(problemsOf(config).some((p) => p.includes('avoid word "not" is also a stopword')));
});

test('an avoid word that matches the answer\'s own phrases through a synonym fails at setup', () => {
  const config = {
    ...minimal(),
    answers: [{ id: 'cost', reply: 'Free over $35.', phrases: ['what does shipping cost'], avoid: ['charged'] }],
    synonyms: { cost: ['price', 'charge'] },
  };
  assert.throws(() => createRouter(config), /avoid word "charged" matches "cost" in its own phrases/);
  assert.ok(problemsOf(config).some((p) => p.includes('avoid word "charged"')), 'validateConfig catches it too');
});

test('an avoid clash is listed together with the other problems, not after them', () => {
  const problems = problemsOf({
    answers: [
      { id: 'ship', reply: 'Two days.', phrases: ['ship it'], avoid: ['ship'] },
      { id: 'ship', reply: 'Again.', phrases: ['when does it ship out'] },
    ],
    fallback: 'x',
  });
  assert.ok(problems.some((p) => p.includes('"ship" is duplicated')));
  assert.ok(problems.some((p) => p.includes('avoid word "ship" matches')));
});
