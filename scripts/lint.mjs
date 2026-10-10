// Dependency-free lint: every .js/.mjs file must parse (node --check). Every
// text file must have no tabs, no em dashes, no trailing whitespace, a final newline and, for
// code, lines of at most 120 characters (.editorconfig).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIRS = ['src', 'test', 'examples', 'bench', 'bin', 'scripts', 'docs', 'typecheck', '.github'];
const ROOT_FILES = [
  'README.md', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md',
  'package.json', 'index.d.ts', 'claude.d.ts', 'tsconfig.json', 'tsconfig.strict.json',
];
const MAX_LINE = 120;
const CODE = new Set(['.js', '.mjs', '.ts', '.yml']);
const TEXT = new Set(['.js', '.mjs', '.ts', '.json', '.md', '.yml']);

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const files = [...DIRS.filter(existsSync).flatMap(walk), ...ROOT_FILES.filter(existsSync)]
  .filter((f) => TEXT.has(extname(f)));

const problems = [];
for (const file of files) {
  if (['.js', '.mjs'].includes(extname(file))) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      problems.push(`${file}: ${String(err.stderr).trim()}`);
    }
  }
  const text = readFileSync(file, 'utf8');
  if (text.length && !text.endsWith('\n')) problems.push(`${file}: missing final newline`);
  text.split('\n').forEach((line, i) => {
    if (/\t/.test(line)) problems.push(`${file}:${i + 1}: tab`);
    if (line.includes('\u2014')) problems.push(`${file}:${i + 1}: em dash`);
    if (/[ \t]+$/.test(line)) problems.push(`${file}:${i + 1}: trailing whitespace`);
    if (CODE.has(extname(file)) && line.length > MAX_LINE) problems.push(`${file}:${i + 1}: longer than ${MAX_LINE}`);
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`lint: ${files.length} files OK`);
