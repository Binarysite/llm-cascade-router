#!/usr/bin/env node
// Download the CLINC150 data (github.com/clinc/oos-eval, CC BY 3.0) at a pinned
// commit, check each file's SHA-256 and keep it in bench/clinc150/data/, which
// git ignores. The files are plain JSON and are only ever parsed, never run.
//   node bench/clinc150/fetch.js
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const COMMIT = '828f8093932c8fe6ca7936c3d2e52903b1c523de';
export const FILES = {
  'data_full.json': '36923c3705a59e08fe9c3883d8bc2dd966ef93e22cb78ac41171782a698d56e0',
  'domains.json': 'b947b579d3b8e74b06f93b01083d8efaff2888b43a3e362533bd88a6e1211b3a',
};
export const DATA_DIR = new URL('./data/', import.meta.url);

const sha256 = (/** @type {Buffer} */ buf) => createHash('sha256').update(buf).digest('hex');

/** Read a data file and check its hash; throws when it is missing or differs. @param {keyof typeof FILES} name */
export async function readChecked(name) {
  const buf = await readFile(new URL(name, DATA_DIR));
  if (sha256(buf) !== FILES[name]) throw new Error(`${name}: SHA-256 differs from the pinned one; run fetch.js again`);
  return JSON.parse(buf.toString('utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await mkdir(DATA_DIR, { recursive: true });
  for (const [name, expected] of Object.entries(FILES)) {
    const url = `https://raw.githubusercontent.com/clinc/oos-eval/${COMMIT}/data/${name}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha256(buf);
    if (got !== expected) throw new Error(`${name}: SHA-256 ${got}, expected ${expected}; not saved`);
    await writeFile(new URL(name, DATA_DIR), buf);
    console.log(`${name}: ${buf.length} bytes, SHA-256 OK`);
  }
}
