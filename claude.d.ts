// Types for the optional Claude adapters (src/adapters/claude.js),
// published as the "llm-cascade-router/claude" entry point.
import type { ClassifierInput, ClassifierOutput, LlmInput } from './index.js';

interface ClientOptions {
  /** Required: the model id to call. */
  model: string;
  /** Defaults to process.env.ANTHROPIC_API_KEY. */
  apiKey?: string;
  fetch?: typeof fetch;
  /** Defaults to https://api.anthropic.com/v1/messages. The API key is sent here: trusted hosts only. */
  url?: string;
}

/** What the Messages API reported for one call, passed through untouched. */
export type ClaudeUsage = unknown;

export interface ClaudeLlmOutput {
  reply: string;
  usage: ClaudeUsage;
  model: string;
  stopReason: string;
  [key: string]: unknown;
}

export function createClaudeLlm(
  options: ClientOptions & { system?: string; maxTokens?: number },
): (input: LlmInput) => Promise<ClaudeLlmOutput>;

export function createClaudeClassifier(
  options: ClientOptions & {
    instructions?: string;
    /**
     * Sent as output_config.effort only when given. Default null: not every model
     * accepts it, and a rejected request would fail every classifier call.
     */
    effort?: string | null;
    maxTokens?: number;
  },
): (input: ClassifierInput) => Promise<ClassifierOutput & { usage: ClaudeUsage }>;
