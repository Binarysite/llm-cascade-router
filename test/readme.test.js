// The README's output blocks must be what the commands print today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findBlocks, runCommand } from '../scripts/readme-outputs.mjs';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const lines = readme.split('\n');

test('the README has an output block for the demo, the bench and the CLI', () => {
  const commands = findBlocks(readme).map((b) => b.command);
  for (const c of ['examples/sticker-shop/ask.js', 'bench/run.js', 'bin/cascade.js']) {
    assert.ok(commands.includes(c), c);
  }
});

for (const { command, start, end } of findBlocks(readme)) {
  test(`README block for "${command}" matches a fresh run`, () => {
    assert.equal(lines.slice(start, end).join('\n'), runCommand(command),
      'run node scripts/readme-outputs.mjs to refresh it');
  });
}
