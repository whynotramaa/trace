# Experiments

No retrieval-quality or latency claim is published until its full input set has been measured. All Trace quality metrics come from `eval/metrics.ts`; the Phase 0 check compares that implementation to `pytrec_eval`.

## Evaluator validation

| Run | Queries | MRR@10 | nDCG@10 | Recall@100 | Recall@1000 | Largest difference from pytrec_eval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Published Anserini TREC-COVID round 3 abstract BM25, cumulative round 3 judgments | 40 | 0.84375 | 0.5780983997597278 | 0.19891864619926322 | 0.5039567924713759 | 2.220446049250313e-16 |

This row validates the evaluator. It is an Anserini run, not a Trace ranking result. The [published run registry](https://github.com/castorini/pyserini/blob/master/integrations/core/sparse/test_trec_covid_stored_runs.py) specifies its MD5, `d08d85c87e30d6c4abf54799806d282f`. Judgments come from [Castorini's evaluation data](https://github.com/castorini/eval/blob/master/qrels/qrels.covid-round3-cumulative.txt).

Reproduce after fetching the reference data:

```sh
bun eval/fetch.ts --dataset reference --out data/reference
uv venv .venv
uv pip install --python .venv/bin/python pytrec-eval-terrier==0.5.10
bun eval/verify.ts --qrels data/reference/qrels.covid-round3-cumulative.txt --run data/reference/anserini.covid-r3.abstract.qq.bm25.txt --out artifacts/phase0-parity.json
```

## Retrieval quality

The full MS MARCO and CQADupStack reference comparisons are pending. Their absolute quality tolerances were declared in `docs/decisions.md` before retrieval runs. Missing rows must not be interpreted as passed gates.
