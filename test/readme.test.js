// The output blocks in the README and docs/RESULTS.md must be what the commands print today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOCS, findBlocks, runCommand } from '../scripts/readme-outputs.mjs';

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
  const lines = texts[doc].split('\n');
  for (const { command, start, end } of findBlocks(texts[doc])) {
    test(`${doc} block for "${command}" matches a fresh run`, () => {
      assert.equal(lines.slice(start, end).join('\n'), runCommand(command),
        'run node scripts/readme-outputs.mjs to refresh it');
    });
  }
}
