#!/usr/bin/env node
// Paired comparisons for the CLINC150 model run, derived from the per-message rows
// that bench/clinc150/model.js records, so they can be recomputed without the
// dataset or a model call.
//   node bench/clinc150/paired.js [--check]
// Rewrites the "paired" field of reports/clinc150-deepseek.json; --check exits 1 if
// it differs from the rows. Either way the decisions rebuilt from the rows must
// reproduce the committed "results", or it throws.
//
// Not reported: the cascade against layers 1-2 alone. The cascade gives every
// answer layers 1-2 give, so "only layers 1-2 right" is 0 by construction and the
// p-value says nothing.
import { readFile, writeFile } from 'node:fs/promises';
import { mcnemarExact } from '../../src/eval.js';
import { DESCRIPTIONS } from './setup.js';
import { score } from './evaluate.js';

export const ANSWER_IDS = new Set(Object.keys(DESCRIPTIONS));

/**
 * The router's layer 3 rule applied to a recorded reply: a known id at or above
 * minConfidence is an answer, anything else goes to the LLM.
 * @param {unknown} choice @param {unknown} confidence @param {number} min
 * @param {ReadonlySet<string>} [ids]
 */
export function modelDecision(choice, confidence, min, ids = ANSWER_IDS) {
  return typeof choice === 'string' && ids.has(choice) && typeof confidence === 'number' && confidence >= min
    ? choice : 'llm';
}

/**
 * Decisions per message from the report rows [testIndex, expect, layers12, choice, confidence, ms, error?].
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} rows @param {number} minConfidence
 */
export function decisionsFromRows(rows, minConfidence) {
  const expects = rows.map((r) => ({ expect: /** @type {string} */ (r[1]) }));
  const layers12 = rows.map((r) => /** @type {string} */ (r[2]));
  const alone = rows.map((r) => modelDecision(r[3], r[4], minConfidence));
  const cascade = layers12.map((d, i) => (d === 'llm' ? alone[i] : d));
  return { expects, layers12, alone, cascade };
}

/** Discordant pairs and the exact McNemar p-value. @param {boolean[]} x @param {boolean[]} y */
export function paired(x, y) {
  const b = x.filter((v, i) => v && !y[i]).length;
  const c = x.filter((v, i) => !v && y[i]).length;
  return { onlyFirst: b, onlySecond: c, mcnemarP: Number(mcnemarExact(b, c).toFixed(4)) };
}

/**
 * @param {ReadonlyArray<{ expect: string }>} expects
 * @param {{ layers12: string[], alone: string[], cascade: string[] }} d
 */
export function comparisons(expects, { layers12, alone, cascade }) {
  const right = (/** @type {string[]} */ ds) => ds.map((x, i) => x !== 'llm' && x === expects[i].expect);
  const wrong = (/** @type {string[]} */ ds) => ds.map((x, i) => x !== 'llm' && x !== expects[i].expect);
  return {
    'cascade with model vs model alone': {
      right: paired(right(cascade), right(alone)),
      wrong: paired(wrong(cascade), wrong(alone)),
    },
    modelCallsSkippedByLayers12: layers12.filter((x) => x !== 'llm').length,
  };
}

/**
 * The report with "paired" recomputed from its rows; throws if the rows do not give its results.
 * @param {any} report
 */
export function withPaired(report) {
  const d = decisionsFromRows(report.replies, report.minConfidence);
  const rebuilt = {
    'layers 1-2, then LLM': score(d.expects, d.layers12),
    'model on every message, then LLM': score(d.expects, d.alone),
    'cascade: layers 1-2, model in layer 3, then LLM': score(d.expects, d.cascade),
  };
  if (JSON.stringify(rebuilt) !== JSON.stringify(report.results)) {
    throw new Error('decisions rebuilt from the rows do not reproduce the committed results');
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(report)) {
    if (k === 'pairedRight' || k === 'paired') out.paired = comparisons(d.expects, d);
    else out[k] = v;
  }
  if (!('paired' in out)) out.paired = comparisons(d.expects, d);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = new URL('../../reports/clinc150-deepseek.json', import.meta.url);
  const before = await readFile(file, 'utf8');
  const after = `${JSON.stringify(withPaired(JSON.parse(before)), null, 1)}\n`;
  if (process.argv.includes('--check')) {
    if (after !== before) {
      console.error('reports/clinc150-deepseek.json: "paired" differs from its rows');
      process.exit(1);
    }
    console.log('reports/clinc150-deepseek.json: "paired" matches its rows');
  } else {
    await writeFile(file, after);
    console.log('reports/clinc150-deepseek.json: "paired" rewritten from its rows');
  }
}
