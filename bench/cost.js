#!/usr/bin/env node
// Dollars per 1,000 turns and latency per turn for each configuration of the
// CLINC150 model run (reports/clinc150-deepseek.json), for a main model you
// describe. The classifier's cost and latency are the measured ones; the main
// model's price, tokens and latency are your inputs, not measurements.
//
//   node bench/cost.js --main-in 1.32 --main-out 3.96 --prompt-tokens 2000 --output-tokens 300 \
//     --main-ms 3000 [--answerable-share 0.3]
//
// --main-in/--main-out   main model price, USD per million input/output tokens
// --prompt-tokens        input tokens of one main-model call (system prompt, tools, history, message)
// --output-tokens        output tokens of one main-model call
// --main-ms              latency of one main-model call, added to every turn that reaches it
// --answerable-share     share of traffic that has a fixed answer; default: the sample's own mix.
//                        Messages are reweighted to it, keeping each group's measured outcomes.
import { readFile } from 'node:fs/promises';

const arg = (/** @type {string} */ name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : undefined;
};
const need = (/** @type {string} */ name) => {
  const v = arg(name);
  if (v === undefined || !Number.isFinite(v) || v < 0) {
    console.error(`--${name} is required (a number >= 0); see the header of bench/cost.js`);
    process.exit(2);
  }
  return v;
};
const mainIn = need('main-in');
const mainOut = need('main-out');
const promptTokens = need('prompt-tokens');
const outputTokens = need('output-tokens');
const mainMs = need('main-ms');

const report = JSON.parse(await readFile(new URL('../reports/clinc150-deepseek.json', import.meta.url), 'utf8'));
const local = JSON.parse(await readFile(new URL('../reports/clinc150.json', import.meta.url), 'utf8'));
// Rows: [test index, label, layers 1-2 decision, model choice, confidence, latency ms, error?]
const expect = report.replies.map((r) => r[1]);

const mainCall = (promptTokens * mainIn + outputTokens * mainOut) / 1e6;
const classifierCall = report.costUsd / report.calls;
const answerable = expect.filter((e) => e !== 'llm').length;
const share = arg('answerable-share') ?? answerable / expect.length;
const weight = expect.map((e) => (e === 'llm' ? (1 - share) / (expect.length - answerable) : share / answerable));

// Per message of the sample: did each configuration call the classifier, and did the turn reach the main model?
const { minScore, minMargin } = report.layers12;
const ids = new Set(local.setup.answers);
const layers12 = report.replies.map((r) => r[2]);
const modelSays = report.replies.map(([, , , choice, confidence]) => (
  typeof choice === 'string' && ids.has(choice) && confidence >= report.minConfidence ? choice : 'llm'));
const configs = {
  'LLM on every message': expect.map(() => ({ classifier: false, main: true })),
  'layers 1-2, then LLM': layers12.map((d) => ({ classifier: false, main: d === 'llm' })),
  'model classifier on every message': modelSays.map((d) => ({ classifier: true, main: d === 'llm' })),
  'cascade: layers 1-2, model in layer 3': layers12.map((d, i) => ({
    classifier: d === 'llm', main: d === 'llm' && modelSays[i] === 'llm' })),
};

/** Weighted nearest-rank percentile. @param {Array<[number, number]>} pairs [value, weight] @param {number} p */
const percentile = (pairs, p) => {
  const s = [...pairs].sort((a, b) => a[0] - b[0]);
  let acc = 0;
  for (const [v, w] of s) {
    acc += w;
    if (acc >= p - 1e-12) return v;
  }
  return s.at(-1)?.[0] ?? 0;
};

console.log(`main model call: USD ${mainCall.toFixed(5)} (${promptTokens} in, ${outputTokens} out `
  + `at ${mainIn} / ${mainOut} `
  + `per M), ${mainMs} ms; classifier call: USD ${classifierCall.toFixed(6)} measured (${report.model})`);
console.log(`traffic with a fixed answer: ${(100 * share).toFixed(1)}% (sample: ${answerable}/${expect.length}); `
  + `layer 2 at minScore ${minScore}, minMargin ${minMargin} (chosen on val)\n`);
const rows = [['configuration', 'USD per 1k turns', 'main calls', 'classifier calls', 'p50 ms', 'p95 ms']];
const perK = {};
for (const [name, turns] of Object.entries(configs)) {
  let main = 0;
  let cls = 0;
  /** @type {Array<[number, number]>} */
  const lat = [];
  turns.forEach((t, i) => {
    const w = weight[i];
    if (t.main) main += w;
    if (t.classifier) cls += w;
    lat.push([(t.classifier ? report.replies[i][5] : 0) + (t.main ? mainMs : 0), w]);
  });
  const usd = 1000 * (main * mainCall + cls * classifierCall);
  perK[name] = { usd, main: 1000 * main, cls: 1000 * cls };
  rows.push([name, usd.toFixed(3), (1000 * main).toFixed(0), (1000 * cls).toFixed(0),
    String(percentile(lat, 0.5)), String(percentile(lat, 0.95))]);
}
const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
for (const r of rows) {
  console.log(r.map((cell, c) => (c ? cell.padStart(widths[c]) : cell.padEnd(widths[c]))).join('  '));
}

const l12 = perK['layers 1-2, then LLM'];
const cascade = perK['cascade: layers 1-2, model in layer 3'];
const saved = l12.main - cascade.main;
const breakEven = saved > 0 ? (cascade.cls * classifierCall) / saved : Infinity;
console.log('');
console.log(`Adding the model in layer 3 to layers 1-2 saves ${saved.toFixed(0)} main calls per 1k turns for `
  + `${cascade.cls.toFixed(0)} classifier calls.`);
console.log(`It loses money when one main call costs less than USD ${breakEven.toFixed(5)} `
  + `(here: USD ${mainCall.toFixed(5)}, so it ${mainCall < breakEven ? 'LOSES' : 'saves'} money).`);
console.log('Wrong fixed answers are not priced here; read them in the CLINC150 table.');
