// The CLINC150 bench pieces that do not need the dataset, plus a fresh-run check when it is present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { score, choose } from '../bench/clinc150/evaluate.js';
import { createNearestNeighbour } from '../bench/clinc150/tfidf.js';
import { buildConfig } from '../bench/clinc150/setup.js';
import { createRouter } from '../src/index.js';

const run = promisify(execFile);
const script = (/** @type {string} */ p) => new URL(`../${p}`, import.meta.url).pathname;
const dataFile = new URL('../bench/clinc150/data/data_full.json', import.meta.url);
const hasData = await access(dataFile).then(() => true, () => false);

test('score splits wrong answers into wrong intent and must-escalate', () => {
  const ex = ['balance', 'balance', 'transfer', 'llm', 'llm'].map((expect) => ({ expect }));
  const r = score(ex, ['balance', 'llm', 'balance', 'transfer', 'llm']);
  assert.deepEqual(
    [r.answered, r.right, r.wrong, r.wrongIntent, r.wrongMustEscalate, r.escalatedAnswerable, r.toLlm],
    [3, 1, 2, 1, 1, 1, 2],
  );
  assert.equal(r.precision, 0.333);
  assert.equal(r.coverageOfAnswerable, 0.333);
  assert.equal(r.wrongPer1000Turns, 400);
});

test('choose takes the most answers at precision >= 0.98, the stricter point on a tie, else the most precise', () => {
  const at = (answered, wrong) => ({ answered, precision: answered ? (answered - wrong) / answered : null });
  const grid = [
    { point: 'loose', result: at(200, 20) },
    { point: 'a', result: at(100, 1) },
    { point: 'b', result: at(100, 2) },
    { point: 'c', result: at(100, 0) },
    { point: 'strict', result: at(10, 0) },
  ];
  assert.equal(choose(/** @type {any} */ (grid)).point, 'c');
  const none = choose(/** @type {any} */ ([{ point: 'x', result: at(10, 5) }, { point: 'y', result: at(10, 1) }]));
  assert.equal(none.point, 'y');
  assert.equal(none.rule, 'highest precision');
});

test('the TF-IDF baseline returns the nearest label and abstains when it is not an answer', () => {
  const nn = createNearestNeighbour([
    { text: 'what is my account balance', expect: 'balance' },
    { text: 'transfer money to savings', expect: 'transfer' },
    { text: 'tell me a joke', expect: 'llm' },
  ], ['what', 'is', 'my', 'me', 'a', 'to']);
  assert.deepEqual(nn.nearest('what is my account balance'), { label: 'balance', similarity: 1 });
  assert.equal(nn.nearest('move money to savings').label, 'transfer');
  assert.deepEqual(nn.nearest('zzz'), { label: 'llm', similarity: 0 });
  const out = /** @type {any} */ (nn.classify({ message: 'tell me a joke', choices: [], signal: AbortSignal.abort() }));
  assert.equal(out.choice, null);
});

test('buildConfig drops an utterance that two intents share, so setup accepts it', () => {
  const train = [
    { text: 'my balance', intent: 'balance', expect: 'balance' },
    { text: 'My balance?', intent: 'transactions', expect: 'transactions' },
    { text: 'recent transactions', intent: 'transactions', expect: 'transactions' },
    { text: 'tell me a joke', intent: 'tell_joke', expect: 'llm' },
  ];
  const config = buildConfig(train, ['balance', 'transactions'], { minScore: 0.5, minMargin: 0.1 });
  assert.deepEqual(config.answers.map((a) => a.phrases), [[], ['recent transactions']]);
  assert.throws(() => createRouter(config), /answers\[0\]\.phrases/, 'an intent left with no phrase is a setup error');
});

test('show.js and cost.js read the committed reports without the dataset', async () => {
  const { stdout } = await run(process.execPath, [script('bench/clinc150/show.js')]);
  assert.match(stdout, /^CLINC150 test split, 5500 messages/);
  const cost = await run(process.execPath, [script('bench/cost.js'), '--main-in', '1', '--main-out', '2',
    '--prompt-tokens', '1000', '--output-tokens', '100', '--main-ms', '2000']);
  assert.match(cost.stdout, /It loses money when one main call costs less than USD \d/);
  await assert.rejects(run(process.execPath, [script('bench/cost.js')]), (err) => err.code === 2);
});

test('with the dataset, a fresh run reproduces the committed report and chart', { skip: !hasData }, async () => {
  const { stdout } = await run(process.execPath, [script('bench/clinc150/run.js'), '--check'], { timeout: 120_000 });
  assert.match(stdout, /matches a fresh run/);
  const chart = await run(process.execPath, [script('bench/clinc150/chart.js'), '--check']);
  assert.match(chart.stdout, /matches the reports/);
});
