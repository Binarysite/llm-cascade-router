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
