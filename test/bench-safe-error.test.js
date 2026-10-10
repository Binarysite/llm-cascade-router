import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeErrorLabel } from '../bench/safe-error.js';

test('the report keeps the HTTP status and never the provider body', () => {
  const body = new Error('deepseek HTTP 401 invalid key sk-abc123...');
  assert.equal(safeErrorLabel(body), 'HTTP 401');
  assert.equal(safeErrorLabel(new Error('claude: HTTP 429 rate limited')), 'HTTP 429');
});

test('an error without a status is stored by its name, not its message', () => {
  const abort = Object.assign(new Error('The operation was aborted; key sk-xyz'), { name: 'AbortError' });
  assert.equal(safeErrorLabel(abort), 'AbortError');
  assert.equal(safeErrorLabel(new SyntaxError('Unexpected token in sk-xyz')), 'SyntaxError');
  assert.equal(safeErrorLabel({ message: 'no name here' }), 'Error');
});
