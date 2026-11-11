// The output blocks in the README and docs/RESULTS.md are real runs. Each block
// follows a marker line
//   <!-- output: <script> [args...] -->
// and this script reruns the script with node and rewrites the block below it.
// test/readme.test.js fails when a block and a fresh run differ.
//   node scripts/readme-outputs.mjs          rewrite the files
//   node scripts/readme-outputs.mjs --check  exit 1 on drift
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const MARKER = /^<!-- output: (.+) -->$/;
const ROOT_PATH = fileURLToPath(ROOT);
const TIMEOUT_MS = 60_000;

/** The only commands a marker may run: exactly what the README and docs/RESULTS.md document today.
 *  A marker is text in a Markdown file, so it is never trusted to name what to execute. */
const COST_ARGS = '--main-in 1.32 --main-out 3.96 --prompt-tokens 2000 --output-tokens 300 --main-ms 3000';
export const ALLOWED_COMMANDS = Object.freeze([
  'scripts/headline.mjs',
  'examples/sticker-shop/ask.js',
  'bench/clinc150/show.js --short',
  'bench/run.js',
  'bench/show-real.js',
  'bench/clinc150/show.js',
  `bench/cost.js ${COST_ARGS}`,
  `bench/cost.js ${COST_ARGS} --answerable-share 0.5`,
  `bench/cost.js ${COST_ARGS} --wrong-cost 0.05`,
  'bin/cascade.js',
]);
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

/** @param {string} command @throws {Error} unless the command is on the allowlist */
export function assertAllowed(command) {
  if (!ALLOWED_COMMANDS.includes(command)) {
    throw new Error(`marker command not on the allowlist: ${JSON.stringify(command)}`);
  }
}

/** @param {string} command an allowlisted script path and its arguments, run with this node */
export function runCommand(command) {
  assertAllowed(command);
  const [script, ...args] = command.split(' ');
  const path = resolve(ROOT_PATH, script);
  const rel = relative(ROOT_PATH, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`script escapes the repo root: ${script}`);
  return execFileSync(process.execPath, ['--', path, ...args], {
    cwd: ROOT_PATH, encoding: 'utf8', timeout: TIMEOUT_MS,
  }).replace(/\n+$/, '');
}

/** @param {string} text @param {(command: string) => string} [run] injectable for tests */
export function refresh(text, run = runCommand) {
  const lines = text.split('\n');
  const before = findBlocks(text).map((b) => b.command);
  for (const { command, start, end } of findBlocks(text).reverse()) {
    const out = run(command).split('\n');
    const bad = out.find((l) => MARKER.test(l) || l.trimStart().startsWith('```'));
    if (bad !== undefined) {
      throw new Error(`output of "${command}" contains a marker or code fence line: ${JSON.stringify(bad)}`);
    }
    lines.splice(start, end - start, ...out);
  }
  const result = lines.join('\n');
  const after = findBlocks(result).map((b) => b.command);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('refresh changed the set of output markers');
  return result;
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
