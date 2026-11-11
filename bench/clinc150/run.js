#!/usr/bin/env node
// CLINC150 out-of-scope bench, local configurations only (no network, no key):
// layers 1 and 2; a TF-IDF nearest-neighbour baseline; and the cascade with that
// baseline in layer 3. Thresholds are chosen on the validation split by a rule
// fixed in evaluate.js; the test split is then scored once at those thresholds,
// and the sweep shows the trade-off around them.
//   node bench/clinc150/fetch.js && node bench/clinc150/run.js [--check]
// Writes reports/clinc150.json; --check exits 1 if a fresh run differs from it.
import { readFile, writeFile } from 'node:fs/promises';
import { createRouter } from '../../src/index.js';
import { measure } from '../../src/eval.js';
import { loadClinc, buildConfig, DOMAIN, STOPWORDS } from './setup.js';
import { createNearestNeighbour } from './tfidf.js';
import { score, choose, THRESHOLDS, MARGINS, MIN_PRECISION } from './evaluate.js';
import { COMMIT, FILES } from './fetch.js';

const EPSILON = 1e-9;
const REPORT = new URL('../../reports/clinc150.json', import.meta.url);
const { train, val, test, intents } = await loadClinc();

// One permissive pass per split records what layers 1 and 2 saw; any threshold is then a filter on it.
const permissive = buildConfig(train, intents, { minScore: 0, minMargin: 0 });
const probe = createRouter(permissive);
/** @param {typeof val} split */
async function layers12(split) {
  const out = [];
  for (const ex of split) {
    const r = await probe.route(ex.text);
    const step = r.trace.find((s) => s.layer === 'score');
    out.push({
      exact: r.layer === 'exact' ? r.answerId : null,
      top: r.layer === 'score' ? r.answerId : null,
      score: step?.score ?? 0,
      margin: step?.margin ?? 0,
    });
  }
  return out;
}
const nn = createNearestNeighbour(train, STOPWORDS);
const records = {
  val: { l12: await layers12(val), nn: val.map((ex) => nn.nearest(ex.text)) },
  test: { l12: await layers12(test), nn: test.map((ex) => nn.nearest(ex.text)) },
};

/** @param {{ exact: string | null, top: string | null, score: number, margin: number }} r */
const decideL12 = (r, /** @type {number} */ minScore, /** @type {number} */ minMargin) => r.exact
  ?? (r.top && r.score + EPSILON >= minScore && r.margin + EPSILON >= minMargin ? r.top : 'llm');
/** @param {{ label: string, similarity: number }} r */
const decideNn = (r, /** @type {number} */ min) => (r.label !== 'llm' && r.similarity >= min ? r.label : 'llm');

const decisions = {
  l12: (/** @type {'val' | 'test'} */ s, ms, mm) => records[s].l12.map((r) => decideL12(r, ms, mm)),
  nn: (/** @type {'val' | 'test'} */ s, th) => records[s].nn.map((r) => decideNn(r, th)),
  cascade: (/** @type {'val' | 'test'} */ s, ms, mm, th) => records[s].l12
    .map((r, i) => { const d = decideL12(r, ms, mm); return d === 'llm' ? decideNn(records[s].nn[i], th) : d; }),
};

// Choose on validation.
const l12Grid = THRESHOLDS.flatMap((minScore) => MARGINS.map((minMargin) => ({
  point: { minScore, minMargin }, result: score(val, decisions.l12('val', minScore, minMargin)) })));
const l12 = choose(l12Grid);
const { minScore, minMargin } = l12.point;
const nnPick = choose(THRESHOLDS.map((th) => ({
  point: { minConfidence: th }, result: score(val, decisions.nn('val', th)) })));
const cascadePick = choose(THRESHOLDS.map((th) => ({
  point: { minConfidence: th }, result: score(val, decisions.cascade('val', minScore, minMargin, th)) })));

// Score test once, at the chosen thresholds, through the real router for the two router configurations.
const config = buildConfig(train, intents, { minScore, minMargin });
const bank = test.map(({ text, expect }) => ({ text, expect }));
const routed = async (/** @type {any} */ classifier) => {
  const report = await measure(bank, { build: (slots) => createRouter({
    ...config,
    ...(classifier ? { classifier: { classify: slots.classify, minConfidence: classifier.minConfidence } } : {}),
    llm: { generate: slots.generate },
  }), classify: classifier?.classify ?? null });
  return report.rows.map((r) => r.answerId ?? 'llm');
};
const viaRouter = {
  l12: await routed(null),
  cascade: await routed({ classify: nn.classify, minConfidence: cascadePick.point.minConfidence }),
};
const offline = {
  l12: decisions.l12('test', minScore, minMargin),
  cascade: decisions.cascade('test', minScore, minMargin, cascadePick.point.minConfidence),
};
for (const k of /** @type {const} */ (['l12', 'cascade'])) {
  const diff = offline[k].filter((d, i) => d !== viaRouter[k][i]).length;
  if (diff) throw new Error(`${k}: the offline decision differs from the router on ${diff} test messages`);
}

const nnTh = nnPick.point.minConfidence;
const testResults = {
  'LLM on every message': score(test, test.map(() => 'llm')),
  'layers 1-2, then LLM': score(test, viaRouter.l12),
  'TF-IDF nearest neighbour alone, then LLM': score(test, decisions.nn('test', nnTh)),
  'cascade: layers 1-2, TF-IDF in layer 3, then LLM': score(test, viaRouter.cascade),
};
const pick = ({ answered, wrong, coverageOfAnswerable, wrongPer1000Turns, precision }) => (
  { answered, wrong, coverageOfAnswerable, wrongPer1000Turns, precision });
const report = {
  dataset: {
    name: 'CLINC150 (data_full)',
    source: `https://github.com/clinc/oos-eval/tree/${COMMIT}/data`,
    license: 'CC BY 3.0',
    sha256: FILES,
  },
  setup: {
    answerDomain: DOMAIN,
    answers: intents,
    phrasesPerAnswer: config.answers.map((a) => a.phrases.length),
    stopwords: STOPWORDS.length,
    mustEscalate: 'the 135 intents of the other 9 domains, and the out-of-scope queries',
    splits: { train: train.length, val: val.length, test: test.length },
  },
  selection: {
    rule: `on val: the most fixed answers with precision >= ${MIN_PRECISION}; ties go to the stricter point`,
    layers12: { ...l12.point, rule: l12.rule, val: l12.result },
    tfidf: { ...nnPick.point, rule: nnPick.rule, val: nnPick.result },
    cascadeTfidf: { ...cascadePick.point, rule: cascadePick.rule, val: cascadePick.result },
  },
  test: testResults,
  sweepOnTest: {
    layers12: THRESHOLDS.map((ms) => ({
      minScore: ms, minMargin, ...pick(score(test, decisions.l12('test', ms, minMargin))) })),
    tfidf: THRESHOLDS.map((th) => ({ minConfidence: th, ...pick(score(test, decisions.nn('test', th))) })),
    cascadeTfidf: THRESHOLDS.map((th) => ({
      minConfidence: th, ...pick(score(test, decisions.cascade('test', minScore, minMargin, th))) })),
  },
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const committed = await readFile(REPORT, 'utf8');
  if (committed !== json) {
    console.error('reports/clinc150.json differs from a fresh run');
    process.exit(1);
  }
  console.log('reports/clinc150.json matches a fresh run');
} else {
  await writeFile(REPORT, json);
  console.log(`wrote reports/clinc150.json; chosen on val: minScore ${minScore}, minMargin ${minMargin}, `
    + `TF-IDF ${nnTh}, cascade layer 3 ${cascadePick.point.minConfidence}`);
}
