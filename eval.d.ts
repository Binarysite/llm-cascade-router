// Types for the evaluation helpers (src/eval.js), published as "llm-cascade-router/eval".
import type { Classify, Generate, RouteResult } from './index.js';

export interface LabelledMessage {
  text: string;
  /** An answer id, or "llm" for a message that must reach the model. */
  expect: string;
}

export interface MeasuredRow {
  text: string;
  expect: string;
  layer: string;
  answerId: string | null;
  verdict: 'right' | 'wrong' | 'escalated';
  reason: string;
  /** Time spent in layer 3 on this turn, null when it did not run. */
  classifierMs: number | null;
}

export interface LayerCounts {
  turns: number;
  right: number;
  wrong: number;
  escalated: number;
}

export interface LatencySummary {
  n: number;
  p50: number | null;
  /** null under 20 samples, where it would be the maximum. */
  p95: number | null;
  max: number | null;
}

export interface MeasureReport {
  total: number;
  withFixedAnswer: number;
  llmCalls: number;
  classifierConfigured: boolean;
  classifierCalls: number;
  classifierAnswers: number;
  classifierRight: number;
  classifierWrong: number;
  /** Classifier replies whose choice was a string that is not an answer id. */
  unknownChoices: number;
  /** classifierRight / classifierCalls: a model classifier saves money only below this cost ratio. */
  breakEven: number;
  answeredWithoutMainLlm: number;
  interval95: [number, number];
  fixedAnswers: {
    given: number;
    right: number;
    wrong: number;
    precision: number | null;
    interval95: [number, number];
  };
  /** Layer 3 time on turns that still reached the LLM or the fallback. */
  escalatedLatencyMs: LatencySummary;
  byLayer: Record<'exact' | 'score' | 'classifier' | 'llm' | 'fallback', LayerCounts>;
  wrong: MeasuredRow[];
  escalated: MeasuredRow[];
  rows: MeasuredRow[];
}

export interface MeasureOptions {
  /** Builds the router from the slots; a fresh one per call keeps call counts per bank. */
  build: (slots: { classify?: Classify; generate: Generate }) => {
    route: (message: string) => Promise<RouteResult>;
  };
  /** Goes in layer 3 and is counted. Omitted or null: no classifier. */
  classify?: Classify | null;
}

export function measure(bank: ReadonlyArray<LabelledMessage>, options: MeasureOptions): Promise<MeasureReport>;

export function format(
  report: MeasureReport,
  options?: { verbose?: boolean; noun?: string; classifierNote?: string },
): string[];

export function createMockLlm(): Generate & { calls: () => number };

/** 95% Wilson score interval for k successes out of n; [0, 1] when n is 0. Throws RangeError unless 0 <= k <= n. */
export function wilson95(k: number, n: number): [number, number];

/**
 * Two-sided exact McNemar p-value for b and c discordant pairs.
 * Throws RangeError unless both are non-negative integers.
 */
export function mcnemarExact(b: number, c: number): number;

export function latencySummary(samples: ReadonlyArray<number>): LatencySummary;
