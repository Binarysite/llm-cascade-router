#!/usr/bin/env node
// Run two labelled message banks through the sticker-shop router and report,
// for each, which layer answered, how often the cheap layers were right, how
// many turns needed no call to the main LLM, and how often the classifier ran.
//
// in-sample  bench/messages.json, written by the author of the vocabulary.
//            The exit code depends on it: 1 on any wrong fixed answer.
// held-out   bench/held-out.json, written without looking at the vocabulary
//            or the answers' phrases. Reported, never tuned for, and it does
//            not change the exit code (see docs/DESIGN.md).
//
//   npm run bench               summary
//   npm run bench -- --verbose  one line per message
//   npm run bench -- --json     machine-readable summary
import { readFile } from 'node:fs/promises';
import { measure, format } from '../src/eval.js';
import { createStickerShopRouter } from '../examples/sticker-shop/router.js';
import { createKeywordClassifier } from '../examples/sticker-shop/classifier.js';

const args = new Set(process.argv.slice(2));
const verbose = args.has('--verbose') || args.has('-v');
const asJson = args.has('--json');

const load = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
/** @param {Parameters<typeof createStickerShopRouter>[0]} slots */
const build = (slots) => createStickerShopRouter({ classify: null, ...slots });
/** @param {string} name */
const run = async (name) => measure(await load(name), { build, classify: createKeywordClassifier() });
const inSample = await run('./messages.json');
const heldOut = await run('./held-out.json');
process.exitCode = inSample.wrong.length ? 1 : 0;

if (asJson) {
  const strip = ({ rows, ...rest }) => rest;
  console.log(JSON.stringify({ inSample: strip(inSample), heldOut: strip(heldOut) }, null, 2));
} else {
  console.log('sticker-shop example: keyword mock classifier, mock LLM\n');
  console.log('== in-sample: bench/messages.json, written with the vocabulary ==');
  const options = { verbose, noun: 'invented messages', classifierNote: 'keyword mock here, not a model' };
  console.log(format(inSample, options).join('\n'));
  console.log('\n== held-out: bench/held-out.json, written without looking at the vocabulary ==');
  console.log(format(heldOut, options).join('\n'));
}
