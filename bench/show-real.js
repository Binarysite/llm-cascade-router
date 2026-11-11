#!/usr/bin/env node
// Print a committed real-model report (bench/real.js) as a table, without calling anything.
//   node bench/show-real.js [reports/real-deepseek.json]
import { readFile } from 'node:fs/promises';

const file = process.argv[2] ?? 'reports/real-deepseek.json';
const r = JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const banks = [['in-sample', r.banks.inSample], ['held-out', r.banks.heldOut]];
const pct = (n, of) => `${((100 * n) / of).toFixed(1)}%`;
const share = (s) => `${s.answeredWithoutMainLlm}/${s.total} (${pct(s.answeredWithoutMainLlm, s.total)})`;
const lat = (l) => `${Math.round(l.p50)} / ${l.p95 === null ? `max ${Math.round(l.max)}` : Math.round(l.p95)} ms`;
/** @type {Array<[string, (b: any) => string]>} */
const rows = [
  ['wrong fixed answers', (b) => `${b.realModel.fixedAnswers.wrong} of ${b.realModel.fixedAnswers.given}`],
  ['  precision, 95% Wilson', (b) => {
    const f = b.realModel.fixedAnswers;
    const [lo, hi] = f.interval95.map((x) => (100 * x).toFixed(1));
    return `${pct(f.right, f.given)} (${lo} to ${hi})`;
  }],
  ['right fixed answers', (b) => String(b.realModel.fixedAnswers.right)],
  ['escalated (cost a call)', (b) => String(b.realModel.escalated.length)],
  ['answered without the LLM', (b) => share(b.realModel)],
  ['  with the keyword mock', (b) => share(b.keywordMock)],
  ['  with no classifier', (b) => share(b.withoutClassifier)],
  ['  McNemar p, model vs mock', (b) => String(b.realModel.versusKeywordMock.answeredWithoutMainLlm.mcnemarP)],
  ['classifier calls', (b) => String(b.realModel.calls)],
  ['  answers right / wrong', (b) => `${b.realModel.classifierRight} / ${b.realModel.classifierWrong}`],
  ['  unknown ids / errors', (b) => `${b.realModel.unknownChoices} / ${b.realModel.errors}`],
  ['latency p50 / p95', (b) => lat(b.realModel.latencyMs)],
  ['  added on escalated turns', (b) => lat(b.realModel.escalatedLatencyMs)],
  ['tokens prompt / completion', (b) => `${b.realModel.tokens.prompt} / ${b.realModel.tokens.completion}`],
  ['cost, USD (upper bound)', (b) => b.realModel.costUsd.toFixed(4)],
];
console.log(`${r.model} in layer 3 (served: ${r.servedModels.join(', ')}), ${r.date.slice(0, 10)}, ${file}`);
console.log('');
console.log(`${''.padEnd(28)}${banks.map(([n, b]) => `${n} (${b.realModel.total})`.padEnd(26)).join('')}`.trimEnd());
for (const [label, f] of rows) {
  console.log(`${label.padEnd(28)}${banks.map(([, b]) => f(b).padEnd(26)).join('')}`.trimEnd());
}
console.log('');
console.log(`total cost USD ${r.totalCostUsd}; prices: ${r.prices.source}, fetched ${r.prices.fetched}`);
