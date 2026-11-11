// Helpers shared by the optional adapters. Not part of the public API.

/**
 * Earlier turns from `context.messages`, when the caller passes them as
 * `[{ role: 'user' | 'assistant', content: string }]`. Anything else is dropped.
 * @param {unknown} context
 * @returns {Array<{ role: 'user' | 'assistant', content: string }>}
 */
export function historyOf(context) {
  const list = /** @type {{ messages?: unknown } | null | undefined} */ (context)?.messages;
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * A provider's error identifier from a JSON error body (`error.type`, or
 * `error.code`), or undefined. Kept only when it is a plain identifier; the
 * rest of the body is dropped, because a provider can echo a masked key in it.
 * @param {{ text: () => Promise<string> }} res
 * @returns {Promise<string | undefined>}
 */
export async function errorIdentifier(res) {
  let error;
  try {
    error = JSON.parse(await res.text())?.error;
  } catch {
    return undefined;
  }
  for (const value of [error?.type, error?.code]) {
    if (typeof value === 'string' && /^[a-z0-9_]{1,60}$/.test(value)) return value;
  }
  return undefined;
}

/**
 * Parse a classifier reply as JSON without copying the reply into the error,
 * since it can quote the user's message. A markdown code fence around it is tolerated.
 * @param {string} text
 * @param {string} who
 * @returns {Record<string, unknown>}
 */
export function parseClassifierReply(text, who) {
  let bare = text.trim();
  if (bare.startsWith('```')) {
    bare = bare.slice(3);
    if (bare.slice(0, 4).toLowerCase() === 'json') bare = bare.slice(4);
    if (bare.endsWith('```')) bare = bare.slice(0, -3);
    bare = bare.trim();
  }
  let out;
  try {
    out = JSON.parse(bare);
  } catch {
    throw new Error(`${who}: the reply is not JSON`);
  }
  if (out === null || typeof out !== 'object' || Array.isArray(out)) {
    throw new Error(`${who}: the reply is not a JSON object`);
  }
  return out;
}

/** The no-answer value offered to a model: "none", or "_none" when an answer id is "none". */
export const noAnswerValue = (/** @type {ReadonlyArray<string>} */ ids) => (ids.includes('none') ? '_none' : 'none');
