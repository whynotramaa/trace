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

The records below cover all 12 CQADupStack sites in `artifacts/phase1/cqadupstack-*.json`. They use Trace's `anserini` analyzer and exhaustive BM25 with `k1=0.9` and `b=0.4`. Each run used three measured repeats after a 100-query warm-up. CQADupStack self-query exclusion is enabled by `eval/run.ts`.

The table reports unweighted per-site metrics. `Reference nDCG@10` comes from the matching `data/reference/cqadupstack-*.json` record. `Delta` is Trace nDCG@10 minus that reference value. Values are shown to six decimal places.

| Site | Corpus | Queries | MRR@10 | nDCG@10 | Recall@100 | Recall@1000 | Reference nDCG@10 | Delta | Gates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| android | 22,998 | 699 | 0.381807 | 0.381059 | 0.684348 | 0.863211 | 0.380100 | +0.000959 | pass |
| english | 40,221 | 1,570 | 0.353120 | 0.345377 | 0.575318 | 0.731669 | 0.345300 | +0.000077 | pass |
| gaming | 45,301 | 1,595 | 0.467764 | 0.482681 | 0.765691 | 0.895167 | 0.482200 | +0.000481 | pass |
| gis | 37,637 | 885 | 0.273682 | 0.290379 | 0.607954 | 0.816312 | 0.290100 | +0.000279 | pass |
| mathematica | 16,705 | 804 | 0.198170 | 0.201461 | 0.487961 | 0.722104 | 0.201500 | -0.000039 | pass |
| physics | 38,316 | 1,039 | 0.323329 | 0.321404 | 0.632631 | 0.834012 | 0.321400 | +0.000004 | pass |
| programmers | 32,176 | 876 | 0.281630 | 0.280199 | 0.559141 | 0.773399 | 0.280200 | -0.000001 | pass |
| stats | 42,269 | 652 | 0.266296 | 0.271104 | 0.533840 | 0.731011 | 0.271100 | +0.000004 | pass |
| tex | 68,184 | 2,906 | 0.221203 | 0.224157 | 0.469330 | 0.691228 | 0.224400 | -0.000243 | pass |
| unix | 47,382 | 1,072 | 0.274467 | 0.274925 | 0.542757 | 0.761157 | 0.274900 | +0.000025 | pass |
| webmasters | 17,405 | 506 | 0.304937 | 0.305498 | 0.580666 | 0.806596 | 0.305900 | -0.000402 | pass |
| wordpress | 48,605 | 541 | 0.231192 | 0.248334 | 0.515188 | 0.755248 | 0.248300 | +0.000034 | pass |
| **Unweighted macro; corpus and query columns are sums** | **457,199** | **13,145** | **0.298133** | **0.302215** | **0.579569** | **0.781760** | **0.302117** | **+0.000098** | **12/12 pass** |

The count checks pass for all 12 sites. The indexed document count equals the normalized-manifest count and the artifact corpus count for every site. The artifact query, judged-query, and run-query counts also agree for every site. The normalized corpus SHA-256 in each artifact matches its `data/normalized/*.jsonl.manifest.json` output hash. Every reference record has the expected document count and `k1=0.9`, `b=0.4`. Every recorded nDCG delta is within the declared CQADupStack tolerance of `0.002`.

The macro is an equal-site mean. It is not query-weighted. The reference macro is the equal-site mean of the 12 recorded Anserini reference nDCG@10 values.

### Recorded environment and configuration

The artifacts record this machine:

| Field | Recorded value |
| --- | --- |
| CPU | 12th Gen Intel(R) Core(TM) i5-12450H, 12 logical cores, x64 |
| Memory | 16,450,772,992 bytes total |
| OS | Linux `7.1.9-arch1-2`, x64 |
| Bun | `1.3.14` |
| Analyzer | `anserini` |
| Scoring | exhaustive BM25, `k1=0.9`, `b=0.4`, top 1,000 |
| Warm-up and repeats | 100 queries, 3 measured repeats |

These fresh runs replace earlier artifacts with incomplete provenance. Every run records query and qrels hashes, corpus counts, scoring parameters, and the base Git commit `656a1abd9e1be9b60bb9ec686d0203a5c0b89d65`. The working tree also contained uncommitted code, so `machine.code_hash` identifies the executed source snapshot. Each recorded snapshot is saved in `artifacts/source/<code_hash>.tar.gz`. All three snapshots contain identical engine files. Their evaluation-tool differences are a stricter check for null scoring declarations and the product acquisition command. No retrieval change occurred between these runs.

`artifacts/phase1/cqadupstack-gate.json` records the equal-site macro comparison. Its absolute nDCG@10 difference is `0.00009823903034378301`, below `0.002`. The count, input-hash, configuration, and per-site gates pass independently. These quality runs overlapped other offline work, so their recorded timings must not be used as isolated latency comparisons.

### Reproduce the CQADupStack rows

The following command reruns the recorded configuration from the normalized corpus, raw query and qrels files, and reference records. It writes a JSON artifact and TREC run for each site.

```sh
for site in android english gaming gis mathematica physics programmers stats tex unix webmasters wordpress; do
  bun eval/run.ts \
    --corpus data/normalized/cqadupstack-$site.jsonl \
    --queries data/raw/cqadupstack/$site/queries.jsonl \
    --qrels data/raw/cqadupstack/$site/qrels.txt \
    --dataset cqadupstack-$site \
    --analyzer anserini \
    --k1 0.9 \
    --b 0.4 \
    --repeats 3 \
    --reference data/reference/cqadupstack-$site.json \
    --out artifacts/phase1/cqadupstack-$site
done
```

The command verifies each reference row during the run. It does not verify the Phase 0 evaluator parity row or run MS MARCO. The complete MS MARCO result below and these CQADupStack results pass the Phase 1 quality exit criterion.

### Offline batch equivalence

`eval/batched.ts` accommodates the full MS MARCO corpus on this machine by using bounded in-memory indexes. A first pass computes the full-corpus document count, token count, and document frequencies for every query term. Each batch uses those statistics in the same exhaustive DAAT scorer. A global heap merges the batch top-k results. Any document outside a batch's top-k already has at least k documents ahead of it, so it cannot enter the global top-k. The score and document-ID tie order remain unchanged.

The complete Android test used batches of 10,000 documents and all 699 judged queries. Its TREC top-1,000 run is byte-for-byte identical to whole-index retrieval. Both files have SHA-256 `016edee93cf2acc2ad28543285352d6a25fa6957fde19c052cf9426151d4d373`. Every per-query metric also agrees exactly. This checks batching equivalence; it does not replace the full MS MARCO quality gate.

Reproduce the batch check:

```sh
bun eval/batched.ts --corpus data/normalized/cqadupstack-android.jsonl --queries data/raw/cqadupstack/android/queries.jsonl --qrels data/raw/cqadupstack/android/qrels.txt --dataset cqadupstack-android --reference data/reference/cqadupstack-android.json --batch-size 10000 --out artifacts/android-batched-check
sha256sum artifacts/android-batched-check.run.trec artifacts/phase1/cqadupstack-android.run.trec
```

Run the full MS MARCO quality comparison:

```sh
bun eval/batched.ts --corpus data/normalized/msmarco.jsonl --queries data/reference/topics.msmarco-passage.dev-subset.tsv --qrels data/reference/qrels.msmarco-passage.dev-subset.txt --dataset msmarco --k1 0.82 --b 0.68 --reference data/reference/msmarco.json --batch-size 100000 --out artifacts/msmarco
```

This mode records offline elapsed time and sampled memory use. It does not measure online query latency or throughput. The serving baseline remains the heap index, with compression, disk layouts, and pruning reserved for Phase 3.

### Full MS MARCO result

The existing exhaustive offline run completed all 8,841,823 passages and all 6,980 judged dev queries across 89 batches. It used the `anserini` analyzer, full-corpus BM25 statistics, `k1=0.82`, `b=0.68`, and a top-1,000 heap. `artifacts/msmarco.json` records the result, configuration, counts, hardware, and reference gate.

| Dataset | Corpus | Queries | MRR@10 | nDCG@10 | Recall@100 | Recall@1000 | Reference MRR@10 | Absolute MRR delta | Tolerance | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| MS MARCO passage dev | 8,841,823 | 6,980 | 0.18719675262655042 | 0.2338893752621818 | 0.6702841451766853 | 0.8577483285577306 | 0.18741227770955546 | 0.00021552508300504147 | 0.001 | pass |

The predeclared reference in `data/reference/msmarco.json` compares MRR@10, corpus and query counts, dataset identity, and BM25 parameters. Its complete gate passes. The other three metrics are measured results without reference values declared in that record. Together with all 12 CQADupStack site gates and their equal-site nDCG@10 macro gate, this completes the Phase 1 quality exit criterion.

Independent verification checked every one of the 6,974,599 TREC rows. The run covers every judged query, with contiguous ranks, unique document IDs per query, corpus membership, finite float32 scores, descending scores, and descending document-ID ties. Eight queries have fewer than 1,000 matching documents, with a minimum of 16. Every query returns exactly `min(1000, candidate_count)` results. `artifacts/msmarco-run-verification.json` records these checks.

Recomputing the complete saved run with `eval/evaluate.ts` gives identical per-query metrics. The largest aggregate difference is `5.3734794391857577e-14`, below `1e-12`. The aggregate summation order differs between the batch writer and the standalone evaluator. The archived `compareReference` implementation reproduces the recorded gate exactly, and the recomputed metrics pass the same gate. Evidence is saved in `artifacts/msmarco-recomputed.json` and `artifacts/msmarco-metric-verification.json`.

| Provenance field | Verified value |
| --- | --- |
| Normalized corpus SHA-256 | `bf99a338fa2ceb3fbec8a726e0c75c7a07f96dce599b488abf8f480fee8086bf` |
| Topics SHA-256 | `f4f71fa87b6be4fb968cca2b8f8554c4ebd003e6c3488af3ac1cc5629c3de189` |
| Qrels SHA-256 | `34ef51a24e049b3dd19b0a448b764f26b0def22ec42f421ecba2db91f82e7042` |
| TREC run SHA-256 | `f97c9446562c15cc6735fdae0482d4f47a10ed13f3277b7c91e193b83bccf7ba` |
| Executed source hash | `8a2b4668fb3d72461a76b47b819c69ddf1a4b12ee158a1a26c6e04f96dcff0a5` |
| Base Git commit | `656a1abd9e1be9b60bb9ec686d0203a5c0b89d65` |

The corpus bytes independently match the manifest and recorded hash. Its 8,841,823 document IDs are unique and contiguous from `0` through `8841822`. Topics and qrels cover the same 6,980 query IDs. `artifacts/msmarco-input-verification.json` records those checks.

The working tree was dirty when this run started. The preserved `artifacts/source/8a2b4668fb3d72461a76b47b819c69ddf1a4b12ee158a1a26c6e04f96dcff0a5.tar.gz` reproduces the recorded code hash across 17 source files using the archived filename-and-content hashing pattern. Provenance refers to that archive, not the subsequently changed frontend tree. The Phase 2 demo archive is separate.

The run records the same CPU, memory, OS, and Bun version listed above. Its offline statistics-and-scoring elapsed time is `5,409,734.237857 ms`, about 90.16 minutes, including `1,349,580.883747 ms` for corpus statistics. Peak sampled RSS is `3,103,670,272 bytes`, about 2.89 GiB. These are offline elapsed-time and memory measurements. They do not establish online latency or throughput, and sampled RSS is not a continuous peak-memory measurement.

Recompute metrics from the saved run without repeating retrieval:

```sh
bun eval/evaluate.ts --qrels data/reference/qrels.msmarco-passage.dev-subset.txt --run artifacts/msmarco.run.trec --out artifacts/msmarco-recomputed.json
```

## Phase 2 demo verification

The search API and React page serve the full product snapshot of 104,745 public posts. Four real queries were checked: `binary search time complexity`, `P versus NP`, `hash table collisions`, and `C++ branch prediction`. All forty returned results had source URLs and attribution. Each displayed result's score agreed with its server trace, and the sum of term contributions agreed with the engine score within `2e-6`. The saved responses are in `artifacts/phase2/demo-check.json`.

Browser checks covered desktop and mobile results, Inspect selection, the query shortcut, Escape and focus restoration, zero matches, and recovery after a simulated HTTP 503 response. API tests exercise actual HTTP requests, invalid inputs, missing paths, trace expiry and capacity, ranking, counters, and term evidence. All 22 tests and strict TypeScript checking pass.

The standalone executable includes its web assets. HTTP checks verified the HTML, CSS, JavaScript, and metadata responses. The production environment and classic JSX transform remove React development code; the checked client JavaScript is about 234 KB before transfer compression. The build follows [Bun's executable documentation](https://bun.sh/docs/bundler/executables). Request timing values in the interface describe one request and are not an isolated performance comparison.

The user authorized this Phase 2 work while the full MS MARCO gate runs. No compression, disk index, pruning, neural retrieval, Compare, or Benchmarks implementation is included.

The demo snapshot records its machine and source hash in `artifacts/phase2/environment.json`; the source archive is `artifacts/source/9056eec07a5a5e9e0a4401aeeb0cb45324573b1cadcb73d125a336de845984a0.tar.gz`. The archive also includes the HTML entry point and dependency lockfile.

An independent finish review requested a durable composition record and exact opener-focus restoration. Both fixes were scored resolved, with no observed regressions attributable to them. That verdict covers those fixes; the screenshot evidence is limited to the captured desktop and mobile viewports. The production build was also executed in the browser after its JSX configuration fix.

The full MS MARCO validation subsequently passed as recorded above. Phases 0–2 are complete; the authorization described in this demo record reflects the order in which the work proceeded.
