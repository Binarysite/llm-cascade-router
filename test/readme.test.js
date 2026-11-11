// The output blocks in the README and docs/RESULTS.md must be what the commands print today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOCS, ALLOWED_COMMANDS, findBlocks, runCommand, refresh } from '../scripts/readme-outputs.mjs';

const texts = Object.fromEntries(await Promise.all(DOCS.map(async (doc) => [
  doc, await readFile(new URL(`../${doc}`, import.meta.url), 'utf8')])));

test('every number in the README results block comes from an output block', () => {
  const commands = (doc) => findBlocks(texts[doc]).map((b) => b.command);
  for (const c of ['scripts/headline.mjs', 'examples/sticker-shop/ask.js', 'bench/clinc150/show.js --short']) {
    assert.ok(commands('README.md').includes(c), c);
  }
  for (const c of ['bench/run.js', 'bench/show-real.js', 'bench/clinc150/show.js', 'bin/cascade.js']) {
    assert.ok(commands('docs/RESULTS.md').includes(c), c);
  }
});

for (const doc of DOCS) {
  test(`${doc} markers are all on the allowlist`, () => {
    for (const { command } of findBlocks(texts[doc])) {
      assert.ok(ALLOWED_COMMANDS.includes(command), `marker not allowlisted, not run: ${command}`);
    }
  });
}

test('an unknown marker command is rejected without running', () => {
  const unknown = ['scripts/evil.mjs', '--eval=process.exit(7)', '../outside.js', 'bench/run.js --extra',
    '/bin/echo hi'];
  for (const c of unknown) {
    assert.throws(() => runCommand(c), /allowlist/, c);
  }
  assert.throws(() => refresh('<!-- output: scripts/evil.mjs -->\n```text\nx\n```'), /allowlist/);
});

test('refresh rejects command output that contains a marker or a fence', () => {
  const doc = '<!-- output: bin/cascade.js -->\n```text\nold\n```\n';
  for (const out of ['ok\n<!-- output: bench/run.js -->', 'ok\n```\nmore']) {
    assert.throws(() => refresh(doc, () => out), /marker or code fence/);
  }
  assert.equal(refresh(doc, () => 'new'), doc.replace('old', 'new'));
});

for (const doc of DOCS) {
  const lines = texts[doc].split('\n');
  for (const { command, start, end } of findBlocks(texts[doc])) {
    test(`${doc} block for "${command}" matches a fresh run`, () => {
      assert.equal(lines.slice(start, end).join('\n'), runCommand(command),
        'run node scripts/readme-outputs.mjs to refresh it');
    });
  }
}

test('the README headline tests the real model against the mock on right answers, not on share', async () => {
  const real = JSON.parse(await readFile(new URL('../reports/real-deepseek.json', import.meta.url), 'utf8'))
    .banks.heldOut.realModel.versusKeywordMock;
  const { start, end } = findBlocks(texts['README.md']).find((b) => b.command === 'scripts/headline.mjs');
  const block = texts['README.md'].split('\n').slice(start, end).join('\n');
  assert.match(block, new RegExp(`p = ${real.right.mcnemarP} on right answers`));
  assert.match(block, /3 more right, 1 more wrong, none the other way/);
  assert.doesNotMatch(block, new RegExp(`p = ${real.answeredWithoutMainLlm.mcnemarP}\\b`));
});
