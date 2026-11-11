# CLINC150 out-of-scope bench

Data: [CLINC150](https://github.com/clinc/oos-eval) (`data_full.json`, `domains.json`) by
Larson et al., EMNLP-IJCNLP 2019, licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). It is not committed:
`fetch.js` downloads both files at commit `828f8093932c8fe6ca7936c3d2e52903b1c523de` into
`data/` (git-ignored) and refuses a file whose SHA-256 differs. The files are only parsed as
JSON.

## Setup

- **Fixed answers:** the 15 intents of the `banking` domain, one answer each. Their phrases
  are the train utterances of that intent (an utterance two intents share is dropped).
- **Must reach the LLM:** the 135 intents of the other 9 domains and every out-of-scope query.
  In the test split that is 450 answerable messages and 5,050 that must escalate.
- **Stopwords:** a fixed list of English function words in `setup.js`, written before any
  run. No synonyms and no avoid words.
- **Thresholds** are chosen on the validation split by a rule fixed in `evaluate.js`: the
  most fixed answers with precision >= 0.98, ties to the stricter point. The test split is
  scored at those thresholds; the sweep on test shows the trade-off around them.

## Files

| File | What it does |
|---|---|
| `fetch.js` | Download and check the data |
| `setup.js` | Labels, the router config, stopwords, answer descriptions |
| `tfidf.js` | TF-IDF nearest-neighbour baseline (trained on all train utterances) |
| `evaluate.js` | Scoring and the selection rule |
| `run.js` | Local configurations; writes `reports/clinc150.json`; `--check` compares a fresh run |
| `model.js` | A model in layer 3 on a seeded 2,000-message test sample; needs `DEEPSEEK_API_KEY` |
| `chart.js` | `reports/clinc150-tradeoff.svg` from both reports; `--check` compares |
| `show.js` | The tables in the README, from the committed reports |

## History

The first test run had a floating-point bug in the TF-IDF baseline: an utterance identical to
a train one scored 0.9999999999999998, below the threshold of 1 chosen on validation. The
similarity is now rounded to 9 decimals and both splits were run again. Layers 1 and 2 did
not change (110 right, 2 wrong); TF-IDF alone went from 35 to 60 right with 0 wrong, and the
cascade with TF-IDF from 119 to 124 right with 2 wrong. The model run reads only the layer 2
thresholds, which did not change.
