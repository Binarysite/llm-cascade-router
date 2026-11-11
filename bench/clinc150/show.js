#!/usr/bin/env node
// Print the committed CLINC150 reports as tables, without the dataset or a network call.
//   node bench/clinc150/show.js [--short]
import { readFile } from 'node:fs/promises';

/** @param {string} f */
const read = async (f) => JSON.parse(await readFile(new URL(`../../reports/${f}`, import.meta.url), 'utf8'));
const local = await read('clinc150.json');
const model = await read('clinc150-deepseek.json');
const pct = (/** @type {number} */ x) => `${(100 * x).toFixed(1)}%`;

/** Validation results behind each configuration whose thresholds were chosen on val. */
const VAL = {
  'layers 1-2, then LLM': local.selection.layers12.val,
  'TF-IDF nearest neighbour alone, then LLM': local.selection.tfidf.val,
  'cascade: layers 1-2, TF-IDF in layer 3, then LLM': local.selection.cascadeTfidf.val,
};
/** @param {any} r */
const precisionCell = (r) => {
  if (r?.precision == null) return '-';
  const [lo, hi] = r.precisionInterval95;
  return `${pct(r.precision)} (${pct(lo)} to ${pct(hi)})`;
};
/** @param {any} v a val result, or undefined */
const valCell = (v) => (v ? `${precisionCell(v)}, ${v.right}/${v.answered}` : '-');

/** @param {Record<string, any>} results @param {boolean} [withVal] */
function table(results, withVal = false) {
  const head = ['', 'wrong', '(intent / must-escalate)', 'right', 'precision, 95% Wilson', 'to LLM'];
  const rows = [withVal ? [...head, 'val precision, right/answered'] : head];
  for (const [name, r] of Object.entries(results)) {
    const row = [
      name,
      String(r.wrong),
      `(${r.wrongIntent} / ${r.wrongMustEscalate})`,
      `${r.right}/${r.answerable}`,
      precisionCell(r),
      pct(r.escalationRate),
    ];
    rows.push(withVal ? [...row, valCell(/** @type {any} */ (VAL)[name])] : row);
  }
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
  return rows.map((row) => row.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c])))
    .join('  ').trimEnd());
}

if (process.argv.includes('--short')) {
  const rows = [
    ['layers 1-2', local.test['layers 1-2, then LLM'], VAL['layers 1-2, then LLM']],
    ['cascade, TF-IDF in layer 3', local.test['cascade: layers 1-2, TF-IDF in layer 3, then LLM'],
      VAL['cascade: layers 1-2, TF-IDF in layer 3, then LLM']],
    [`${model.model} alone *`, model.results['model on every message, then LLM']],
    [`cascade, ${model.model} in layer 3 *`, model.results['cascade: layers 1-2, model in layer 3, then LLM']],
  ];
  const cells = rows.map(([name, r, v]) => [name, String(r.wrong), `${r.right}/${r.answerable}`, precisionCell(r),
    valCell(v)]);
  const all = [['CLINC150 test split', 'wrong', 'right', 'precision, 95% Wilson', 'on val (right/answered)'],
    ...cells];
  const w = all[0].map((_, c) => Math.max(...all.map((row) => row[c].length)));
  for (const row of all) {
    console.log(row.map((cell, c) => (c === 1 ? cell.padStart(w[c]) : cell.padEnd(w[c]))).join('  ').trimEnd());
  }
  const n = local.test['layers 1-2, then LLM'].n;
  console.log(`* on a seeded sample of ${model.sample.size} of the ${n} test messages, `
    + `minConfidence ${model.minConfidence} (untuned, no val calls)`);
  process.exit(0);
}
const { splits } = local.setup;
const t = local.test['LLM on every message'];
const s = local.selection;
console.log(`CLINC150 test split, ${t.n} messages: ${t.answerable} banking questions with a fixed answer,`);
console.log(`${t.n - t.answerable} that must reach the LLM (other domains and out-of-scope). Train ${splits.train}, `
  + `val ${splits.val}.`);
console.log(`Thresholds chosen on val, the most fixed answers with precision >= 0.98: minScore ${s.layers12.minScore}, `
  + `minMargin ${s.layers12.minMargin};`);
console.log(`TF-IDF similarity ${s.tfidf.minConfidence}, alone and in layer 3. `
  + 'The rule reads the point estimate on few answered val messages');
console.log(`(${s.layers12.val.answered} for layers 1-2), `
  + 'so the val precision and its interval are in the last column. Test scored at those');
console.log('thresholds; re-run once after a floating-point fix that did not move them (see History in '
  + 'bench/clinc150/README.md).');
console.log('');
for (const line of table(local.test, true)) console.log(line);
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
const vs = model.paired['cascade with model vs model alone'];
const cas = model.results['cascade: layers 1-2, model in layer 3, then LLM'];
const alone = model.results['model on every message, then LLM'];
const pv = (/** @type {number} */ x) => (x < 0.0001 ? '< 0.0001' : `= ${x}`);
const netRight = cas.right - alone.right;
const netWrong = cas.wrong - alone.wrong;
const skipped = model.paired.modelCallsSkippedByLayers12;
console.log('');
console.log(`model call latency p50 ${l.p50} ms, p95 ${l.p95} ms, max ${l.max} ms; `
  + `cost USD ${model.costUsd.toFixed(4)} `
  + '(peak price, an upper bound)');
console.log(`paired on the same ${model.sample.size} messages, cascade with the model vs the model alone:`);
for (const [what, p] of [['right', vs.right], ['wrong', vs.wrong]]) {
  console.log(`  ${what} fixed answers: ${p.onlyFirst} only the cascade, ${p.onlySecond} only the model alone, `
    + `McNemar exact p ${pv(p.mcnemarP)}`);
}
console.log(`layers 1-2 add ${netRight === 0 ? 'no' : netRight} right answers once the model is in layer 3 `
  + `(${cas.right} vs ${alone.right}) and ${netWrong >= 0 ? `${netWrong} more` : `${-netWrong} fewer`} wrong `
  + `(${cas.wrong} vs ${alone.wrong});`);
console.log(`they skip ${skipped} of ${model.calls} model calls (${pct(skipped / model.calls)}): `
  + 'cost and latency only.');
