#!/usr/bin/env node
// Print the committed CLINC150 reports as tables, without the dataset or a network call.
//   node bench/clinc150/show.js
import { readFile } from 'node:fs/promises';

/** @param {string} f */
const read = async (f) => JSON.parse(await readFile(new URL(`../../reports/${f}`, import.meta.url), 'utf8'));
const local = await read('clinc150.json');
const model = await read('clinc150-deepseek.json');
const pct = (/** @type {number} */ x) => `${(100 * x).toFixed(1)}%`;

/** @param {Record<string, any>} results */
function table(results) {
  const rows = [['', 'wrong', '(intent / must-escalate)', 'right', 'precision, 95% Wilson', 'to LLM']];
  for (const [name, r] of Object.entries(results)) {
    const [lo, hi] = r.precisionInterval95;
    rows.push([
      name,
      String(r.wrong),
      `(${r.wrongIntent} / ${r.wrongMustEscalate})`,
      `${r.right}/${r.answerable}`,
      r.precision === null ? '-' : `${pct(r.precision)} (${pct(lo)} to ${pct(hi)})`,
      pct(r.escalationRate),
    ]);
  }
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
  return rows.map((row) => row.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c])))
    .join('  ').trimEnd());
}

const { splits } = local.setup;
const t = local.test['LLM on every message'];
const s = local.selection;
console.log(`CLINC150 test split, ${t.n} messages: ${t.answerable} banking questions with a fixed answer,`);
console.log(`${t.n - t.answerable} that must reach the LLM (other domains and out-of-scope). Train ${splits.train}, `
  + `val ${splits.val}.`);
console.log(`Thresholds chosen on val, the most fixed answers with precision >= 0.98: minScore ${s.layers12.minScore}, `
  + `minMargin ${s.layers12.minMargin};`);
console.log(`TF-IDF similarity ${s.tfidf.minConfidence}, alone and in layer 3. Test scored once at those thresholds.`);
console.log('');
for (const line of table(local.test)) console.log(line);
console.log('');
console.log(`${model.model} in layer 3, ${model.date.slice(0, 10)}, on a seeded sample of ${model.sample.size} `
  + 'test messages '
  + `(${model.sample.answerable} answerable);`);
console.log(`minConfidence ${model.minConfidence} (the default, not tuned). ${model.calls} calls, `
  + `${model.errors} errors, `
  + `${model.unknownChoices} unknown ids.`);
console.log('');
for (const line of table(model.results)) console.log(line);
const l = model.latencyMs;
const p = model.pairedRight['cascade with model vs layers 1-2'];
console.log('');
console.log(`model call latency p50 ${l.p50} ms, p95 ${l.p95} ms, max ${l.max} ms; `
  + `cost USD ${model.costUsd.toFixed(4)} `
  + '(peak price, an upper bound)');
console.log(`right fixed answers, cascade with model vs layers 1-2: ${p.onlyFirst} only the cascade, `
  + `${p.onlySecond} only layers 1-2, McNemar exact p ${p.mcnemarP < 0.0001 ? '< 0.0001' : `= ${p.mcnemarP}`}`);
