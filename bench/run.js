#!/usr/bin/env node
// Run the invented message bank through the sticker-shop router and report
// which layer answered each one, how often the cheap layers were right, how
// many turns needed no call to the main LLM, and how often the classifier ran.
//
//   npm run bench               summary
//   npm run bench -- --verbose  one line per message
//   npm run bench -- --json     machine-readable summary
import { readFile } from 'node:fs/promises';
import { createStickerShopRouter } from '../examples/sticker-shop/router.js';
import { createMockLlm } from '../examples/sticker-shop/llm.js';
import { createKeywordClassifier } from '../examples/sticker-shop/classifier.js';

const LAYERS = ['exact', 'score', 'classifier', 'llm', 'fallback'];
const CHEAP = new Set(['exact', 'score', 'classifier']);

const args = new Set(process.argv.slice(2));
const verbose = args.has('--verbose') || args.has('-v');
const asJson = args.has('--json');

const bank = JSON.parse(await readFile(new URL('./messages.json', import.meta.url), 'utf8'));
const llm = createMockLlm();
// Count classifier calls too: with a real model in that slot, each one is a
// small-model call, so "answered without the main LLM" is not "free".
const keyword = createKeywordClassifier();
let classifierCalls = 0;
/** @type {import('../index.js').Classify} */
const classify = (input) => {
  classifierCalls += 1;
  return keyword(input);
};
const router = createStickerShopRouter({ classify, generate: llm });

const rows = [];
for (const { text, expect } of bank) {
  const r = await router.route(text);
  let verdict;
  if (CHEAP.has(r.layer)) verdict = r.answerId === expect ? 'right' : 'wrong';
  else verdict = expect === 'llm' ? 'right' : 'escalated';
  rows.push({ text, expect, layer: r.layer, answerId: r.answerId, verdict, reason: r.reason });
}

const total = rows.length;
const pct = (n) => `${((100 * n) / total).toFixed(1)}%`;
const byLayer = Object.fromEntries(LAYERS.map((layer) => {
  const mine = rows.filter((r) => r.layer === layer);
  return [layer, {
    turns: mine.length,
    right: mine.filter((r) => r.verdict === 'right').length,
    wrong: mine.filter((r) => r.verdict === 'wrong').length,
    escalated: mine.filter((r) => r.verdict === 'escalated').length,
  }];
}));
const noModel = rows.filter((r) => CHEAP.has(r.layer)).length;
const wrong = rows.filter((r) => r.verdict === 'wrong');
const escalated = rows.filter((r) => r.verdict === 'escalated');
const fixable = rows.filter((r) => r.expect !== 'llm').length;
const classifierAnswers = byLayer.classifier.turns;
// Each classifier answer saves one main-LLM call, and every classifier call is
// paid, so a model in that slot only saves money below this cost ratio.
const breakEven = classifierCalls ? classifierAnswers / classifierCalls : 0;

if (asJson) {
  console.log(JSON.stringify({
    total,
    withFixedAnswer: fixable,
    llmCalls: llm.calls(),
    classifierCalls,
    classifierAnswers,
    breakEven: Number(breakEven.toFixed(3)),
    answeredWithoutMainLlm: noModel,
    byLayer,
    wrong,
    escalated,
  }, null, 2));
  process.exit(wrong.length ? 1 : 0);
}

if (verbose) {
  for (const r of rows) {
    const mark = { right: 'ok   ', wrong: 'WRONG', escalated: 'esc  ' }[r.verdict];
    console.log(`${mark} ${r.layer.padEnd(10)} ${String(r.answerId ?? '-').padEnd(14)} ${r.text}`);
    if (r.verdict !== 'right') console.log(`      expected ${r.expect}; ${r.reason}`);
  }
  console.log('');
}

console.log(`${total} invented messages, ${fixable} with a fixed answer and ${total - fixable} that need the model`);
console.log('(sticker-shop example: keyword mock classifier, mock LLM)\n');
console.log('layer       turns  share   right  wrong  escalated');
for (const layer of LAYERS) {
  const s = byLayer[layer];
  const cheap = CHEAP.has(layer);
  console.log([
    layer.padEnd(10),
    String(s.turns).padStart(6),
    pct(s.turns).padStart(7),
    String(s.right).padStart(7),
    (cheap ? String(s.wrong) : '-').padStart(6),
    (cheap ? '-' : String(s.escalated)).padStart(10),
  ].join(' '));
}
console.log('');
console.log(`answered without the main LLM: ${noModel}/${total} (${pct(noModel)})`);
console.log(`ceiling: ${fixable}/${total} (${pct(fixable)}), the messages that have a fixed answer`);
console.log(`LLM calls: ${llm.calls()}, against ${total} if every message went to the model`);
console.log(`classifier calls: ${classifierCalls}, answers: ${classifierAnswers} (keyword mock here, not a model)`);
const ratio = `${classifierAnswers}/${classifierCalls} = ${breakEven.toFixed(2)}`;
console.log(`classifier break-even: ${ratio} of a main LLM call`);
console.log('  (a model classifier saves money only if each of its calls costs less than that)');
console.log(`wrong fixed answers: ${wrong.length}`);
console.log(`fixed-answer questions that still reached the LLM: ${escalated.length}`);
for (const r of wrong) console.log(`  WRONG ${r.layer}: "${r.text}" -> ${r.answerId}, expected ${r.expect}`);
process.exitCode = wrong.length ? 1 : 0;
