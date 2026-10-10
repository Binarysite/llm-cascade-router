import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStickerShopRouter } from '../examples/sticker-shop/router.js';
import { createKeywordClassifier } from '../examples/sticker-shop/classifier.js';
import { createMockLlm } from '../examples/sticker-shop/llm.js';

const run = promisify(execFile);
const bank = JSON.parse(await readFile(new URL('../bench/messages.json', import.meta.url), 'utf8'));

test('no cheap layer gives a wrong answer on the benchmark bank', async () => {
  const router = createStickerShopRouter();
  for (const { text, expect } of bank) {
    const r = await router.route(text);
    if (['exact', 'score', 'classifier'].includes(r.layer)) {
      assert.equal(r.answerId, expect, `"${text}" answered by ${r.layer} as ${r.answerId}`);
    }
    if (expect === 'llm') assert.equal(r.layer, 'llm', `"${text}" should reach the LLM, got ${r.layer}`);
  }
});

test('messages from the agent-eval-harness run that failed are not answered by a cheap layer', async () => {
  // Run against agent-eval-harness's sticker-shop scenarios, these got fixed
  // answers (file formats, contact) before the example had the avoid words
  // that now send them on to the agent.
  const router = createStickerShopRouter();
  for (const text of [
    "Here's my logo: logo.png, it's 72 dpi. Is that ok for 3 inch stickers?",
    'uploading design.svg for die cut stickers, can you check it?',
    'my file is banner.jpg at 300 dpi but the text goes right up to the edge',
    "What's the email address of the person who ordered 10501?",
  ]) {
    const r = await router.route(text);
    assert.equal(r.layer, 'llm', `"${text}" answered by ${r.layer} as ${r.answerId}`);
  }
});

test('the LLM is called exactly once per message that reaches it', async () => {
  const llm = createMockLlm();
  const router = createStickerShopRouter({ generate: llm });
  let reached = 0;
  for (const { text } of bank) if ((await router.route(text)).llmCalled) reached += 1;
  assert.equal(llm.calls(), reached);
});

test('the keyword classifier is deterministic and abstains on unrelated text', async () => {
  const classify = createKeywordClassifier();
  const choices = [{ id: 'sizes', description: '' }, { id: 'proof', description: '' }];
  const a = await classify({ message: 'how big is a laptop sticker', choices });
  const b = await classify({ message: 'how big is a laptop sticker', choices });
  assert.deepEqual(a, b);
  assert.equal(a.choice, 'sizes');
  assert.deepEqual(await classify({ message: 'cancel my order', choices }), { choice: null, confidence: 0 });
});

test('a classifier slower than its budget does not delay the turn past it', async () => {
  const router = createStickerShopRouter({ classify: createKeywordClassifier({ delayMs: 1000 }) });
  const t0 = performance.now();
  const r = await router.route('can I see a mockup to approve first');
  assert.ok(performance.now() - t0 < 900);
  assert.equal(r.layer, 'llm');
  assert.equal(r.trace.find((s) => s.layer === 'classifier').outcome, 'timeout');
});

test('ask.js prints the routed result as JSON', async () => {
  const script = new URL('../examples/sticker-shop/ask.js', import.meta.url).pathname;
  const { stdout } = await run(process.execPath, [script, 'are the stickers waterproof?']);
  const result = JSON.parse(stdout);
  assert.equal(result.layer, 'exact');
  assert.equal(result.answerId, 'waterproof');
});

test('bench exits 0 and reports the share answered without the main LLM', async () => {
  const script = new URL('../bench/run.js', import.meta.url).pathname;
  const { stdout } = await run(process.execPath, [script]);
  assert.match(stdout, /answered without the main LLM: \d+\/\d+ \(\d+\.\d%\)/);
  assert.match(stdout, /classifier calls: \d+, answers: \d+/);
  assert.match(stdout, /classifier break-even: \d+\/\d+ = \d\.\d\d/);
  assert.match(stdout, /wrong fixed answers: 0/);
});

test('bench coverage does not silently drop: floors on the cheap share and on escalations', async () => {
  // The README quotes these numbers. A change that sends more turns to the LLM
  // passes the "0 wrong" check, so it has to fail here instead. Raise the
  // floors when the example improves; lower them only on purpose.
  const script = new URL('../bench/run.js', import.meta.url).pathname;
  const { stdout } = await run(process.execPath, [script, '--json']);
  const report = JSON.parse(stdout).inSample;
  assert.equal(report.total, 48);
  const cheap = report.answeredWithoutMainLlm;
  assert.ok(cheap >= 31, `answered without the main LLM fell to ${cheap}`);
  assert.ok(report.escalated.length <= 1, `escalations rose to ${report.escalated.length}`);
  assert.equal(report.classifierCalls, report.total - report.byLayer.exact.turns - report.byLayer.score.turns);
  assert.equal(report.classifierAnswers, report.byLayer.classifier.turns);
  assert.equal(report.breakEven, Number((report.classifierAnswers / report.classifierCalls).toFixed(3)));
});

test('ask.js with no message routes four demo messages, one per layer', async () => {
  const script = new URL('../examples/sticker-shop/ask.js', import.meta.url).pathname;
  const { stdout } = await run(process.execPath, [script]);
  for (const line of [
    'answered by exact (shipping-time)',
    'answered by score (shipping-time)',
    'answered by classifier (proof)',
    'answered by llm, LLM called',
    '3 of 4 answered without the LLM.',
  ]) assert.ok(stdout.includes(line), `missing "${line}"`);
});
