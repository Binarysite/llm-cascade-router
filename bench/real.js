#!/usr/bin/env node
// Run both banks with a real model in layer 3 and write a report with latency,
// token usage and cost. The main LLM stays the counting mock, so the cost here
// is the classifier's alone. The vocabulary and the held-out bank are not touched.
//
//   ANTHROPIC_API_KEY=... node bench/real.js --provider anthropic --model claude-haiku-5-5
//   DEEPSEEK_API_KEY=... node bench/real.js --provider deepseek  --model deepseek-chat
//
// The key is read from the environment and never printed or written.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { measure, format } from './measure.js';
import { safeErrorLabel } from './safe-error.js';
import { createClaudeClassifier } from '../src/adapters/claude.js';
import { createStickerShopRouter } from '../examples/sticker-shop/router.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const provider = arg('provider', 'anthropic');
const model = arg('model', provider === 'deepseek' ? 'deepseek-chat' : 'claude-haiku-5-5');
const outFile = arg('out', `reports/real-${provider}.json`);
const timeoutMs = Number(arg('timeout', '30000'));

// USD per million tokens. Anthropic: published price of Claude Haiku 5.5 for prompts
// up to 100K tokens. DeepSeek: the deepseek-flash row of the public pricing page at peak
// hours (the highest column), used as an upper bound because the page does not list
// the id deepseek-chat.
const PRICES = {
  anthropic: { input: 0.10, output: 0.50, note: 'Claude Haiku 5.5, prompts up to 100K tokens' },
  deepseek: { input: 0.30, output: 1.20, cacheHit: 0.006,
    note: 'deepseek-flash peak-hours row, upper bound; the pricing page does not list deepseek-chat' },
}[provider];

function makeDeepseek() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('set DEEPSEEK_API_KEY');
  const system = 'You route customer messages to prepared answers. Pick the one answer that fully answers the '
    + 'message, or "none" if no single answer does, if the message is about a specific order or account, or if '
    + 'it asks several things at once. Reply with JSON only: {"choice": "<id or none>", "confidence": <0..1>}. '
    + 'confidence is your probability that the chosen answer is right.';
  return async function classify({ message, choices, signal }) {
    const list = choices.map((c) => `- ${c.id}: ${c.description}`).join('\n');
    const user = `Answers:\n${list}\n\nMessage:\n${message}`;
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, max_tokens: 200, temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal,
    });
    if (!res.ok) {
      // The body is never read: it can echo a masked key, and nothing from it may reach the report.
      throw new Error(`deepseek HTTP ${res.status}`);
    }
    const data = await res.json();
    const out = JSON.parse(data.choices[0].message.content);
    const ids = choices.map((c) => c.id);
    const u = data.usage ?? {};
    return {
      choice: ids.includes(out.choice) ? out.choice : null,
      confidence: Number(out.confidence) || 0,
      usage: { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0,
        cache_read_input_tokens: u.prompt_cache_hit_tokens ?? 0 },
    };
  };
}

const base = provider === 'deepseek'
  ? makeDeepseek()
  : createClaudeClassifier({ model, effort: 'low', maxTokens: 2048 });

const stats = { calls: 0, errors: 0, errorSamples: [], input: 0, output: 0, cacheRead: 0, latencies: [] };
const timed = async (input) => {
  const t0 = performance.now();
  stats.calls += 1;
  try {
    const r = await base(input);
    const u = /** @type {Record<string, number>} */ (r.usage ?? {});
    stats.input += (u.input_tokens ?? 0);
    stats.output += (u.output_tokens ?? 0);
    stats.cacheRead += (u.cache_read_input_tokens ?? 0);
    return r;
  } catch (e) {
    stats.errors += 1;
    if (stats.errorSamples.length < 3) stats.errorSamples.push(safeErrorLabel(e));
    throw e;
  } finally {
    stats.latencies.push(performance.now() - t0);
  }
};

const build = (slots) => createStickerShopRouter({ ...slots, classifierTimeoutMs: timeoutMs });
const load = async (n) => JSON.parse(await readFile(new URL(n, import.meta.url), 'utf8'));
const banks = { inSample: await load('./messages.json'), heldOut: await load('./held-out.json') };

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const round = (x, d = 1) => Number(x.toFixed(d));
const cost = (s) => (s.input * PRICES.input + s.output * PRICES.output
  + s.cacheRead * (PRICES.cacheHit ?? 0)) / 1e6;

const result = { provider, model, date: new Date().toISOString(), timeoutMs, prices: PRICES, banks: {} };
const total = { calls: 0, errors: 0, input: 0, output: 0, cacheRead: 0 };
for (const [name, bank] of Object.entries(banks)) {
  for (const k of Object.keys(stats)) if (Array.isArray(stats[k])) stats[k] = []; else stats[k] = 0;
  // The sticker-shop router always has a classifier, so "without" is one that never answers.
  const noModel = await measure(bank, { classifyWith: async () => ({ choice: null, confidence: 0 }) });
  const mock = await measure(bank);
  const real = await measure(bank, { build, classifyWith: timed });
  const lat = stats.latencies;
  const usd = cost(stats);
  const strip = ({ rows, ...rest }) => rest;
  result.banks[name] = {
    withoutClassifier: strip(noModel),
    keywordMock: strip(mock),
    realModel: {
      ...strip(real),
      usage: { calls: stats.calls, errors: stats.errors, errorSamples: stats.errorSamples,
        inputTokens: stats.input, outputTokens: stats.output, cacheReadTokens: stats.cacheRead },
      latencyMs: { mean: round(lat.reduce((a, b) => a + b, 0) / (lat.length || 1)), p50: round(pct(lat, 0.5)),
        p95: round(pct(lat, 0.95)), max: round(Math.max(0, ...lat)) },
      costUsd: Number(usd.toFixed(6)),
      breakEvenUsdPerMainLlmCall: real.classifierAnswers ? Number((usd / real.classifierAnswers).toFixed(6)) : null,
      rows: real.rows.map(({ text, expect, layer, answerId, verdict }) => ({ text, expect, layer, answerId, verdict })),
    },
  };
  for (const k of ['calls', 'errors', 'input', 'output', 'cacheRead']) total[k] += stats[k];
  console.log(`== ${name}: ${model} ==`);
  console.log(format(real, { classifierNote: `${model}, real calls` }).join('\n'));
  console.log(`classifier calls ${stats.calls}, errors ${stats.errors}, tokens in/out ${stats.input}/${stats.output}, `
    + `p50 ${round(pct(lat, 0.5))} ms, p95 ${round(pct(lat, 0.95))} ms, cost USD ${usd.toFixed(6)}\n`);
}
result.totalCostUsd = Number(cost({ input: total.input, output: total.output, cacheRead: total.cacheRead }).toFixed(6));
result.totalUsage = total;
console.log(`total classifier cost USD ${result.totalCostUsd}`);
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL(`../${outFile}`, import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
