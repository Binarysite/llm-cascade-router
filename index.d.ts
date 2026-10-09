// Public types of llm-cascade-router (src/index.js).
// `npm run typecheck` checks the JSDoc in src/ and, through typecheck/conform.ts,
// that src/index.js provides what this file declares.

/** A prepared answer the cheap layers can return without calling a model. */
export interface Answer {
  /** Stable id, reported as `answerId` and offered to the classifier as a choice. */
  id: string;
  /** Sent to the user verbatim. */
  reply: string;
  /** Example questions. Layer 1 matches them exactly (after normalization), layer 2 scores against them. */
  phrases: string[];
  /** Words that veto this answer in every cheap layer, e.g. "damaged" on a shipping-time answer. */
  avoid?: string[];
  /** What the classifier sees for this choice. Defaults to the first phrase. */
  description?: string;
}

export interface ScoreOptions {
  /** Minimum Dice similarity, 0..1. Default 0.5 (an example value, tune it with the bench). */
  minScore?: number;
  /** The best answer must beat the runner-up by this much. Default 0.1. */
  minMargin?: number;
  /** Messages with more content words than this skip local scoring. Default 12. */
  maxTokens?: number;
  /** Let words of 5+ letters match with one edit (typo or transposition). Default true. */
  typoTolerance?: boolean;
}

export interface Choice {
  id: string;
  description: string;
}

export interface ClassifierInput {
  message: string;
  choices: ReadonlyArray<Choice>;
  context?: unknown;
  /** Fires when the layer's timeout passes or the caller aborts. */
  signal: AbortSignal;
}

export interface ClassifierOutput {
  /** An answer id, or null to abstain. */
  choice: string | null;
  /** 0..1. */
  confidence: number;
  /** Optional token usage, copied to the classifier's trace step. */
  usage?: unknown;
}

export type Classify = (input: ClassifierInput) => ClassifierOutput | Promise<ClassifierOutput>;

export interface ClassifierOptions {
  classify: Classify;
  /** Default 0.8 (an example value). */
  minConfidence?: number;
  /** Default 1000 ms (an example value sized for one call to a small model; a local classifier needs less). */
  timeoutMs?: number;
}

export interface LlmInput {
  message: string;
  context?: unknown;
  signal: AbortSignal;
}

/** Extra fields (tool calls, usage...) are kept and returned as `RouteResult.llmOutput`. */
export type LlmOutput = { reply: string; [key: string]: unknown };

export type Generate = (input: LlmInput) => string | LlmOutput | Promise<string | LlmOutput>;

export interface LlmOptions {
  generate: Generate;
  /** Default 10000 ms. */
  timeoutMs?: number;
}

export interface RouterConfig {
  answers: Answer[];
  /** `{ canonical: [variants] }`, single words only. Used by layer 2 and the avoid check. */
  synonyms?: Record<string, string[]>;
  /** Words ignored by layer 2. */
  stopwords?: string[];
  score?: ScoreOptions;
  /** Omitted or null: layer 3 is skipped. */
  classifier?: ClassifierOptions | null;
  /** Omitted or null: layer 4 is skipped and a miss ends in the fallback. */
  llm?: LlmOptions | null;
  /** Sent when nothing answers, including when the LLM fails or times out. */
  fallback: string;
  /**
   * Called with every result, for logging, before `route` resolves. A throw or a
   * rejected promise is swallowed; keep synchronous work short.
   */
  onResult?: ((result: RouteResult) => void | Promise<void>) | null;
}

export type LayerName = 'exact' | 'score' | 'classifier' | 'llm';

export interface TraceStep {
  layer: LayerName;
  outcome: 'hit' | 'miss' | 'skipped' | 'error' | 'timeout' | 'aborted';
  reason: string;
  latencyMs: number;
  answerId?: string | null;
  /** Layer 2 only. */
  score?: number;
  /** Layer 3 only. */
  confidence?: number;
  /** Layer 3 only: the `usage` field the classifier returned, if any, on a hit or a miss. */
  usage?: unknown;
}

export interface RouteResult {
  reply: string;
  layer: LayerName | 'fallback';
  /** The fixed answer given, or null for the LLM and the fallback. */
  answerId: string | null;
  /** Why this layer answered, or why the fallback was used. */
  reason: string;
  /** Whether the LLM was called, even if it then failed. */
  llmCalled: boolean;
  /** What generate returned, when it returned an object. */
  llmOutput?: LlmOutput;
  latencyMs: number;
  /** One step per layer that ran, in order. */
  trace: TraceStep[];
}

export interface RouteOptions {
  context?: unknown;
  signal?: AbortSignal;
}

export interface Router {
  /** Never rejects. A `signal` that is not an AbortSignal is ignored. */
  route(message: unknown, options?: RouteOptions | null): Promise<RouteResult>;
}

/** Throws RouterConfigError on an invalid config. */
export function createRouter(config: RouterConfig): Router;

/** Validates a config and returns a frozen copy with defaults filled in. */
export function validateConfig(config: RouterConfig): Readonly<RouterConfig>;

export class RouterConfigError extends Error {
  constructor(problems: string[]);
  readonly problems: string[];
}

export const DEFAULTS: Readonly<{
  score: Readonly<Required<ScoreOptions>>;
  classifier: Readonly<{ minConfidence: number; timeoutMs: number }>;
  llm: Readonly<{ timeoutMs: number }>;
}>;

/** NFKD, lowercase, strip Latin/Greek/Cyrillic accents, apostrophes and punctuation, collapse whitespace. */
export function normalize(text: unknown): string;

export function tokenize(text: unknown): string[];
