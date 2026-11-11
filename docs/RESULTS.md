# Results in full

Every block below is the output of the command in its marker, checked against a
fresh run by `test/readme.test.js`. The [README](../README.md) has the summary.

## Sticker shop: in-sample and held-out

`npm run bench`. The in-sample bank was written together with the vocabulary;
the held-out bank was written for the same shop without looking at it, labelled,
and run once ([why](DESIGN.md#the-held-out-set)). Only the in-sample bank sets
the exit code.

<!-- output: bench/run.js -->
```text
sticker-shop example: keyword mock classifier, mock LLM

== in-sample: bench/messages.json, written with the vocabulary ==
49 invented messages, 33 with a fixed answer and 16 that need the model

layer       turns  share   right  wrong  escalated
exact          10   20.4%      10      0          -
score          15   30.6%      15      0          -
classifier      6   12.2%       6      0          -
llm            18   36.7%      16      -          2
fallback        0    0.0%       0      -          0

wrong fixed answers: 0 of 31 given
  precision 100.0%, 95% interval (Wilson) 89.0% to 100.0%
answered without the main LLM: 31/49 (63.3%), 95% interval (Wilson) 49.3% to 75.3%
  ceiling: 33/49 (67.3%), the messages that have a fixed answer
fixed-answer questions that still reached the LLM: 2
LLM calls: 18, against 49 if every message went to the model
classifier: 24 calls, 6 answers, 6 right, 0 wrong (keyword mock here, not a model)
  break-even: 6 right / 24 calls = 0.25 of a main LLM call
  (a model classifier saves money only if one call costs less than that; wrong answers cost extra)

== held-out: bench/held-out.json, written without looking at the vocabulary ==
24 invented messages, 11 with a fixed answer and 13 that need the model

layer       turns  share   right  wrong  escalated
exact           1    4.2%       1      0          -
score           6   25.0%       5      1          -
classifier      0    0.0%       0      0          -
llm            17   70.8%      12      -          5
fallback        0    0.0%       0      -          0

wrong fixed answers: 1 of 7 given
  precision 85.7%, 95% interval (Wilson) 48.7% to 97.4%
  WRONG score: "how long does shipping take and can I pay with apple pay?" -> shipping-time, expected llm
answered without the main LLM: 7/24 (29.2%), 95% interval (Wilson) 14.9% to 49.2%
  ceiling: 11/24 (45.8%), the messages that have a fixed answer
fixed-answer questions that still reached the LLM: 5
LLM calls: 17, against 24 if every message went to the model
classifier: 17 calls, 0 answers, 0 right, 0 wrong (keyword mock here, not a model)
  break-even: 0 right / 17 calls = 0.00 of a main LLM call
  (a model classifier saves money only if one call costs less than that; wrong answers cost extra)
```

- **The held-out wrong answer** is "how long does shipping take and can I pay
  with apple pay?": the shipping-time reply is true but drops the payment
  question, and a message with two questions should reach the model.
- **The keyword classifier answered 0 held-out messages.** It only knows my
  words; a model in that slot is what should catch paraphrases.
- **The intervals are wide**: one message moves the held-out share by 4.2
  points.

## Sticker shop with a real model in layer 3

`DEEPSEEK_API_KEY=... npm run bench:real -- --provider deepseek --model deepseek-flash`
runs both banks through the shipped `llm-cascade-router/openai-compatible`
adapter, with thinking off and a `--max-usd` cap. The main LLM is still the
mock, so the cost is the classifier's. Raw per-message results:
[reports/real-deepseek.json](../reports/real-deepseek.json).

<!-- output: bench/show-real.js -->
```text
deepseek-flash in layer 3 (served: deepseek-flash), 2026-11-11, reports/real-deepseek.json

                            in-sample (49)            held-out (24)
wrong fixed answers         0 of 32                   2 of 11
  precision, 95% Wilson     100.0% (89.3 to 100.0)    81.8% (52.3 to 94.9)
right fixed answers         32                        9
  vs mock (only one right)  1 / 0, McNemar p = 1      3 / 0, McNemar p = 0.25
escalated (cost a call)     1                         1
answered without the LLM    32/49 (65.3%)             11/24 (45.8%)
  with the keyword mock     31/49 (63.3%)             7/24 (29.2%)
  with no classifier        25/49 (51.0%)             7/24 (29.2%)
classifier calls            24                        17
  answers right / wrong     7 / 0                     3 / 1
  unknown ids / errors      0 / 0                     0 / 0
latency p50 / p95           1102 / 1387 ms            1139 / max 1506 ms
  added on escalated turns  1121 / max 1387 ms        1139 / max 1506 ms
tokens prompt / completion  5632 / 342                3981 / 243
cost, USD (upper bound)     0.0021                    0.0015

total cost USD 0.003586; prices: https://api-docs.deepseek.com/quick_start/pricing, deepseek-flash row, peak hours (the higher one), fetched 2026-11-11
```

- **Held-out, the model answered 4 messages the mock could not: 3 right, 1
  wrong.** The wrong one is "my friend said your shipping is slow, is that true
  for europe?", sent to shipping time; the label is international.
- **Not significant**: on right answers, 3 only with the model and none only
  with the mock, exact McNemar p = 0.25; wrong fixed answers went from 1 to 2.
  Counting every message moved off the LLM (4, p = 0.125) would score the wrong
  one as a gain.
- **About 1.1 s per classifier call**, added to every turn that still reaches
  the LLM. The example's 250 ms timeout would cut every call, so the run uses
  30 s.
- **Break-even** is 0.29 (in-sample) and 0.18 (held-out) of a main LLM call per
  classifier call, counting right answers only.
- An October run with `deepseek-chat`, through a client written inside the
  bench at the time, gave the same held-out result (11 of 24, the same 2
  wrong); it is kept in `reports/archive/`.

## CLINC150 in full

`npm run clinc:fetch && npm run clinc`; the model part is
`DEEPSEEK_API_KEY=... npm run clinc:model`. Setup, selection rule and history:
[bench/clinc150/README.md](../bench/clinc150/README.md). Raw numbers, including
the sweep over every threshold: [reports/clinc150.json](../reports/clinc150.json)
and [reports/clinc150-deepseek.json](../reports/clinc150-deepseek.json).

<!-- output: bench/clinc150/show.js -->
```text
CLINC150 test split, 5500 messages: 450 banking questions with a fixed answer,
5050 that must reach the LLM (other domains and out-of-scope). Train 15100, val 3100.
Thresholds chosen on val, the most fixed answers with precision >= 0.98: minScore 0.85, minMargin 0.15;
TF-IDF similarity 1, alone and in layer 3. The rule reads the point estimate on few answered val messages
(71 for layers 1-2), so the val precision and its interval are in the last column. Test scored at those
thresholds; re-run once after a floating-point fix that did not move them (see History in bench/clinc150/README.md).

                                                  wrong  (intent / must-escalate)    right     precision, 95% Wilson  to LLM    val precision, right/answered
LLM on every message                                  0                   (0 / 0)    0/450                         -  100.0%                                -
layers 1-2, then LLM                                  2                   (1 / 1)  110/450    98.2% (93.7% to 99.5%)   98.0%    98.6% (92.4% to 99.8%), 70/71
TF-IDF nearest neighbour alone, then LLM              0                   (0 / 0)   60/450  100.0% (94.0% to 100.0%)   98.9%  100.0% (87.9% to 100.0%), 28/28
cascade: layers 1-2, TF-IDF in layer 3, then LLM      2                   (1 / 1)  124/450    98.4% (94.4% to 99.6%)   97.7%    98.6% (92.5% to 99.8%), 71/72

deepseek-flash in layer 3, 2026-11-11, on a seeded sample of 2000 test messages (166 answerable);
minConfidence 0.8 (the default, not tuned). 2000 calls, 0 errors, 0 unknown ids.

                                                 wrong  (intent / must-escalate)    right   precision, 95% Wilson  to LLM
layers 1-2, then LLM                                 1                   (1 / 0)   45/166  97.8% (88.7% to 99.6%)   97.7%
model on every message, then LLM                    21                  (4 / 17)  149/166  87.6% (81.9% to 91.8%)   91.5%
cascade: layers 1-2, model in layer 3, then LLM     22                  (5 / 17)  149/166  87.1% (81.3% to 91.3%)   91.4%

model call latency p50 1099 ms, p95 1427 ms, max 1865 ms; cost USD 0.1310 (peak price, an upper bound)
paired on the same 2000 messages, cascade with the model vs the model alone:
  right fixed answers: 1 only the cascade, 1 only the model alone, McNemar exact p = 1
  wrong fixed answers: 1 only the cascade, 0 only the model alone, McNemar exact p = 1
layers 1-2 add no right answers once the model is in layer 3 (149 vs 149) and 1 more wrong (22 vs 21);
they skip 46 of 2000 model calls (2.3%): cost and latency only.
```

- **Wrong answers split** into a wrong banking intent and a must-escalate
  message given a fixed answer; the second kind dominates the model's errors.
- **The paired tests** compare the cascade with the model against the model
  alone on the same messages, once on right and once on wrong fixed answers.
  The cascade against layers 1-2 alone is not tested: the cascade keeps every
  answer layers 1-2 give, so that comparison favours it by construction.
  `node bench/clinc150/paired.js --check` recomputes them from the per-message
  rows in the report.
- **The val column** is the validation result the thresholds were chosen on.
  The rule reads its point estimate (>= 0.98) on 71 answered messages for
  layers 1-2; the rule was fixed before the runs and is not changed after
  seeing test.

## Cost per 1,000 turns

`npm run cost` uses the classifier cost and latency measured in the CLINC150
model run, and a main model you describe. Here the main model is priced like
`deepseek-v4-pro` at peak hours (USD 1.32 input, 3.96 output per million tokens,
from DeepSeek's pricing page on 2026-11-11), with a 2,000-token prompt, 300
output tokens and 3 s per call. Those four numbers are assumptions, not
measurements. A wrong fixed answer also skips a main call, so the output says
how many of the saved calls are wrong answers, and `--wrong-cost` (default 0,
always printed) prices each one.

<!-- output: bench/cost.js --main-in 1.32 --main-out 3.96 --prompt-tokens 2000 --output-tokens 300 --main-ms 3000 -->
```text
main model call: USD 0.00383 (2000 in, 300 out at 1.32 / 3.96 per M), 3000 ms; classifier call: USD 0.000066 measured (deepseek-flash)
traffic with a fixed answer: 8.3% (sample: 166/2000); layer 2 at minScore 0.85, minMargin 0.15 (chosen on val)
wrong fixed answer: USD 0 each (--wrong-cost); 0 leaves them unpriced

configuration                          USD per 1k turns  main calls  classifier calls  wrong  p50 ms  p95 ms
LLM on every message                              3.828        1000                 0    0.0    3000    3000
layers 1-2, then LLM                              3.740         977                 0    0.5    3000    3000
model classifier on every message                 3.568         915              1000   10.5    4077    4415
cascade: layers 1-2, model in layer 3             3.565         914               977   11.0    4076    4414

Adding the model in layer 3 to layers 1-2: 62.5 saved calls per 1k turns, of which 10.5 are wrong answers,
for 977 classifier calls; 10.5 more wrong fixed answers in all.
It loses money when one main call costs less than USD 0.00102 (here: USD 0.00383, so it saves money).
At this main-call price it loses money once a wrong fixed answer costs more than USD 0.01669.
```

With CLINC150's mix (8.3% of traffic has a fixed answer), the model in layer 3
saves 6% of main calls and adds about 1.1 s to the median turn, but 10.5 of its
62.5 saved calls per 1k turns are wrong fixed answers: at this main-call price
it loses money once a wrong answer costs you more than about USD 0.017. The same run
with `--answerable-share 0.5` shows the effect of a mix with more repeat
questions:

<!-- output: bench/cost.js --main-in 1.32 --main-out 3.96 --prompt-tokens 2000 --output-tokens 300 --main-ms 3000 --answerable-share 0.5 -->
```text
main model call: USD 0.00383 (2000 in, 300 out at 1.32 / 3.96 per M), 3000 ms; classifier call: USD 0.000066 measured (deepseek-flash)
traffic with a fixed answer: 50.0% (sample: 166/2000); layer 2 at minScore 0.85, minMargin 0.15 (chosen on val)
wrong fixed answer: USD 0 each (--wrong-cost); 0 leaves them unpriced

configuration                          USD per 1k turns  main calls  classifier calls  wrong  p50 ms  p95 ms
LLM on every message                              3.828        1000                 0    0.0    3000    3000
layers 1-2, then LLM                              3.298         861                 0    3.0    3000    3000
model classifier on every message                 2.112         535              1000   16.7    3822    4366
cascade: layers 1-2, model in layer 3             2.091         532               861   19.7    3814    4356

Adding the model in layer 3 to layers 1-2: 329.9 saved calls per 1k turns, of which 16.7 are wrong answers,
for 861 classifier calls; 16.7 more wrong fixed answers in all.
It loses money when one main call costs less than USD 0.00017 (here: USD 0.00383, so it saves money).
At this main-call price it loses money once a wrong fixed answer costs more than USD 0.07232.
```

The default mix again, with USD 0.05 per wrong fixed answer, an example value
you replace with your own (a refund, a ticket, a lost sale), not a measurement.
At that price the cascade with the model costs more per 1k turns than sending
every message to the LLM:

<!-- output: bench/cost.js --main-in 1.32 --main-out 3.96 --prompt-tokens 2000 --output-tokens 300 --main-ms 3000 --wrong-cost 0.05 -->
```text
main model call: USD 0.00383 (2000 in, 300 out at 1.32 / 3.96 per M), 3000 ms; classifier call: USD 0.000066 measured (deepseek-flash)
traffic with a fixed answer: 8.3% (sample: 166/2000); layer 2 at minScore 0.85, minMargin 0.15 (chosen on val)
wrong fixed answer: USD 0.05 each (--wrong-cost)

configuration                          USD per 1k turns  main calls  classifier calls  wrong  p50 ms  p95 ms
LLM on every message                              3.828        1000                 0    0.0    3000    3000
layers 1-2, then LLM                              3.765         977                 0    0.5    3000    3000
model classifier on every message                 4.093         915              1000   10.5    4077    4415
cascade: layers 1-2, model in layer 3             4.115         914               977   11.0    4076    4414

Adding the model in layer 3 to layers 1-2: 62.5 saved calls per 1k turns, of which 10.5 are wrong answers,
for 977 classifier calls; 10.5 more wrong fixed answers in all.
It loses money when one main call costs less than USD 0.00942 (here: USD 0.00383, so it LOSES money), at USD 0.05 per wrong fixed answer.
At this main-call price it loses money once a wrong fixed answer costs more than USD 0.01669.
```

## Your own messages

`npm run measure` on the starter config (answers and messages copied from the
sticker shop; a test checks that):

<!-- output: bin/cascade.js -->
```text
config: examples/starter/config.json, messages: examples/starter/messages.json (layers 1 and 2, then a counting mock LLM; no classifier, no network)
10 labelled messages, 7 with a fixed answer and 3 that need the model

layer       turns  share   right  wrong  escalated
exact           2   20.0%       2      0          -
score           5   50.0%       5      0          -
classifier      0    0.0%       0      0          -
llm             3   30.0%       3      -          0
fallback        0    0.0%       0      -          0

wrong fixed answers: 0 of 7 given
  precision 100.0%, 95% interval (Wilson) 64.6% to 100.0%
answered without the main LLM: 7/10 (70.0%), 95% interval (Wilson) 39.7% to 89.2%
  ceiling: 7/10 (70.0%), the messages that have a fixed answer
fixed-answer questions that still reached the LLM: 0
LLM calls: 3, against 10 if every message went to the model
classifier: not configured
```
