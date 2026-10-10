import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { answers, synonyms, stopwords, fallback } from '../examples/sticker-shop/answers.js';

const exec = promisify(execFile);
const cli = new URL('../bin/cascade.js', import.meta.url).pathname;
const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

/** Run the CLI and return { code, stdout, stderr } instead of rejecting on a non-zero exit. */
async function cascade(...args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [cli, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

/** Write JSON files to a temp directory, run `fn` with their paths, and clean up. */
async function withFiles(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'cascade-cli-'));
  try {
    const paths = {};
    for (const [name, value] of Object.entries(files)) {
      paths[name] = join(dir, `${name}.json`);
      await writeFile(paths[name], typeof value === 'string' ? value : JSON.stringify(value));
    }
    return await fn(paths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const config = { answers, synonyms, stopwords, fallback };

test('the starter exits 0, reports 7/10 and says there is no classifier', async () => {
  const { code, stdout } = await cascade();
  assert.equal(code, 0);
  assert.match(stdout, /^config: .*config\.json, messages: .*messages\.json \(layers 1 and 2, /);
  assert.match(stdout, /10 labelled messages, 7 with a fixed answer and 3 that need the model/);
  assert.match(stdout, /answered without the main LLM: 7\/10 \(70\.0%\)/);
  assert.match(stdout, /classifier: not configured/);
  assert.doesNotMatch(stdout, /classifier calls|break-even/);
  assert.match(stdout, /wrong fixed answers: 0/);
});

test('the starter is copied from the sticker shop, not invented', async () => {
  const starter = await readJson('examples/starter/config.json');
  assert.ok(starter.answers.length > 0);
  for (const entry of starter.answers) {
    assert.deepEqual(entry, answers.find((a) => a.id === entry.id), `starter answer ${entry.id}`);
  }
  assert.deepEqual(starter.synonyms, synonyms);
  assert.deepEqual(starter.stopwords, stopwords);
  assert.equal(starter.fallback, fallback);
  const bank = await readJson('bench/messages.json');
  for (const m of await readJson('examples/starter/messages.json')) {
    assert.deepEqual(bank.find((b) => b.text === m.text), m, `starter message "${m.text}"`);
  }
});

test('--json prints the summary without per-message rows', async () => {
  const { code, stdout } = await cascade('--json');
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.total, 10);
  assert.equal(report.answeredWithoutMainLlm, 7);
  assert.equal(report.classifierConfigured, false);
  assert.equal(report.rows, undefined);
});

test('--help prints usage and exits 0', async () => {
  const { code, stdout } = await cascade('--help');
  assert.equal(code, 0);
  assert.match(stdout, /^usage: node bin\/cascade\.js/);
});

test('a label that makes a cheap layer give a wrong fixed answer exits 1', async () => {
  await withFiles({
    config,
    messages: [{ text: 'How long does shipping take?', expect: 'sizes' }],
  }, async (p) => {
    const { code, stdout } = await cascade('--config', p.config, '--messages', p.messages);
    assert.equal(code, 1);
    assert.match(stdout, /wrong fixed answers: 1/);
    assert.match(stdout, /WRONG exact: "How long does shipping take\?" -> shipping-time, expected sizes/);
  });
});

test('an unknown label exits 2 and names the message', async () => {
  await withFiles({
    config,
    messages: [{ text: 'How long does shipping take?', expect: 'no-such-answer' }],
  }, async (p) => {
    const { code, stderr } = await cascade('--config', p.config, '--messages', p.messages);
    assert.equal(code, 2);
    assert.match(stderr, /"How long does shipping take\?" expects "no-such-answer"/);
  });
});

test('a function-only key in the config exits 2', async () => {
  await withFiles({
    config: { ...config, llm: { timeoutMs: 100 } },
    messages: [{ text: 'cancel my order', expect: 'llm' }],
  }, async (p) => {
    const { code, stderr } = await cascade('--config', p.config, '--messages', p.messages);
    assert.equal(code, 2);
    assert.match(stderr, /"llm" needs a function and cannot come from JSON; wire layers 3 and 4 with createRouter/);
  });
});

test('an invalid config exits 2 and prints the RouterConfigError text', async () => {
  await withFiles({
    config: { answers: [{ id: 'a' }] },
    messages: [{ text: 'cancel my order', expect: 'llm' }],
  }, async (p) => {
    const { code, stderr } = await cascade('--config', p.config, '--messages', p.messages);
    assert.equal(code, 2);
    assert.match(stderr, /answers\[0\]/);
  });
});

test('setup problems exit 2: one flag alone, unknown flag, bad JSON, empty or malformed messages', async () => {
  assert.equal((await cascade('--config', 'x.json')).code, 2);
  assert.equal((await cascade('--nope')).code, 2);
  await withFiles({ config, broken: '{ not json', empty: [], bad: [{ text: 1 }, { expect: 'llm' }] }, async (p) => {
    assert.equal((await cascade('--config', p.broken, '--messages', p.empty)).code, 2);
    assert.equal((await cascade('--config', join(tmpdir(), 'missing-cascade.json'), '--messages', p.empty)).code, 2);
    assert.equal((await cascade('--config', p.config, '--messages', p.empty)).code, 2);
    const { code, stderr } = await cascade('--config', p.config, '--messages', p.bad);
    assert.equal(code, 2);
    assert.match(stderr, /messages\[0\]\.text[\s\S]*messages\[0\]\.expect[\s\S]*messages\[1\]\.text/);
  });
});
