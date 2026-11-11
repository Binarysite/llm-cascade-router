// Types for the OpenAI-compatible adapters (src/adapters/openai-compatible.js),
// published as the "llm-cascade-router/openai-compatible" entry point.
import type { ClassifierInput, ClassifierOutput, LlmInput } from './index.js';

interface ClientOptions {
  /** Required: the model id to call. */
  model: string;
  /** Defaults to process.env.OPENAI_API_KEY. Sent as a Bearer token to baseUrl: trusted hosts only. */
  apiKey?: string;
  /** Defaults to https://api.openai.com/v1; requests go to `${baseUrl}/chat/completions`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Merged into every request body, for provider-specific fields. */
  extraBody?: Record<string, unknown>;
}

export interface OpenAiCompatibleLlmOutput {
  reply: string;
  /** What the endpoint reported, passed through untouched. */
  usage: unknown;
  model: string;
  finishReason: string;
  [key: string]: unknown;
}

/**
 * The LLM slot. Earlier turns can be passed as `context.messages`:
 * `[{ role: 'user' | 'assistant', content: string }]`; without them the call is single-turn.
 */
export function createOpenAiCompatibleLlm(
  options: ClientOptions & { system?: string; maxTokens?: number; temperature?: number },
): (input: LlmInput) => Promise<OpenAiCompatibleLlmOutput>;

/**
 * The classifier slot. The choice comes back as the model gave it, so an invented id
 * reaches the router as an unknown choice (a miss) instead of being hidden as "no answer".
 */
export function createOpenAiCompatibleClassifier(
  options: ClientOptions & {
    instructions?: string;
    /** Default 100. */
    maxTokens?: number;
    /** Default 0. */
    temperature?: number;
    /** Sends response_format json_object. Default true. */
    jsonMode?: boolean;
  },
): (input: ClassifierInput) => Promise<ClassifierOutput & { usage: unknown }>;
