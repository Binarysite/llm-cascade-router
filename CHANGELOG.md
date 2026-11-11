# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-11-11

### Added

- `bench/cost.js --wrong-cost USD`: the price of one wrong fixed answer (default 0, always
  printed). A wrong fixed answer also skips a main call, so the cost model used to count it as
  a saving: it now prints a `wrong` column per 1k turns, "saved calls, of which N are wrong
  answers", a break-even main-call price that includes the wrong answers, and the wrong-answer
  cost above which the model in layer 3 loses money. On the CLINC150 mix, 10.5 of the 62.5
  calls per 1k turns the model saves are wrong answers; past about USD 0.017 per wrong answer
  it loses money at the example main-call price.

### Fixed

- `mcnemarExact` returned 0 from 1,075 discordant pairs on, because `0.5 ** n` underflows;
  above 1,000 pairs it now sums in log space (`mcnemarExact(600, 600)` is 1, as it must be).
  Tests check it against an exact BigInt binomial sum.
- `wilson95(0, 0)` returns `[0, 1]` (no trials says nothing) instead of `[0, 0]`, and a count
  outside `0 <= k <= n` throws `RangeError`. The only report entry this moves is the precision
  interval of "LLM on every message" in `reports/clinc150.json`, which answers nothing.
- **The README headline tested the wrong metric.** It gave McNemar p = 0.125 for "answered
  without the main LLM", where one of the 4 messages the model moved off the LLM is a wrong
  fixed answer. On right answers it is 3 more right, 1 more wrong, none the other way: not
  significant (p = 0.25). `scripts/headline.mjs` now prints that from the report and the
  local mock run, and `bench/show-real.js` shows the right-answer test.
- **CLINC150: a comparison that could not fail is gone.** "Cascade vs layers 1-2" on right
  answers (104 vs 0, p < 0.0001) holds by construction, since the cascade keeps every answer
  layers 1-2 give. The report's `pairedRight` is replaced by `paired`: the cascade against the
  model alone on right (1 vs 1, p = 1) and on wrong answers (1 vs 0, p = 1), and the 46 of
  2,000 model calls layers 1-2 skip. `bench/clinc150/paired.js` recomputes it from the
  committed per-message rows, with no model call, and checks the rows reproduce the results.
- CLINC150 output shows the validation precision and its Wilson interval next to test: the
  selection rule reads a point estimate on 71 answered val messages for layers 1-2. The rule
  itself is unchanged.
- "Test scored once" is corrected to "scored at the validation-chosen thresholds; re-run once
  after a floating-point fix that did not move them", as the History in
  `bench/clinc150/README.md` says.
- The README says the CLINC150 model run passed custom `instructions` to the shipped adapter.

### Security

- The README drift tooling no longer executes whatever an `<!-- output: ... -->` marker says: only an
  allowlist of the documented commands runs, with `--` before the script path, a repo-root check and a
  60 s timeout. `refresh` rejects output that holds a marker or code fence line.

## [0.2.0] - 2026-11-11

### Upgrading from 0.1.1

- Avoid words now match exactly; add the variants you relied on typo tolerance for, or set
  `avoidTypos: true` on the answer. A multi-word avoid entry is now a setup error.
- `bench/measure.js` is gone from the package: import `measure`, `format`, `createMockLlm`
  and `wilson95` from `llm-cascade-router/eval`, and pass `build`.
- A `timeoutMs` above 2147483647 is now a setup error.

### Added

- **`llm-cascade-router/openai-compatible`**: `createOpenAiCompatibleClassifier` and
  `createOpenAiCompatibleLlm` for any Chat Completions endpoint (OpenAI, DeepSeek, a local
  server), over fetch, with `baseUrl` and `extraBody`. The classifier returns a model-invented
  id as given, so the router records it as an unknown choice instead of "no answer".
- `npm run bench:real` (`bench/real.js`): both banks with a real model in layer 3 through the
  shipped adapters, with right/wrong/escalated, latency (p95 only from 20 calls, and the time
  added on escalated turns), tokens, cost from returned usage, a `--max-usd` cap, the McNemar
  p-value against the keyword mock, and a check that the report does not contain the key.
  Run on 2026-11-11 with `deepseek-flash`: in-sample 32/49 answered without the main LLM, 0
  wrong; held-out 11/24, 2 wrong of 11 fixed answers, McNemar p = 0.125 against the mock;
  USD 0.0036 (`reports/real-deepseek.json`). `bench/show-real.js` prints it as a table. The
  October run with `deepseek-chat`, made with a client written inside the bench, is kept in
  `reports/archive/`. No Claude run: there is no Anthropic key.
- **`llm-cascade-router/eval`** (`src/eval.js`, typed in `eval.d.ts`): `measure`, `format`,
  `createMockLlm`, `wilson95`, `mcnemarExact` and `latencySummary`. The bench and the CLI
  import it, so the library no longer imports the sticker-shop example. `measure` takes a
  required `build` and an optional `classify`; `format` takes `classifierNote`.
- The bench prints the precision of fixed answers with a 95% Wilson interval, right under the
  wrong count, and the classifier's right, wrong and unknown-id answers.
- The README's output blocks carry a marker, `scripts/readme-outputs.mjs` regenerates them,
  and a test fails when one differs from a fresh run.
- The sticker-shop router takes `classifierTimeoutMs`, and `classify: null` to leave layer 3 out.

- **A public out-of-scope benchmark on CLINC150** (`bench/clinc150/`, CC BY 3.0, fetched at a
  pinned commit with SHA-256 checks, not committed). The 15 banking intents get fixed answers;
  the other 135 intents and out-of-scope queries must reach the LLM. Thresholds are chosen on
  validation and test is scored at the validation-chosen thresholds (re-run once after a
  floating-point fix that did not move them; see History in `bench/clinc150/README.md`):
  layers 1-2 answer 110 of 450 answerable test questions right with 2 wrong (precision 98.2%, 95% interval 93.7% to 99.5%). Baselines on the same
  split: a TF-IDF nearest neighbour alone and in layer 3, and `deepseek-flash` alone and in
  layer 3 on a seeded 2,000-message sample (149 of 166 right, 22 wrong at the default
  `minConfidence`; USD 0.13). A sweep of every threshold on test is in `reports/clinc150.json`
  and drawn in `reports/clinc150-tradeoff.svg`; CI reruns the local part and the chart.
- `npm run cost` (`bench/cost.js`): dollars per 1,000 turns and p50/p95 latency per turn for
  each configuration, for a main model's price, tokens and latency you give, and the main-call
  price below which the model in layer 3 loses money.
- `NOTICE` with the dataset's attribution.

### Changed

- Layer 2 compares each message word with each phrase word once per message instead of once
  per phrase: same scores, about 6 times faster with 1,500 phrases.

- **The README is built around the results**: a block under the headline (wrong fixed answers
  first) generated by `scripts/headline.mjs`, the CLINC150 table and chart, and one place
  for the caveats (Limits). Full outputs move to `docs/RESULTS.md`, the agent-eval-harness
  section to `docs/agent-eval-harness.md`. Every output block in both files is checked
  against a fresh run. The held-out real-model result is reported as right/wrong/escalated
  with its McNemar p-value (0.125, not significant), not as a share next to the ceiling.
- `npm run ask` no longer prints a tally of its four hand-picked demo messages.
- **Avoid words match exactly** (after normalization and synonyms). One-typo matching is now
  opt-in per answer with `avoidTypos: true`. A fuzzy veto misfired: "charge" vetoed answers
  whose avoid words were "change" and "charged".
- Setup rejects an avoid entry of more than one word (it used to veto on each word alone).
- **The classifier break-even counts right answers only** (right / calls). It counted every
  answer, so a wrong answer looked like a saving. Wrong answers are reported apart.
- The lint no longer checks for em dashes.
- Layer 2 reports `margin` (top score minus the runner-up's) in its trace step.
- An error thrown by `classify` or `generate` reaches the trace as its name and at most 200
  characters of its message; an unknown classifier choice is cut to 60 characters.
- `createClaudeLlm` sends earlier turns passed as `context.messages`.
- `validateConfig` is typed `(config: unknown) => NormalizedConfig`, and the config types
  accept readonly arrays. `npm run typecheck` runs `strict` on `src/`.

### Fixed

- **A vetoed answer no longer hands the win to the runner-up.** Layer 2 used to drop vetoed
  answers before ranking, so "what do you charge for shipping" got the international answer
  at 0.5 with no competitor. Vetoed answers are now ranked: a vetoed best answer is a miss,
  and a vetoed runner-up still counts for the margin. The message is in the in-sample bank.
- A `timeoutMs` above 2147483647 is rejected; Node clamped it to 1 ms, timing out every call.
- `validateConfig` now freezes the `answers` array, as documented.
- A `"__proto__"` synonym group (possible from `JSON.parse`) was silently dropped; it is kept.
- A 20,000-word message took about 240 ms in layer 2; it is now skipped after one split when
  it has more than 4 x `maxTokens` words. The avoid check builds its word set once per turn.

### Security

- Provider error bodies are no longer copied into thrown errors (they can echo a masked key).
- A Claude classifier reply that is not JSON throws an error that does not quote the reply.
- `bench/real.js` no longer stores provider error bodies in the report (they can echo a masked key).

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

[Unreleased]: https://github.com/Binarysite/llm-cascade-router/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/Binarysite/llm-cascade-router/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Binarysite/llm-cascade-router/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Binarysite/llm-cascade-router/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Binarysite/llm-cascade-router/releases/tag/v0.1.0
