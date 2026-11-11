// bench/real.js without a network call: prices, the missing-key path and the committed report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROVIDERS, costUsd } from '../bench/providers.js';

const run = promisify(execFile);
const script = new URL('../bench/real.js', import.meta.url).pathname;

test('cost splits cached and uncached prompt tokens at the provider prices', () => {
  const usage = { prompt_tokens: 1_000_000, prompt_cache_hit_tokens: 400_000, completion_tokens: 100_000 };
  const { inputCacheHit, inputCacheMiss, output } = PROVIDERS.deepseek.prices;
  const expected = 0.6 * inputCacheMiss + 0.4 * inputCacheHit + 0.1 * output;
  assert.ok(Math.abs(costUsd(PROVIDERS.deepseek, [usage, null]) - expected) < 1e-12);
  const claude = { input_tokens: 1_000_000, output_tokens: 0 };
  assert.ok(Math.abs(costUsd(PROVIDERS.anthropic, [claude]) - PROVIDERS.anthropic.prices.inputCacheMiss) < 1e-12);
});

test('without the key the bench stops before any call and writes nothing', async () => {
  const out = join(tmpdir(), `real-${process.pid}.json`);
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  await assert.rejects(run(process.execPath, [script, '--provider', 'deepseek', '--out', out], { env }),
    (err) => /set DEEPSEEK_API_KEY/.test(err.stderr));
  await assert.rejects(access(out));
});

test('the committed DeepSeek report is consistent and keeps no provider error text', async () => {
  const r = JSON.parse(await readFile(new URL('../reports/real-deepseek.json', import.meta.url), 'utf8'));
  assert.equal(r.provider, 'deepseek');
  assert.ok(r.servedModels.length >= 1);
  assert.ok(r.totalCostUsd < r.maxUsd);
  for (const bank of Object.values(r.banks)) {
    const m = bank.realModel;
    assert.equal(m.fixedAnswers.right + m.fixedAnswers.wrong, m.fixedAnswers.given);
    assert.equal(m.answeredWithoutMainLlm + m.llmCalls, m.total);
    assert.equal(m.rows.length, m.total);
    for (const label of m.errorSamples) assert.match(label, /^(HTTP \d{3}|\w+)$/);
  }
});
