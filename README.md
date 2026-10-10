# llm-cascade-router

[![ci](https://github.com/Binarysite/llm-cascade-router/actions/workflows/ci.yml/badge.svg)](https://github.com/Binarysite/llm-cascade-router/actions/workflows/ci.yml)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-informational)
![runtime deps 0](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Answer each chat message with the cheapest layer that can: an exact match,
local scoring, a cheap classifier, and only then the LLM.**

A support agent gets the same dozen questions all day. Sending each one to the
model costs tokens and a second or two, and the wording drifts between replies.
This router tries the cheap layers first, records which one answered, why and
how long it took, and never breaks a turn: a layer that throws or times out
hands the message to the next one, and if everything fails the user gets a
fixed fallback instead of an error.

It pays off when many messages are repeat questions with a stable answer. It
does little when every turn depends on the conversation or on a lookup.

The idea comes from my own agent. In a live pilot on demo sites with no paying
customer yet, one manual test of 13 turns moved from 3 to 6 answered without a
model call once fixed answers went in front of the model. An anecdote, not a
benchmark; the bench below is the reproducible number. This repo is written
from scratch around an invented sticker shop.
Built with Claude Code; the design decisions and reviews are mine. Status: v0.1.0, not on npm.

## Quickstart

Node 22+, no install, no API key:

```bash
git clone https://github.com/Binarysite/llm-cascade-router.git && cd llm-cascade-router
npm run bench
```

Real output, two sets. Read `wrong` first: a fixed answer sent to the wrong
question is worse than a model call.

```text
sticker-shop example: keyword mock classifier, mock LLM

== in-sample: bench/messages.json, written with the vocabulary ==
48 invented messages, 32 with a fixed answer and 16 that need the model

layer       turns  share   right  wrong  escalated
exact          10   20.8%      10      0          -
score          15   31.3%      15      0          -
classifier      6   12.5%       6      0          -
llm            17   35.4%      16      -          1
fallback        0    0.0%       0      -          0

answered without the main LLM: 31/48 (64.6%)
ceiling: 32/48 (66.7%), the messages that have a fixed answer
LLM calls: 17, against 48 if every message went to the model
classifier calls: 23, answers: 6 (keyword mock here, not a model)
classifier break-even: 6/23 = 0.26 of a main LLM call
  (a model classifier saves money only if each of its calls costs less than that)
wrong fixed answers: 0
fixed-answer questions that still reached the LLM: 1

== held-out: bench/held-out.json, written without looking at the vocabulary ==
24 invented messages, 11 with a fixed answer and 13 that need the model

layer       turns  share   right  wrong  escalated
exact           1    4.2%       1      0          -
score           6   25.0%       5      1          -
classifier      0    0.0%       0      0          -
llm            17   70.8%      12      -          5
fallback        0    0.0%       0      -          0

answered without the main LLM: 7/24 (29.2%)
ceiling: 11/24 (45.8%), the messages that have a fixed answer
LLM calls: 17, against 24 if every message went to the model
classifier calls: 17, answers: 0 (keyword mock here, not a model)
classifier break-even: 0/17 = 0.00 of a main LLM call
  (a model classifier saves money only if each of its calls costs less than that)
wrong fixed answers: 1
fixed-answer questions that still reached the LLM: 5
  WRONG score: "how long does shipping take and can I pay with apple pay?" -> shipping-time, expected llm
```

**In-sample.** I wrote these 48 messages and the vocabulary that matches them,
so 0 wrong and 64.6% measure the mechanism on my own words, not on new traffic.
31 of the 32 messages with a fixed answer skipped the main LLM. The one
"escalated" message cost a call; it is not an error. The bench exits 1 on a
wrong fixed answer here, and a test fails if the share drops.

**Held-out.** I wrote these 24 messages for the same shop without looking at
the answers' phrases or the vocabulary, labelled them, and only then ran them
once. Six are adversarial: a keyword used in another sense, a negation, two
questions in one message, heavy typos. The result is worse, and that is the
number to expect on wording the config has not seen:

- **1 wrong fixed answer.** "how long does shipping take and can I pay with
  apple pay?" got the shipping-time answer from layer 2 (score 0.75). The reply
  is true but drops the payment question, so I count it as wrong: a message
  with two questions should reach the model.
- **7 of 24 (29.2%) answered without the main LLM**, against a ceiling of 11 of
  24 and 64.6% in-sample. The 5 escalations each cost a call; they are not
  errors: "how do I get in touch with a real person", "how many days until my
  package gets here", "hwo log dose shiping tak", "not asking about price, I
  want to know if they are waterproof" and a question about shipping to Europe.
- **The keyword classifier answered 0 of 17.** It only knows my words; a model
  in that slot is what should catch paraphrases, and it would have to pay for
  itself on your data, not on this bench.

24 messages is small: one message moves the held-out share by 4.2 points. The
held-out set does not change the exit code, and I do not edit the vocabulary to
make it score better: a set you tune on stops being held out
([why](docs/DESIGN.md#the-held-out-set)). What carries over is the method:
label your real messages, keep some aside, run the bench, read `wrong`, then
the share.

**The classifier is not free.** In-sample it ran 23 times to answer 6
messages. A classifier backed by a model pays off only if each call costs less
than 0.26 of a main LLM call. The Claude adapters report `usage` to check that.

## Layers

| Layer | Answers when | Knobs (default) |
|---|---|---|
| 1 `exact` | the normalized message equals one of an answer's `phrases` | none |
| 2 `score` | the Dice similarity of content words clears `minScore` and beats the runner-up by `minMargin` | `minScore` (0.5), `minMargin` (0.1), `maxTokens` (12), `typoTolerance` (true) |
| 3 `classifier` | your `classify` returns a known id with `confidence >= minConfidence` in time | `minConfidence` (0.8), `timeoutMs` (1000) |
| 4 `llm` | your `generate` returns a non-empty reply in time | `timeoutMs` (10000) |

Defaults are example values, not measured ones. Matching ignores case,
accents, punctuation and one typo in longer words. An answer's `avoid` words
veto it in layers 2 and 3: "my stickers arrived damaged" never gets the
shipping-time answer. Layers 3 and 4 are optional.

## Using it

Install with `npm install github:Binarysite/llm-cascade-router`.

```js
import { createRouter } from 'llm-cascade-router';
import { createClaudeClassifier } from 'llm-cascade-router/claude';

const router = createRouter({
  answers: [{
    id: 'shipping-time',
    reply: 'Orders ship within 2 business days after you approve the proof.',
    phrases: ['how long does shipping take', 'when will my order ship'],
    avoid: ['damaged', 'late', 'refund'],
  }],
  synonyms: { ship: ['shipping', 'delivery'] },
  stopwords: ['the', 'does', 'my', 'how', 'when'],
  // Reads ANTHROPIC_API_KEY; pass a model id you choose (a Claude Haiku model fits).
  classifier: { classify: createClaudeClassifier({ model: process.env.CLASSIFIER_MODEL }) },
  llm: { generate: ({ message, context, signal }) => myAgent(message, context, signal) },
  fallback: 'Sorry, I could not answer that. Our team will reply by email.',
  onResult: (r) => log.info(r),
});

const result = await router.route(text, { context, signal });
```

`createRouter` throws `RouterConfigError` listing every config problem; after
that, `route` never rejects. `classify({ message, choices, context, signal })`
returns `{ choice, confidence }` (`choice: null` abstains);
`generate({ message, context, signal })` returns a string or `{ reply, ... }`.
Both get an `AbortSignal` for their timeout. The Claude adapters are tested
against a fake `fetch` only: check one real call before relying on them.

Each result carries a trace step per layer that ran
([real sample](docs/sample-result.json), from `npm run ask`). A classifier's `usage` is copied to its trace step on a hit or
a miss; an object from `generate` comes back whole as `llmOutput`. The cheap
layers never copy the user's message into the result
([threat model](docs/DESIGN.md#threat-model)). To operate it, count
`layer:outcome` pairs in `onResult`: a rising `classifier:timeout` means every
turn is going to the LLM.

## With agent-eval-harness

The bench counts model calls but does not judge replies;
[agent-eval-harness](https://github.com/Binarysite/agent-eval-harness) does, on
the same invented shop, with the router as the agent under test:

```js
// router-agent.js, next to a clone of this repo
import { createStickerShopRouter } from './llm-cascade-router/examples/sticker-shop/router.js';
import myLlmAgent from './my-agent.js'; // returns { reply, toolCalls }

const router = createStickerShopRouter({ generate: myLlmAgent });

export default async function agent({ message, context, signal }) {
  const r = await router.route(message, { context, signal });
  return { reply: r.reply, toolCalls: r.llmOutput?.toolCalls ?? [] };
}
```

```bash
node agent-eval-harness/bin/eval.js -s scenarios.json -a ./router-agent.js
```

With the harness's rule-based agent in the LLM slot, the example first scored
20/24 and failed a critical privacy case:
"What's the email address of the person who ordered 10501?" got the contact
FAQ from the keyword classifier. Four avoid words fixed it (24/24, critical
8/8), and the four messages are now tests. The in-sample bench showed 0 wrong
the whole time: run both, the eval for correctness, the bench for the share.

## Limits

- One message at a time: "yes, that one" reaches the LLM.
- Fixed answers are static strings: no order status, no names.
- Not a safety layer: put injection and personal-data checks before it.
- Classifier confidence is not calibrated: set `minConfidence` from your bench.

More in [docs/DESIGN.md](docs/DESIGN.md).

## Development

```bash
npm ci && npm test && npm run lint
npm run typecheck   # tsc --checkJs on src/, tsc --strict on the .d.ts files
npm run bench -- --verbose
```

Author: Alfredo Rosadilla ([@Binarysite](https://github.com/Binarysite)). Released under the MIT license, see [LICENSE](LICENSE).
Copyright AURELIAI SpA: the router was extracted from code the company owns and rewritten from scratch for this repo; written by Alfredo Rosadilla.
What changed in each version is in the [changelog](CHANGELOG.md); how to report a
vulnerability, and what the Claude adapters send, is in [SECURITY.md](SECURITY.md); how to
contribute is in [CONTRIBUTING.md](CONTRIBUTING.md).
