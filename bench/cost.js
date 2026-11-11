#!/usr/bin/env node
// Dollars per 1,000 turns and latency per turn for each configuration of the
// CLINC150 model run (reports/clinc150-deepseek.json), for a main model you
// describe. The classifier's cost and latency are the measured ones; the main
// model's price, tokens and latency are your inputs, not measurements.
//
//   node bench/cost.js --main-in 1.32 --main-out 3.96 --prompt-tokens 2000 --output-tokens 300 \
//     --main-ms 3000 [--answerable-share 0.3] [--wrong-cost 0.05]
//
// --main-in/--main-out   main model price, USD per million input/output tokens
// --prompt-tokens        input tokens of one main-model call (system prompt, tools, history, message)
// --output-tokens        output tokens of one main-model call
// --main-ms              latency of one main-model call, added to every turn that reaches it
// --answerable-share     share of traffic that has a fixed answer; default: the sample's own mix.
//                        Messages are reweighted to it, keeping each group's measured outcomes.
// --wrong-cost           what one wrong fixed answer costs you, USD (a refund, a support ticket,
//                        a lost customer); default 0, which leaves wrong answers unpriced.
//                        A wrong fixed answer also skips the main call, so it is counted apart.
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
const wrongCost = process.argv.includes('--wrong-cost') ? need('wrong-cost') : 0;

const report = JSON.parse(await readFile(new URL('../reports/clinc150-deepseek.json', import.meta.url), 'utf8'));
const local = JSON.parse(await readFile(new URL('../reports/clinc150.json', import.meta.url), 'utf8'));
// Rows: [test index, label, layers 1-2 decision, model choice, confidence, latency ms, error?]
const expect = report.replies.map((r) => r[1]);

const mainCall = (promptTokens * mainIn + outputTokens * mainOut) / 1e6;
const classifierCall = report.costUsd / report.calls;
const answerable = expect.filter((e) => e !== 'llm').length;
const shareArg = arg('answerable-share');
if (process.argv.includes('--answerable-share') && !(shareArg !== undefined && shareArg >= 0 && shareArg <= 1)) {
  console.error('--answerable-share must be a number from 0 to 1 (the share of traffic that has a fixed answer)');
  process.exit(2);
}
const share = shareArg ?? answerable / expect.length;
const weight = expect.map((e) => (e === 'llm' ? (1 - share) / (expect.length - answerable) : share / answerable));

// Per message of the sample: did each configuration call the classifier, and did the turn reach the main model?
const { minScore, minMargin } = report.layers12;
const ids = new Set(local.setup.answers);
const layers12 = report.replies.map((r) => r[2]);
const modelSays = report.replies.map(([, , , choice, confidence]) => (
  typeof choice === 'string' && ids.has(choice) && confidence >= report.minConfidence ? choice : 'llm'));
const cascadeSays = layers12.map((d, i) => (d === 'llm' ? modelSays[i] : d));
const isWrong = (/** @type {string} */ d, /** @type {number} */ i) => d !== 'llm' && d !== expect[i];
const configs = {
  'LLM on every message': expect.map(() => ({ classifier: false, main: true, wrong: false })),
  'layers 1-2, then LLM': layers12.map((d, i) => ({ classifier: false, main: d === 'llm', wrong: isWrong(d, i) })),
  'model classifier on every message': modelSays.map((d, i) => ({
    classifier: true, main: d === 'llm', wrong: isWrong(d, i) })),
  'cascade: layers 1-2, model in layer 3': cascadeSays.map((d, i) => ({
    classifier: layers12[i] === 'llm', main: d === 'llm', wrong: isWrong(d, i) })),
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
  + `layer 2 at minScore ${minScore}, minMargin ${minMargin} (chosen on val)`);
console.log(`wrong fixed answer: USD ${wrongCost} each (--wrong-cost)${wrongCost ? '' : '; 0 leaves them unpriced'}\n`);
const rows = [['configuration', 'USD per 1k turns', 'main calls', 'classifier calls', 'wrong', 'p50 ms', 'p95 ms']];
const perK = {};
for (const [name, turns] of Object.entries(configs)) {
  let main = 0;
  let cls = 0;
  let wrong = 0;
  /** @type {Array<[number, number]>} */
  const lat = [];
  turns.forEach((t, i) => {
    const w = weight[i];
    if (t.main) main += w;
    if (t.classifier) cls += w;
    if (t.wrong) wrong += w;
    lat.push([(t.classifier ? report.replies[i][5] : 0) + (t.main ? mainMs : 0), w]);
  });
  const usd = 1000 * (main * mainCall + cls * classifierCall + wrong * wrongCost);
  perK[name] = { usd, main: 1000 * main, cls: 1000 * cls, wrong: 1000 * wrong };
  rows.push([name, usd.toFixed(3), (1000 * main).toFixed(0), (1000 * cls).toFixed(0), (1000 * wrong).toFixed(1),
    String(percentile(lat, 0.5)), String(percentile(lat, 0.95))]);
}
const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
for (const r of rows) {
  console.log(r.map((cell, c) => (c ? cell.padStart(widths[c]) : cell.padEnd(widths[c]))).join('  '));
}

const l12 = perK['layers 1-2, then LLM'];
const cascade = perK['cascade: layers 1-2, model in layer 3'];
const saved = l12.main - cascade.main;
// Main calls the model in layer 3 skips by giving a wrong fixed answer (per 1k turns).
let savedWrong = 0;
layers12.forEach((d, i) => {
  if (d === 'llm' && modelSays[i] !== 'llm' && isWrong(modelSays[i], i)) savedWrong += 1000 * weight[i];
});
const addedWrong = cascade.wrong - l12.wrong;
const extra = cascade.cls * classifierCall + addedWrong * wrongCost;
const breakEven = saved > 0 ? extra / saved : Infinity;
console.log('');
console.log(`Adding the model in layer 3 to layers 1-2: ${saved.toFixed(1)} saved calls per 1k turns, `
  + `of which ${savedWrong.toFixed(1)} are wrong answers,`);
console.log(`for ${cascade.cls.toFixed(0)} classifier calls; `
  + `${addedWrong.toFixed(1)} more wrong fixed answers in all.`);
console.log(`It loses money when one main call costs less than USD ${breakEven.toFixed(5)} `
  + `(here: USD ${mainCall.toFixed(5)}, so it ${mainCall < breakEven ? 'LOSES' : 'saves'} money)`
  + `${wrongCost ? `, at USD ${wrongCost} per wrong fixed answer.` : '.'}`);
if (addedWrong > 0) {
  const maxWrong = (saved * mainCall - cascade.cls * classifierCall) / addedWrong;
  console.log(maxWrong > 0
    ? 'At this main-call price it loses money once a wrong fixed answer costs more than '
      + `USD ${maxWrong.toFixed(5)}.`
    : 'At this main-call price it loses money even when wrong fixed answers cost nothing.');
}
