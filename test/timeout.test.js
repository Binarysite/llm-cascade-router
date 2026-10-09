import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, CallerAbortError, LayerTimeoutError } from '../src/timeout.js';

test('withTimeout rejects at once when the caller signal is already aborted', async () => {
  let called = false;
  const t0 = performance.now();
  await assert.rejects(
    withTimeout('classifier', () => { called = true; return 'x'; }, 5000, AbortSignal.abort()),
    CallerAbortError,
  );
  assert.equal(called, false);
  assert.ok(performance.now() - t0 < 1000);
});

test('withTimeout rejects with LayerTimeoutError and aborts the callee signal', async () => {
  let seen;
  await assert.rejects(
    withTimeout('llm', (signal) => { seen = signal; return new Promise(() => {}); }, 10),
    LayerTimeoutError,
  );
  assert.equal(seen.aborted, true);
});
