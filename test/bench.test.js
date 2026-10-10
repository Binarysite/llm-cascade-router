import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { measure, format } from '../bench/measure.js';
import { answers } from '../examples/sticker-shop/answers.js';

const run = promisify(execFile);
const script = new URL('../bench/run.js', import.meta.url).pathname;
const heldOutUrl = new URL('../bench/held-out.json', import.meta.url);

test('bench prints the same table for the in-sample and the held-out set, in that order', async () => {
  const { stdout } = await run(process.execPath, [script]);
  const inSample = stdout.indexOf('== in-sample: bench/messages.json');
  const heldOut = stdout.indexOf('== held-out: bench/held-out.json');
  assert.ok(inSample >= 0 && heldOut > inSample, 'both section headers, in-sample first');
  for (const line of ['layer       turns  share   right  wrong  escalated', 'wrong fixed answers: ']) {
    assert.equal(stdout.split(line).length - 1, 2, `"${line}" once per set`);
  }
  assert.match(stdout.slice(heldOut), /^24 invented messages, /m);
});

test('--json reports both sets, and only the in-sample set decides the exit code', async () => {
  // execFile rejects on a non-zero exit, so reaching the asserts means exit 0,
  // even if the held-out set has wrong fixed answers.
  const { stdout } = await run(process.execPath, [script, '--json']);
  const { inSample, heldOut } = JSON.parse(stdout);
  assert.equal(inSample.total, 48);
  assert.equal(inSample.wrong.length, 0);
  assert.equal(heldOut.total, 24);
  assert.equal(heldOut.answeredWithoutMainLlm + heldOut.llmCalls, heldOut.total);
  assert.equal(heldOut.rows, undefined, 'per-message rows stay out of the JSON summary');
});

test('the held-out set is frozen: 16 to 24 labelled messages with 4 to 6 adversarial ones', async () => {
  // It was written and labelled before its first run. Editing a message or a
  // label after seeing the result turns it into a second in-sample set, so
  // this hash fails on any edit; add a new set instead.
  const raw = await readFile(heldOutUrl);
  assert.equal(
    createHash('sha256').update(raw).digest('hex'),
    'b1151132732da07e807673dead146b4a1d8a0b0329abadcb117739265226eb1f',
  );
  const bank = JSON.parse(raw.toString('utf8'));
  assert.ok(bank.length >= 16 && bank.length <= 24);
  const adversarial = bank.filter((m) => m.adversarial).length;
  assert.ok(adversarial >= 4 && adversarial <= 6, `${adversarial} adversarial messages`);
  const ids = new Set([...answers.map((a) => a.id), 'llm']);
  for (const m of bank) assert.ok(ids.has(m.expect), `unknown label ${m.expect} on "${m.text}"`);
});

test('measure counts a wrong fixed answer and format lists it under the table', async () => {
  const report = await measure([
    { text: 'how long does shipping take', expect: 'sizes' },
    { text: 'cancel my order please', expect: 'llm' },
  ]);
  assert.equal(report.total, 2);
  assert.equal(report.wrong.length, 1);
  assert.equal(report.byLayer.llm.right, 1);
  const lines = format(report);
  assert.ok(lines.includes('wrong fixed answers: 1'));
  assert.ok(lines.includes('  WRONG exact: "how long does shipping take" -> shipping-time, expected sizes'));
  assert.ok(!format(report).some((l) => l.startsWith('ok ')), 'no per-message lines without verbose');
  assert.ok(format(report, { verbose: true }).some((l) => l.startsWith('WRONG exact')));
});

test('each set gets its own call counts', async () => {
  const bank = [{ text: 'cancel my order please', expect: 'llm' }];
  const a = await measure(bank);
  const b = await measure(bank);
  assert.equal(a.llmCalls, 1);
  assert.equal(b.llmCalls, 1);
  assert.equal(b.classifierCalls, a.classifierCalls);
});
