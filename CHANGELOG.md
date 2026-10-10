# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-10

### Added

- `npm run ask` with no message routes four demo messages, one per layer, and prints each
  layer's reason. With a message it still prints the full result as JSON.
- `npm run bench` prints a 95% Wilson interval under the share answered without the main LLM.
- `bin/cascade.js` (`npm run measure`): run a JSON config against your own labelled messages
  with layers 1 and 2 and a counting mock LLM. `examples/starter/` holds a config and ten
  messages copied from the sticker shop. Exit codes: 0 ok, 1 wrong fixed answer, 2 setup problem.
- A CodeQL workflow, and a coverage floor on `src/` (95% lines, 90% branches) in CI.
- The lint rejects em dashes in text files.

### Changed

- The README starts with a 30-second run, a diagram of the layers, the decisions and the limits.

## [0.1.0] - 2026-10-09

### Added

- `bench/held-out.json`: 24 messages, 6 of them adversarial, written without looking at the
  example's vocabulary. `npm run bench` reports it next to the in-sample bank with the same
  table. Only the in-sample bank sets the exit code. `npm run bench -- --json` returns
  `{ inSample, heldOut }`.
- Four layers in a fixed order, cheapest first: `exact` (normalized phrase match), `score`
  (Dice similarity of content words with a minimum score and a margin over the runner-up), an
  injected `classifier` and the `llm`. A layer that throws or times out hands the message to
  the next one, and a failed LLM turn returns the configured `fallback`.
- Normalization that folds case and accents, synonyms, stopwords and one-typo tolerance in
  longer words, shared by the local layers.
- `avoid` words that veto an answer in layers 2 and 3. Setup rejects an avoid word that is a
  stopword or that matches the answer's own phrases through synonyms or typos.
- `createRouter` validates the whole config and throws `RouterConfigError` listing every
  problem; after that, `route` never rejects.
- A trace step per layer in every result (outcome, reason, time), with the classifier's
  `usage` copied to its step. The cheap layers never copy the user's message into the result.
- Timeouts that abort the classifier and LLM calls through an `AbortSignal` linked to the
  caller's.
- Optional Claude adapters for the classifier (structured JSON with an enum of answer ids) and
  LLM slots, over `fetch`, with no SDK.
- A sticker-shop example with a keyword mock classifier and a mock LLM, and a bench over 48
  labelled messages that exits 1 on a wrong fixed answer.
- Type declarations checked against the code, a dependency-free lint, and CI on Node 22 and
  24.

[Unreleased]: https://github.com/Binarysite/llm-cascade-router/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Binarysite/llm-cascade-router/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Binarysite/llm-cascade-router/releases/tag/v0.1.0
