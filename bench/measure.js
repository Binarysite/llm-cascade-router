// Measure one labelled message bank against the sticker-shop router and format
// the result as a table. bench/run.js calls this once per bank.
import { createStickerShopRouter } from '../examples/sticker-shop/router.js';
import { createMockLlm } from '../examples/sticker-shop/llm.js';
import { createKeywordClassifier } from '../examples/sticker-shop/classifier.js';

const LAYERS = ['exact', 'score', 'classifier', 'llm', 'fallback'];
const CHEAP = new Set(['exact', 'score', 'classifier']);

/**
 * Route every message through a fresh router, so call counts belong to this bank only.
 * @param {ReadonlyArray<{ text: string, expect: string }>} bank `expect` is an answer id or 'llm'
 */
export async function measure(bank) {
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

  const byLayer = Object.fromEntries(LAYERS.map((layer) => {
    const mine = rows.filter((r) => r.layer === layer);
    return [layer, {
      turns: mine.length,
      right: mine.filter((r) => r.verdict === 'right').length,
      wrong: mine.filter((r) => r.verdict === 'wrong').length,
      escalated: mine.filter((r) => r.verdict === 'escalated').length,
    }];
  }));
  const classifierAnswers = byLayer.classifier.turns;
  // Each classifier answer saves one main-LLM call, and every classifier call is
  // paid, so a model in that slot only saves money below this cost ratio.
  const breakEven = classifierCalls ? classifierAnswers / classifierCalls : 0;
  return {
    total: rows.length,
    withFixedAnswer: rows.filter((r) => r.expect !== 'llm').length,
    llmCalls: llm.calls(),
    classifierCalls,
    classifierAnswers,
    breakEven: Number(breakEven.toFixed(3)),
    answeredWithoutMainLlm: rows.filter((r) => CHEAP.has(r.layer)).length,
    byLayer,
    wrong: rows.filter((r) => r.verdict === 'wrong'),
    escalated: rows.filter((r) => r.verdict === 'escalated'),
    rows,
  };
}

/**
 * The same table for every bank, as lines of text.
 * @param {Awaited<ReturnType<typeof measure>>} report
 * @param {{ verbose?: boolean }} [options] one line per message before the table
 */
export function format(report, { verbose = false } = {}) {
  const { total, withFixedAnswer: fixable, byLayer, classifierCalls, classifierAnswers } = report;
  const noModel = report.answeredWithoutMainLlm;
  const pct = (n) => `${(total ? (100 * n) / total : 0).toFixed(1)}%`;
  const out = [];
  if (verbose) {
    for (const r of report.rows) {
      const mark = { right: 'ok   ', wrong: 'WRONG', escalated: 'esc  ' }[r.verdict];
      out.push(`${mark} ${r.layer.padEnd(10)} ${String(r.answerId ?? '-').padEnd(14)} ${r.text}`);
      if (r.verdict !== 'right') out.push(`      expected ${r.expect}; ${r.reason}`);
    }
    out.push('');
  }
  out.push(`${total} invented messages, ${fixable} with a fixed answer and ${total - fixable} that need the model`);
  out.push('');
  out.push('layer       turns  share   right  wrong  escalated');
  for (const layer of LAYERS) {
    const s = byLayer[layer];
    const cheap = CHEAP.has(layer);
    out.push([
      layer.padEnd(10),
      String(s.turns).padStart(6),
      pct(s.turns).padStart(7),
      String(s.right).padStart(7),
      (cheap ? String(s.wrong) : '-').padStart(6),
      (cheap ? '-' : String(s.escalated)).padStart(10),
    ].join(' '));
  }
  out.push('');
  out.push(`answered without the main LLM: ${noModel}/${total} (${pct(noModel)})`);
  out.push(`ceiling: ${fixable}/${total} (${pct(fixable)}), the messages that have a fixed answer`);
  out.push(`LLM calls: ${report.llmCalls}, against ${total} if every message went to the model`);
  out.push(`classifier calls: ${classifierCalls}, answers: ${classifierAnswers} (keyword mock here, not a model)`);
  out.push(`classifier break-even: ${classifierAnswers}/${classifierCalls} = ${report.breakEven.toFixed(2)} `
    + 'of a main LLM call');
  out.push('  (a model classifier saves money only if each of its calls costs less than that)');
  out.push(`wrong fixed answers: ${report.wrong.length}`);
  out.push(`fixed-answer questions that still reached the LLM: ${report.escalated.length}`);
  for (const r of report.wrong) out.push(`  WRONG ${r.layer}: "${r.text}" -> ${r.answerId}, expected ${r.expect}`);
  return out;
}
