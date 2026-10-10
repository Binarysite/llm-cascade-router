import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Dependabot watches only GitHub Actions, weekly', async () => {
  const yml = await read('.github/dependabot.yml');
  assert.deepEqual(yml.match(/package-ecosystem: [\w-]+/g), ['package-ecosystem: github-actions']);
  assert.match(yml, /interval: weekly/);
});

test('the changelog has an entry for the version in package.json', async () => {
  const { version } = JSON.parse(await read('package.json'));
  const heading = `## [${version}] - `;
  const line = (await read('CHANGELOG.md')).split('\n').find((l) => l.startsWith(heading));
  assert.match(line ?? '', /^## \[[\d.]+\] - \d{4}-\d{2}-\d{2}$/, `no "${heading}YYYY-MM-DD" heading`);
});
