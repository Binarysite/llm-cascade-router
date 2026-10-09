/**
 * A mock LLM so the example and the benchmark run offline and deterministic.
 * It counts its calls, which is the number the benchmark cares about.
 * Swap in `createClaudeLlm` from src/adapters/claude.js (or your own client)
 * for real replies.
 */
export function createMockLlm() {
  let calls = 0;
  /** @param {{ message: string }} input */
  async function generate({ message }) {
    calls += 1;
    return `[model reply to: ${message}]`;
  }
  generate.calls = () => calls;
  return generate;
}
