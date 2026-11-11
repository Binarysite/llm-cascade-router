// The results block under the README headline, from fresh bench runs and the committed reports.
//   node scripts/headline.mjs
import { readFile } from 'node:fs/promises';
import { measure } from '../src/eval.js';
import { createStickerShopRouter } from '../examples/sticker-shop/router.js';
import { createKeywordClassifier } from '../examples/sticker-shop/classifier.js';

/** @param {string} p */
const read = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8'));
/** @param {any} slots */
const build = (slots) => createStickerShopRouter({ classify: null, ...slots });
/** @param {string} bank */
const shop = async (bank) => measure(await read(bank), { build, classify: createKeywordClassifier() });
const inSample = await shop('bench/messages.json');
const heldOut = await shop('bench/held-out.json');
const real = (await read('reports/real-deepseek.json')).banks.heldOut.realModel;
const clinc = (await read('reports/clinc150.json')).test['layers 1-2, then LLM'];

const pct = (/** @type {number} */ k, /** @type {number} */ n) => `${k}/${n} (${((100 * k) / n).toFixed(1)}%)`;
const share = (/** @type {any} */ r) => pct(r.answeredWithoutMainLlm, r.total);
const rows = [
  ['', 'wrong fixed answers', 'answered without the main LLM'],
  [`sticker shop, in-sample (${inSample.total}, mock in layer 3)`, `${inSample.fixedAnswers.wrong} of ${
    inSample.fixedAnswers.given}`, share(inSample)],
  [`sticker shop, held-out (${heldOut.total}, mock in layer 3)`, `${heldOut.fixedAnswers.wrong} of ${
    heldOut.fixedAnswers.given}`, share(heldOut)],
  [`sticker shop, held-out (${real.total}, deepseek-flash in layer 3)`, `${real.fixedAnswers.wrong} of ${
    real.fixedAnswers.given}`, `${share(real)}, McNemar p = ${real.versusKeywordMock.answeredWithoutMainLlm.mcnemarP}`],
  [`CLINC150 test (${clinc.n}, layers 1-2 only)`, `${clinc.wrong} of ${clinc.answered}`,
    `${pct(clinc.answered, clinc.n)}; ${clinc.right} of ${clinc.answerable} answerable`],
];
const w = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
for (const r of rows) console.log(r.map((cell, c) => cell.padEnd(w[c])).join('  ').trimEnd());
