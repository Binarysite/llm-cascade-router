// Shared JSDoc types for the layers. No runtime code.

/**
 * @typedef {object} LayerInput
 * @property {string} message      the raw message
 * @property {string} normalized   the message after normalize()
 * @property {unknown} [context]   passed through from route()
 * @property {AbortSignal} [signal] the caller's signal
 */

/**
 * @typedef {object} LayerOutcome
 * @property {'hit' | 'miss' | 'skipped' | 'error' | 'timeout' | 'aborted'} outcome
 * @property {string} reason
 * @property {string | null} [answerId]
 * @property {string} [reply]      only on a hit
 * @property {number} [score]      layer 2
 * @property {number} [confidence] layer 3
 * @property {unknown} [usage]    layer 3, when the classifier returned one
 * @property {object} [output]     layer 4, when generate returned an object
 */

/**
 * @typedef {object} Layer
 * @property {'exact' | 'score' | 'classifier' | 'llm'} name
 * @property {(input: LayerInput) => Promise<LayerOutcome>} run
 */

export {};
