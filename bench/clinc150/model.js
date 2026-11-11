#!/usr/bin/env node
// CLINC150 with a real model in layer 3, through the shipped OpenAI-compatible
// adapter, on a seeded random sample of the test split. Each sampled message is
// sent to the model once. "Model alone" applies the router's rule to that reply;
// the cascade is the real router with layers 1 and 2 at the thresholds chosen on
// validation and a layer 3 that replays the reply recorded for the same message,
// so the model is not called twice.
//   DEEPSEEK_API_KEY=... node bench/clinc150/model.js [--sample 2000] [--max-usd 0.4] [--concurrency 8]
// Writes reports/clinc150-deepseek.json. The key is never printed or written.
import { readFile, writeFile } from 'node:fs/promises';
import { createRouter } from '../../src/index.js';
import { measure, latencySummary, mcnemarExact } from '../../src/eval.js';
import { createOpenAiCompatibleClassifier } from '../../src/adapters/openai-compatible.js';
import { loadClinc, buildConfig } from './setup.js';
import { score, THRESHOLDS } from './evaluate.js';
import { PROVIDERS, costUsd } from '../providers.js';
import { safeErrorLabel } from '../safe-error.js';

const arg = (/** @type {string} */ name, /** @type {string} */ dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const SEED = 150;
const sampleSize = Number(arg('sample', '2000'));
const maxUsd = Number(arg('max-usd', '0.4'));
const concurrency = Number(arg('concurrency', '8'));
const minConfidence = 0.8; // the library default, not tuned: no validation calls were made
const spec = PROVIDERS.deepseek;
const model = arg('model', spec.defaultModel);
const key = process.env[spec.keyEnv];
if (!key) throw new Error(`set ${spec.keyEnv}`);

const local = JSON.parse(await readFile(new URL('../../reports/clinc150.json', import.meta.url), 'utf8'));
const { minScore, minMargin } = local.selection.layers12;
const { train, test, intents } = await loadClinc();
const config = buildConfig(train, intents, { minScore, minMargin });

// A seeded Fisher-Yates shuffle of the test indexes (mulberry32).
let a = SEED;
const rand = () => {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const order = test.map((_, i) => i);
for (let i = order.length - 1; i > 0; i -= 1) {
  const j = Math.floor(rand() * (i + 1));
  [order[i], order[j]] = [order[j], order[i]];
}
const indexes = order.slice(0, sampleSize).sort((x, y) => x - y);
const sample = indexes.map((i) => test[i]);

const classify = createOpenAiCompatibleClassifier({
  apiKey: key, model, baseUrl: spec.baseUrl, extraBody: spec.extraBody, maxTokens: 60,
  instructions: [
    "You route a bank's customer messages to prepared answers.",
    'Pick the one answer that matches what the message asks for, or the no-answer value if none does.',
    'Reply with a JSON object only: {"choice": "<answer id or the no-answer value>", "confidence": <0 to 1>}.',
    'confidence is your probability that the chosen answer is right.',
  ].join(' '),
});
const choices = config.answers.map((x) => ({ id: x.id, description: x.description }));
const ids = new Set(choices.map((c) => c.id));

/** @type {Array<{ choice: unknown, confidence: unknown, ms: number, error?: string }>} */
const replies = new Array(sample.length);
const usages = [];
let spent = 0;
let stopped = false;
let next = 0;
async function worker() {
  while (next < sample.length && !stopped) {
    const i = next;
    next += 1;
    const t0 = performance.now();
    try {
      const r = await classify({ message: sample[i].text, choices, signal: AbortSignal.timeout(30_000) });
      usages.push(r.usage);
      spent += costUsd(spec, [r.usage]);
      if (spent > maxUsd) stopped = true;
      replies[i] = { choice: r.choice, confidence: r.confidence, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      replies[i] = { choice: null, confidence: 0, ms: Math.round(performance.now() - t0), error: safeErrorLabel(e) };
    }
    if ((i + 1) % 250 === 0) console.error(`${i + 1}/${sample.length}, USD ${spent.toFixed(4)}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
if (stopped) {
  console.error(`budget reached at USD ${spent.toFixed(4)}; no report written`);
  process.exit(1);
}

/** The router's layer 3 rule applied to a recorded reply. */
const modelDecision = (/** @type {typeof replies[number]} */ r, /** @type {number} */ min) => (
  typeof r.choice === 'string' && ids.has(r.choice) && typeof r.confidence === 'number' && r.confidence >= min
    ? r.choice : 'llm');

// The real router: layers 1 and 2, then a layer 3 that replays the recorded reply.
// Messages are routed in sample order, so repeated texts take their recorded replies in order.
/** @type {Map<string, typeof replies>} */
let byText = new Map();
const replay = async ({ message }) => {
  const r = byText.get(message)?.shift();
  if (r?.error) throw new Error(r.error);
  return { choice: /** @type {any} */ (r?.choice ?? null), confidence: /** @type {any} */ (r?.confidence ?? 0) };
};
const run = async (/** @type {boolean} */ withModel, min = minConfidence) => {
  byText = new Map();
  sample.forEach((ex, i) => byText.set(ex.text, [...(byText.get(ex.text) ?? []), replies[i]]));
  const report = await measure(sample.map(({ text, expect }) => ({ text, expect })), {
    build: (slots) => createRouter({
      ...config,
      ...(withModel ? { classifier: { classify: slots.classify, minConfidence: min, timeoutMs: 1000 } } : {}),
      llm: { generate: slots.generate },
    }),
    classify: withModel ? replay : null,
  });
  return report.rows.map((r) => r.answerId ?? 'llm');
};
const layers12 = await run(false);
const cascade = await run(true);
const alone = replies.map((r) => modelDecision(r, minConfidence));
const offlineCascade = layers12.map((d, i) => (d === 'llm' ? alone[i] : d));
const diff = offlineCascade.filter((d, i) => d !== cascade[i]).length;
if (diff) throw new Error(`the cascade differs from the offline rule on ${diff} messages`);

const rightOf = (/** @type {string[]} */ d) => d.map((x, i) => x !== 'llm' && x === sample[i].expect);
const paired = (/** @type {boolean[]} */ x, /** @type {boolean[]} */ y) => {
  const b = x.filter((v, i) => v && !y[i]).length;
  const c = x.filter((v, i) => !v && y[i]).length;
  return { onlyFirst: b, onlySecond: c, mcnemarP: Number(mcnemarExact(b, c).toFixed(4)) };
};
const pick = ({ answered, wrong, coverageOfAnswerable, wrongPer1000Turns, precision }) => (
  { answered, wrong, coverageOfAnswerable, wrongPer1000Turns, precision });
const tokens = spec.tokens(usages);
const latencies = replies.filter((r) => !r.error).map((r) => r.ms);
const report = {
  provider: 'deepseek',
  model,
  date: new Date().toISOString(),
  sample: {
    seed: SEED, size: sample.length, of: test.length, answerable: sample.filter((e) => e.expect !== 'llm').length,
  },
  minConfidence,
  layers12: { minScore, minMargin },
  calls: replies.length,
  errors: replies.filter((r) => r.error).length,
  errorSamples: [...new Set(replies.filter((r) => r.error).map((r) => r.error))].slice(0, 3),
  unknownChoices: replies.filter((r) => typeof r.choice === 'string' && !ids.has(r.choice)).length,
  latencyMs: latencySummary(latencies),
  tokens,
  costUsd: Number(costUsd(spec, usages).toFixed(6)),
  prices: spec.prices,
  results: {
    'layers 1-2, then LLM': score(sample, layers12),
    'model on every message, then LLM': score(sample, alone),
    'cascade: layers 1-2, model in layer 3, then LLM': score(sample, cascade),
  },
  pairedRight: {
    'cascade with model vs layers 1-2': paired(rightOf(cascade), rightOf(layers12)),
    'cascade with model vs model alone': paired(rightOf(cascade), rightOf(alone)),
  },
  sweep: {
    modelAlone: THRESHOLDS.map((m) => ({
      minConfidence: m, ...pick(score(sample, replies.map((r) => modelDecision(r, m)))),
    })),
    cascadeModel: THRESHOLDS.map((m) => ({
      minConfidence: m,
      ...pick(score(sample, layers12.map((d, i) => (d === 'llm' ? modelDecision(replies[i], m) : d)))),
    })),
  },
  // Per sampled message: [test index, label, layers 1-2 decision, model choice, confidence, latency ms, error?].
  // Texts are in the dataset; the label is an answer id or 'llm'.
  rowFormat: ['testIndex', 'expect', 'layers12', 'choice', 'confidence', 'ms', 'error?'],
  replies: replies.map((r, i) => [
    indexes[i], sample[i].expect, layers12[i], r.choice, r.confidence, r.ms, ...(r.error ? [r.error] : []),
  ]),
};
const json = `${JSON.stringify(report, null, 1)}\n`;
if (json.includes(key)) throw new Error('the report would contain the API key; not written');
await writeFile(new URL('../../reports/clinc150-deepseek.json', import.meta.url), json);
console.log(`${replies.length} calls, ${report.errors} errors, ${report.unknownChoices} unknown ids, `
  + `USD ${report.costUsd}`);
for (const [name, r] of Object.entries(report.results)) {
  console.log(`${name}: ${r.right} right, ${r.wrong} wrong, precision ${r.precision}, `
    + `coverage ${r.coverageOfAnswerable}`);
}
