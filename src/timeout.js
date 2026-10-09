/** Raised when an injected layer does not settle within its time budget. */
export class LayerTimeoutError extends Error {
  /** @param {string} layer @param {number} timeoutMs */
  constructor(layer, timeoutMs) {
    super(`${layer} did not answer within ${timeoutMs} ms`);
    this.name = 'LayerTimeoutError';
  }
}

/** Raised when the caller's signal aborts while a layer is running. */
export class CallerAbortError extends Error {
  constructor() {
    super('aborted by caller');
    this.name = 'CallerAbortError';
  }
}

/**
 * Run `fn` with its own AbortSignal and a deadline. The signal fires when the
 * deadline passes or the caller's signal aborts, so a well-behaved callee can
 * cancel its request; a callee that ignores the signal is simply not waited for.
 * @template T
 * @param {string} layer
 * @param {(signal: AbortSignal) => T | Promise<T>} fn
 * @param {number} timeoutMs
 * @param {AbortSignal} [parent]
 * @returns {Promise<T>}
 */
export async function withTimeout(layer, fn, timeoutMs, parent) {
  // An abort that already happened fires no 'abort' event, so check it first.
  if (parent?.aborted) throw new CallerAbortError();
  const controller = new AbortController();
  let timer;
  let onParentAbort;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new LayerTimeoutError(layer, timeoutMs);
      controller.abort(err);
      reject(err);
    }, timeoutMs);
    onParentAbort = () => {
      const err = new CallerAbortError();
      controller.abort(err);
      reject(err);
    };
    parent?.addEventListener('abort', onParentAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), stop]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}
