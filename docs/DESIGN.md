# Design notes

Why the router works the way it does, what it cannot do, and where the code
lives. The [README](../README.md) covers running it.

## Decisions and trade-offs

**A strict order, cheapest first.** Racing the classifier and the LLM would cut
latency on turns that reach the model, but every turn would pay for a model
call, which is the cost this exists to avoid. Layers 1 and 2 cost microseconds
and no network; only misses pay for the next layer.

**The trace is part of the result.** Every result says which layer answered,
why (the phrase, the score and runner-up, the classifier's confidence) and how
long each layer took: without it, a strict threshold and a short phrase list
look the same. A logger that throws is ignored.

**Setup throws, routing never does.** A bad config fails at boot with every
problem listed, so the deploy finds the typo, not a customer. After that a
layer that throws is recorded as `error`, one that runs out of time as
`timeout`, and the next layer runs. If the LLM fails, the user gets
`config.fallback`, a string you reviewed, and the reason names what failed
(`llm timeout: LayerTimeoutError: llm did not answer within 8000 ms`).

**Dice similarity over content words, with a margin.** Layer 2 must be cheap,
explainable and dependency-free. Dice penalises extra words, and a near tie
between two answers is a miss, because that is the case for a smarter layer.
Embeddings would catch more paraphrases, but they need a model: layer 3.

**`avoid` words are a veto across layers.** Similarity measures what a message
shares with a question, not what makes it different: one word ("damaged",
"refund") turns a FAQ into a problem with an order. Setup rejects an avoid word
that is a stopword or that, through synonyms or typos, equals a word of the
answer's own phrases. That check caught "charged", one edit from the synonym
"charge", vetoing the shipping-cost answer on every cost question.

**Four fixed layers, two injectable slots.** `classify` and `generate` cover
the real variation; a pluggable layer list adds API surface without a case for it.

**The classifier is an interface.** Any async function returning
`{ choice, confidence }` works. The router accepts only a known id and a
confidence in 0..1. A `usage` field, if present, is copied to the trace step
whenever the classifier returns, so a logger can count what layer 3 costs. The
bundled Claude adapter constrains the reply with a JSON schema whose `choice`
enum is the answer ids plus a no-answer value (`"none"`, or `"_none"` if an id
is `none`).

**Timeouts that cancel.** Layers 3 and 4 get an `AbortSignal` that fires on
their timeout or when the caller aborts. An implementation that ignores it is
simply not waited for. A caller abort ends the turn with the fallback.

**Defaults are examples.** Thresholds and timeouts were picked for the invented
example, not tuned on real traffic. The bench is there to set them.

**Zero runtime dependencies, ESM, Node 22+.** `npm run typecheck` runs
`tsc --checkJs` on `src/` with `strict: false` (strict flags implicit `any`,
mostly in `config.js`, which reads an untyped config), checks in
`typecheck/conform.ts` that `index.d.ts` and `claude.d.ts` match the exports,
and runs `tsc --strict` on those declarations (`tsconfig.strict.json`).

## The held-out set

`bench/messages.json` was written by the same person who wrote the answers'
phrases, synonyms and stopwords, so its numbers are in-sample: they show the
mechanism works on the words it was built for. `bench/held-out.json` was
written for the same shop without looking at that vocabulary, labelled, saved,
and only then run. Its first run gave 1 wrong fixed answer and 7 of 24 answered
without the main LLM, against 0 wrong and 31 of 48 in-sample.

**Rule: the vocabulary is never changed to make the held-out set score better.**
Once a set has been used to tune, it is in-sample, and the honest gap between
the two numbers is gone. A fix for a held-out failure has to be justified on
its own (a new in-sample message, a test) and the held-out number reported as
it then comes out. A test pins the file's SHA-256, so its messages and labels
cannot be edited quietly after a run; a new round of unseen messages goes in a
new file. For the same reason the held-out set does not change the bench's
exit code: a CI gate on it would push toward tuning on it.

The bench prints a 95% Wilson interval next to each share answered without the
main LLM. On 24 messages it is wide (14.9% to 49.2% for 7 of 24), which is the
point: do not read a difference of a few points between two runs as progress.

## Threat model

The router is not a safety layer, but its shape limits what a hostile message
can do. Each point has a test in `test/threat-model.test.js`.

- **A steered classifier can only pick a prepared reply.** Prompt injection
  against layer 3 can at worst choose the wrong id. Only `reply` strings from
  the config are sent, an unknown id is a miss, and `avoid` words still veto.
- **Results from layers 1 to 3 do not copy the message**, only config text,
  numbers and the returned id. Exceptions: `llmOutput`, and what a custom
  classifier returns as an unknown choice or as `usage`.
- **`context` is passed through untouched** to your classifier and LLM. Keep
  personal data out of it unless both may see it.

What the final LLM says is out of scope.

## Known limits

- **One message at a time.** "Yes, that one" reaches the LLM, and the FAQ
  text can follow a complaint. Layers 1 and 2 never see history.
- **Several questions in one message get at most one fixed answer.** `maxTokens`
  sends long messages past layer 2, but a short one gets through: the held-out
  wrong answer is "how long does shipping take and can I pay with apple pay?",
  answered with shipping time alone. The Claude classifier prompt asks for no
  answer on multi-part messages, which is a request, not a guarantee.
- **Classifier confidence is not calibrated.** A self-reported 0.9 is not a 90%
  hit rate. Set `minConfidence` from a labelled bench run.
- **Typo tolerance conflates close words** ("shipping", "shopping"). Words
  under five letters or with digits must match exactly; `typoTolerance: false`
  turns it off.
- **No stemming and simple tokenization.** Normalization folds case and the
  accents of Latin, Greek and Cyrillic, and splits on spaces and punctuation,
  so scripts written without spaces reach the classifier and the LLM.
- **Static replies and no length cap.** Lookups belong to the LLM and its
  tools; cap long messages before calling `route`.
- **No safety layer and no semantic cache.** Put injection and personal-data
  checks before the router; reusing past LLM replies is a different trade-off.
- **The benchmark is small and self-made**, with mock layers: 48 in-sample
  messages and 24 held-out ones, all invented by one person. It has not been run
  with a real model in layers 3 or 4.
- **A timed-out call may still be billed** by the provider.

## Source layout

| Path | What it does |
|---|---|
| `src/router.js` | Runs the layers, builds the trace, applies the fallback |
| `src/config.js` | Validation and defaults |
| `src/normalize.js`, `src/vocabulary.js` | Tokens, edit distance, synonyms, avoid check |
| `src/timeout.js` | Per-layer deadline linked to the caller's signal |
| `src/layers/` | One file per layer |
| `src/adapters/claude.js` | Optional Claude adapters |
| `examples/sticker-shop/` | The invented shop and its mocks |
| `bench/` | The in-sample and held-out banks, `measure.js` (with the Wilson interval) and the runner |
| `bin/cascade.js` | `npm run measure`: a JSON config against your own labelled messages |
| `examples/starter/` | A three-answer config and ten messages copied from the sticker shop |
