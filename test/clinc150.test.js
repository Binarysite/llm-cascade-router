// The CLINC150 bench pieces that do not need the dataset, plus a fresh-run check when it is present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { score, choose } from '../bench/clinc150/evaluate.js';
import { createNearestNeighbour } from '../bench/clinc150/tfidf.js';
import { buildConfig } from '../bench/clinc150/setup.js';
import { modelDecision, decisionsFromRows, comparisons, withPaired } from '../bench/clinc150/paired.js';
import { readFile } from 'node:fs/promises';
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

test('paired.js: layer 3 rule, decisions from rows, and comparisons on right and on wrong', () => {
  assert.equal(modelDecision('balance', 0.8, 0.8), 'balance');
  assert.equal(modelDecision('balance', 0.79, 0.8), 'llm');
  assert.equal(modelDecision('made_up', 0.99, 0.8), 'llm');
  assert.equal(modelDecision(null, 0, 0.8), 'llm');
  const rows = [
    [0, 'balance', 'balance', 'transfer', 0.9, 10],
    [1, 'transfer', 'llm', 'transfer', 0.9, 10],
    [2, 'llm', 'llm', 'balance', 0.9, 10],
    [3, 'balance', 'transfer', 'balance', 0.9, 10],
    [4, 'llm', 'llm', null, 0, 10, 'timeout'],
  ];
  const d = decisionsFromRows(rows, 0.8);
  assert.deepEqual(d.alone, ['transfer', 'transfer', 'balance', 'balance', 'llm']);
  assert.deepEqual(d.cascade, ['balance', 'transfer', 'balance', 'transfer', 'llm']);
  assert.deepEqual(comparisons(d.expects, d), {
    'cascade with model vs model alone': {
      right: { onlyFirst: 1, onlySecond: 1, mcnemarP: 1 },
      wrong: { onlyFirst: 1, onlySecond: 1, mcnemarP: 1 },
    },
    modelCallsSkippedByLayers12: 2,
  });
});

test('the committed model report: paired comes from its rows, and no comparison true by construction', async () => {
  const text = await readFile(new URL('../reports/clinc150-deepseek.json', import.meta.url), 'utf8');
  const report = JSON.parse(text);
  assert.equal(`${JSON.stringify(withPaired(report), null, 1)}\n`, text, 'run node bench/clinc150/paired.js');
  assert.ok(!('pairedRight' in report));
  assert.deepEqual(Object.keys(report.paired), ['cascade with model vs model alone', 'modelCallsSkippedByLayers12']);
  const broken = { ...report, results: { ...report.results, 'layers 1-2, then LLM': {} } };
  assert.throws(() => withPaired(broken), /do not reproduce/);
});

test('show.js and cost.js read the committed reports without the dataset', async () => {
  const { stdout } = await run(process.execPath, [script('bench/clinc150/show.js')]);
  assert.match(stdout, /^CLINC150 test split, 5500 messages/);
  const cost = await run(process.execPath, [script('bench/cost.js'), '--main-in', '1', '--main-out', '2',
    '--prompt-tokens', '1000', '--output-tokens', '100', '--main-ms', '2000']);
  assert.match(cost.stdout, /It loses money when one main call costs less than USD \d/);
  await assert.rejects(run(process.execPath, [script('bench/cost.js')]), (err) => err.code === 2);
});

test('cost.js prices wrong fixed answers and says how many saved calls are wrong answers', async () => {
  const base = ['--main-in', '1.32', '--main-out', '3.96', '--prompt-tokens', '2000', '--output-tokens', '300',
    '--main-ms', '3000'];
  const at = async (/** @type {string[]} */ extra) => (await run(process.execPath, [script('bench/cost.js'), ...base,
    ...extra])).stdout;
  const usd = (/** @type {string} */ out, /** @type {string} */ name) => Number(
    out.split('\n').find((l) => l.startsWith(name))?.slice(name.length).trim().split(/\s+/)[0]);
  const free = await at([]);
  assert.match(free, /wrong fixed answer: USD 0 each \(--wrong-cost\)/);
  assert.match(free, /62\.5 saved calls per 1k turns, of which 10\.5 are wrong answers,/);
  const priced = await at(['--wrong-cost', '0.01']);
  assert.match(priced, /wrong fixed answer: USD 0\.01 each \(--wrong-cost\)/);
  const cascade = 'cascade: layers 1-2, model in layer 3';
  // 22 wrong of 2,000 sampled messages: 11 per 1k turns, at USD 0.01 each.
  assert.ok(Math.abs(usd(priced, cascade) - usd(free, cascade) - 0.11) < 0.0015);
  assert.ok(Math.abs(usd(priced, 'LLM on every message') - usd(free, 'LLM on every message')) < 1e-9);
  await assert.rejects(run(process.execPath, [script('bench/cost.js'), ...base, '--wrong-cost', '-1']),
    (err) => err.code === 2);
});

test('cost.js rejects an --answerable-share outside [0, 1] or not a number', async () => {
  const base = ['--main-in', '1.32', '--main-out', '3.96', '--prompt-tokens', '2000', '--output-tokens', '300',
    '--main-ms', '3000'];
  for (const bad of [['--answerable-share', '1.5'], ['--answerable-share', 'abc'], ['--answerable-share', '-0.1'],
    ['--answerable-share']]) {
    await assert.rejects(run(process.execPath, [script('bench/cost.js'), ...base, ...bad]),
      (/** @type {any} */ err) => err.code === 2 && /--answerable-share must be a number from 0 to 1/.test(err.stderr));
  }
  const { stdout } = await run(process.execPath, [script('bench/cost.js'), ...base, '--answerable-share', '1']);
  assert.match(stdout, /It loses money|LLM on every message/);
});

test('with the dataset, a fresh run reproduces the committed report and chart', { skip: !hasData }, async () => {
  const { stdout } = await run(process.execPath, [script('bench/clinc150/run.js'), '--check'], { timeout: 120_000 });
  assert.match(stdout, /matches a fresh run/);
  const chart = await run(process.execPath, [script('bench/clinc150/chart.js'), '--check']);
  assert.match(chart.stdout, /matches the reports/);
});
