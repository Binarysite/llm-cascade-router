// The output blocks in the README and docs/RESULTS.md are real runs. Each block
// follows a marker line
//   <!-- output: <script> [args...] -->
// and this script reruns the script with node and rewrites the block below it.
// test/readme.test.js fails when a block and a fresh run differ.
//   node scripts/readme-outputs.mjs          rewrite the files
//   node scripts/readme-outputs.mjs --check  exit 1 on drift
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url);
const MARKER = /^<!-- output: (.+) -->$/;
export const DOCS = ['README.md', 'docs/RESULTS.md'];

/** @param {string} text @returns {Array<{ command: string, start: number, end: number }>} line indexes of each block */
export function findBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = MARKER.exec(lines[i]);
    if (!m) continue;
    if (lines[i + 1] !== '```text') throw new Error(`line ${i + 2}: a \`\`\`text block must follow the marker`);
    const end = lines.indexOf('```', i + 2);
    if (end < 0) throw new Error(`line ${i + 2}: unclosed block`);
    blocks.push({ command: m[1], start: i + 2, end });
  }
  return blocks;
}

/** @param {string} command a script path and its arguments, run with this node */
export function runCommand(command) {
  const [script, ...args] = command.split(' ');
  return execFileSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8' }).replace(/\n+$/, '');
}

/** @param {string} text */
export function refresh(text) {
  const lines = text.split('\n');
  for (const { command, start, end } of findBlocks(text).reverse()) {
    lines.splice(start, end - start, ...runCommand(command).split('\n'));
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let drift = false;
  for (const doc of DOCS) {
    const path = new URL(doc, ROOT);
    const before = readFileSync(path, 'utf8');
    const after = refresh(before);
    if (process.argv.includes('--check')) {
      if (after !== before) drift = true;
      console.log(`${doc}: ${findBlocks(before).length} output blocks ${after === before ? 'match' : 'DIFFER'}`);
    } else {
      writeFileSync(path, after);
      console.log(`${doc}: ${findBlocks(after).length} output blocks rewritten`);
    }
  }
  if (drift) process.exit(1);
}
