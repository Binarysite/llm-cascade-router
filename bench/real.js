#!/usr/bin/env node
// Run both sticker-shop banks with a real model in layer 3, through the shipped
// adapters, and write a report with right/wrong/escalated, latency, tokens and
// cost. The main LLM stays the counting mock, so the cost is the classifier's.
//
//   DEEPSEEK_API_KEY=... node bench/real.js --provider deepseek --model deepseek-flash
//   ANTHROPIC_API_KEY=... node bench/real.js --provider anthropic --model <a Claude Haiku id>
//
// The key is read from the environment, sent only to the provider, and never
// printed or written: the report is checked for it before it is kept.
// --max-usd (default 0.25) stops the run once the cost computed from returned usage passes it.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { measure, format, mcnemarExact, latencySummary } from '../src/eval.js';
import { createOpenAiCompatibleClassifier } from '../src/adapters/openai-compatible.js';
import { createClaudeClassifier } from '../src/adapters/claude.js';
import { createStickerShopRouter } from '../examples/sticker-shop/router.js';
import { createKeywordClassifier } from '../examples/sticker-shop/classifier.js';
import { safeErrorLabel } from './safe-error.js';
import { PROVIDERS, costUsd } from './providers.js';

const arg = (/** @type {string} */ name, /** @type {string} */ dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const provider = arg('provider', 'deepseek');
const spec = PROVIDERS[provider];
if (!spec) throw new Error(`unknown --provider ${provider}; one of ${Object.keys(PROVIDERS).join(', ')}`);
const model = arg('model', spec.defaultModel);
const outFile = arg('out', `reports/real-${provider}.json`);
const timeoutMs = Number(arg('timeout', '30000'));
const maxUsd = Number(arg('max-usd', '0.25'));
const key = process.env[spec.keyEnv];
if (!key) throw new Error(`set ${spec.keyEnv}`);

/** Models the endpoint said it served, read from each response. */
const served = new Set();
/** @type {typeof fetch} */
const recordingFetch = async (url, init) => {
  const res = await fetch(url, init);
  if (res.ok) res.clone().json().then((d) => { if (typeof d?.model === 'string') served.add(d.model); }, () => {});
  return res;
};

const base = spec.kind === 'anthropic'
  ? createClaudeClassifier({ apiKey: key, model, maxTokens: 1024, fetch: recordingFetch })
  : createOpenAiCompatibleClassifier({
    apiKey: key, model, baseUrl: spec.baseUrl, extraBody: spec.extraBody, fetch: recordingFetch,
  });

const ledger = { usd: 0, stopped: false };
/** One bank's classifier calls. */
const fresh = () => ({
  calls: 0,
  errors: 0,
  errorSamples: /** @type {string[]} */ ([]),
  usage: /** @type {any[]} */ ([]),
  latencies: /** @type {number[]} */ ([]),
  byText: new Map(),
});
let stats = fresh();

/** @type {import('../index.js').Classify} */
const timed = async (input) => {
  if (ledger.stopped) throw new Error('budget reached');
  const t0 = performance.now();
  stats.calls += 1;
  try {
    const r = await base(input);
    stats.usage.push(r.usage);
    ledger.usd += costUsd(spec, [r.usage]);
    if (ledger.usd > maxUsd) ledger.stopped = true;
    stats.byText.set(input.message, { choice: r.choice, confidence: r.confidence });
    return r;
  } catch (e) {
    stats.errors += 1;
    if (stats.errorSamples.length < 3) stats.errorSamples.push(safeErrorLabel(e));
    throw e;
  } finally {
    stats.latencies.push(performance.now() - t0);
  }
};

/** @param {any} slots */
const shop = (slots) => createStickerShopRouter({ classify: null, ...slots, classifierTimeoutMs: timeoutMs });
const load = async (/** @type {string} */ n) => JSON.parse(await readFile(new URL(n, import.meta.url), 'utf8'));
const banks = { inSample: await load('./messages.json'), heldOut: await load('./held-out.json') };
const strip = ({ rows, ...rest }) => rest;
const CHEAP = new Set(['exact', 'score', 'classifier']);

/** Discordant pairs and the exact McNemar p-value, real model against the keyword mock. */
const versus = (real, mock, ok) => {
  let b = 0;
  let c = 0;
  real.rows.forEach((r, i) => {
    if (ok(r) && !ok(mock.rows[i])) b += 1;
    if (!ok(r) && ok(mock.rows[i])) c += 1;
  });
  return { onlyModel: b, onlyMock: c, mcnemarP: Number(mcnemarExact(b, c).toFixed(4)) };
};

const result = {
  provider, model, servedModels: /** @type {string[]} */ ([]), date: new Date().toISOString(), timeoutMs, maxUsd,
  prices: spec.prices, banks: /** @type {Record<string, unknown>} */ ({}),
};
for (const [name, bank] of Object.entries(banks)) {
  stats = fresh();
  const noModel = await measure(bank, { build: shop });
  const mock = await measure(bank, { build: shop, classify: createKeywordClassifier() });
  const real = await measure(bank, { build: shop, classify: timed });
  const usd = costUsd(spec, stats.usage);
  const tokens = spec.tokens(stats.usage);
  const versusMock = {
    answeredWithoutMainLlm: versus(real, mock, (r) => CHEAP.has(r.layer)),
    right: versus(real, mock, (r) => r.verdict === 'right'),
  };
  result.banks[name] = {
    withoutClassifier: strip(noModel),
    keywordMock: strip(mock),
    realModel: {
      ...strip(real),
      calls: stats.calls, errors: stats.errors, errorSamples: stats.errorSamples, tokens,
      latencyMs: latencySummary(stats.latencies),
      costUsd: Number(usd.toFixed(6)),
      breakEvenUsdPerMainLlmCall: real.classifierRight ? Number((usd / real.classifierRight).toFixed(6)) : null,
      versusKeywordMock: versusMock,
      rows: real.rows.map(({ text, expect, layer, answerId, verdict, classifierMs }) => ({
        text, expect, layer, answerId, verdict, classifierMs, ...(stats.byText.get(text) ?? {}),
      })),
    },
  };
  const v = versusMock.answeredWithoutMainLlm;
  const lat = latencySummary(stats.latencies);
  const esc = real.escalatedLatencyMs;
  console.log(`== ${name}: ${model} ==`);
  console.log(format(real, { classifierNote: `${model}, real calls` }).join('\n'));
  console.log(`classifier latency p50 ${lat.p50} ms, ${lat.p95 === null ? `max ${lat.max}` : `p95 ${lat.p95}`} ms `
    + `(n ${lat.n}); added on escalated turns p50 ${esc.p50} ms, `
    + `${esc.p95 === null ? `max ${esc.max}` : `p95 ${esc.p95}`} ms (n ${esc.n})`);
  console.log(`tokens ${JSON.stringify(tokens)}, errors ${stats.errors}, cost USD ${usd.toFixed(6)}`);
  console.log(`vs keyword mock, answered without the main LLM: ${v.onlyModel} only by the model, `
    + `${v.onlyMock} only by the mock, McNemar exact p = ${v.mcnemarP}\n`);
  if (ledger.stopped) break;
}
result.servedModels = [...served].sort();
result.totalCostUsd = Number(ledger.usd.toFixed(6));
result.budgetReached = ledger.stopped;
const capNote = ledger.stopped ? ', BUDGET REACHED' : '';
console.log(`total classifier cost USD ${result.totalCostUsd} (cap ${maxUsd})${capNote}`);

const json = `${JSON.stringify(result, null, 2)}\n`;
const path = new URL(`../${outFile}`, import.meta.url);
if (json.includes(key)) throw new Error('the report would contain the API key; not written');
await mkdir(new URL('./', path), { recursive: true });
await writeFile(path, json);
process.exitCode = ledger.stopped ? 1 : 0;
