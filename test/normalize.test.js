import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, tokenize, editDistance } from '../src/normalize.js';

test('normalize folds case, accents, punctuation and whitespace', () => {
  assert.equal(normalize('  Whats   the PRICE?!  '), 'whats the price');
  assert.equal(normalize("What's the price"), 'whats the price');
  assert.equal(normalize('What’s the price'), 'whats the price');
  assert.equal(normalize('Café crème, síl vous plaît'), 'cafe creme sil vous plait');
  assert.equal(normalize('size: 3"x3" (matte)'), 'size 3 x3 matte');
});

test('normalize gives the same string for composed and decomposed text', () => {
  const composed = 'Caf\u00e9 cr\u00e8me';
  const decomposed = 'Cafe\u0301 cre\u0300me';
  assert.notEqual(composed, decomposed);
  assert.equal(normalize(composed), normalize(decomposed));
  assert.equal(normalize(composed), 'cafe creme');
});

test('normalize folds compatibility forms: ligatures and fullwidth letters', () => {
  assert.equal(normalize('\uFB01le'), 'file');
  assert.equal(normalize('\uFF30\uFF2E\uFF27 or SVG'), 'png or svg');
  assert.equal(normalize('\u0130stanbul'), 'istanbul');
});

test('normalize keeps the marks of non-Latin scripts, where they are letters', () => {
  assert.equal(normalize('\u0928\u092e\u0938\u094d\u0924\u0947'), '\u0928\u092e\u0938\u094d\u0924\u0947');
  assert.deepEqual(tokenize('\u0928\u092e\u0938\u094d\u0924\u0947 \u0926\u094b\u0938\u094d\u0924'), [
    '\u0928\u092e\u0938\u094d\u0924\u0947',
    '\u0926\u094b\u0938\u094d\u0924',
  ]);
});

test('normalize returns an empty string for non-strings and punctuation-only input', () => {
  assert.equal(normalize(undefined), '');
  assert.equal(normalize(42), '');
  assert.equal(normalize('?!...'), '');
});

test('tokenize splits normalized text and returns [] for empty input', () => {
  assert.deepEqual(tokenize('Do you ship to Canada?'), ['do', 'you', 'ship', 'to', 'canada']);
  assert.deepEqual(tokenize('   '), []);
});

test('editDistance counts a transposition as one edit and stops past max', () => {
  assert.equal(editDistance('vinyl', 'vinyl', 1), 0);
  assert.equal(editDistance('vinyl', 'vinly', 1), 1);
  assert.equal(editDistance('sticker', 'stikcer', 1), 1);
  assert.equal(editDistance('sticker', 'stickers', 1), 1);
  assert.equal(editDistance('shipping', 'shopping', 1), 1);
  assert.equal(editDistance('matte', 'glossy', 1), 2);
});
