# Implementation checklist

`TRACE.v2.md` is the unchanged specification. The requested first three phases are Phase 0, Phase 1, and Phase 2. Implementation checks and phase exit gates are separate.

## Round 1: specification and environment

- [x] Read the complete specification and ponytail skill.
- [x] Confirm TypeScript on Bun; Bun 1.3.14 is installed.
- [x] Check the existing workspace. It contains the two specifications and no implementation.
- [x] Check official Anserini analyzer, benchmark instructions, and current Stack Exchange dump access process.
- [x] Install the isolated `pytrec_eval` reference evaluator in `.venv`.
- [x] Discover 5.6-luna through ChatGPT Personal and personal-go for small delegated tasks.

## Phase 0: harness

- [x] Implement streaming import of MS MARCO passage into the locked JSONL schema.
- [x] Implement streaming import of all 12 CQADupStack sites into that schema.
- [x] Implement public Stack Exchange Posts and PostLinks import with attribution and duplicate labels.
- [x] TypeScript MRR@10, nDCG@10, Recall@100, and Recall@1000.
- [x] Check evaluator behavior on hand-verifiable cases.
- [x] Exit gate: match `pytrec_eval` on a published Anserini BM25 run.

## Phase 1: correct BM25

- [x] Implement Anserini parity-mode analyzer with Porter stemming and Lucene stopwords; full benchmark parity remains to be verified.
- [x] Separate technical-token analyzer.
- [x] In-memory inverted index and exhaustive document-at-a-time retrieval.
- [x] TF, TF-IDF, BM25, and a bounded top-k heap.
- [x] Tiny-corpus golden tests and scoring invariants.
- [ ] Full MS MARCO dev and all CQADupStack evaluations against Anserini.
- [ ] First measured row in `docs/experiments.md`.
- [ ] Exit gate: benchmark parity within a tolerance declared before the run.

## Phase 2: search and Inspect

- [ ] `GET /search` and `GET /trace/{query_id}` using `Bun.serve`.
- [ ] Actual stage timers, candidate counts, and per-term BM25 ledger.
- [ ] Results page and Inspect drawer.
- [ ] End-to-end API and browser verification.
- [ ] Exit gate: first two minutes of the demo work end to end.

## Scope guard

- [x] Leave `TRACE.v2.md` unchanged.
- [ ] Do not begin the next phase before the preceding exit gate passes.
- [x] Keep Phase 3 compression, mmap, pruning, and workers out of this implementation request.
- [x] Keep neural retrieval, reranking, Compare, and Benchmarks out of these three phases.

## Round 2: public data and delegated Phase 0 work

- [x] Create the Bun package, strict TypeScript configuration, streaming file reader, and locked document schema.
- [x] Confirm that the initial TypeScript check passes.
- [x] Delegate metrics and corpus import as separate 5.6-luna tasks on the requested providers.
- [x] Find a published Anserini BM25 run with a published checksum for Phase 0 evaluator parity.
- [x] Add public dataset acquisition and bounded Parquet conversion in TypeScript.
- [x] Pin the CQADupStack snapshot revision and verify downloaded Parquet files against their source hashes.
- [ ] Finish the running MS MARCO and Stack Exchange snapshot downloads.
- [ ] Verify imported public data and evaluator outputs before starting Phase 1.

## Round 3: external evaluator parity

- [x] Verify the published Anserini TREC-COVID round 3 abstract BM25 run against MD5 `d08d85c87e30d6c4abf54799806d282f`.
- [x] Match all four metrics per query and in aggregate against `pytrec_eval` on 40 judged queries. Maximum absolute difference: `2.220446049250313e-16` with a numerical precision threshold of `1e-12`.
- [x] Save the input hashes and both evaluator outputs in `artifacts/phase0-parity.json`.
- [x] Pass two evaluator tests with 15 assertions, including graded relevance, ties, missing results, and malformed records.
- [x] Verify the public Computer Science Stack Exchange dump against MD5 `f7cb3c523ae1a4ed1c341faeb2e6d3c9` and extract Posts.xml and PostLinks.xml.
- [ ] Complete importer validation and normalized corpus acquisition.

## Round 4: Phase 1 core and review

- [x] Add the in-memory inverted index, exhaustive document-at-a-time retrieval, TF, TF-IDF, and BM25.
- [x] Add the bounded top-k heap and deterministic score tie policy.
- [x] Implement Lucene length quantization and float scoring for BM25 parity mode.
- [x] Declare benchmark parity tolerances before retrieval runs in `docs/decisions.md`.
- [x] Record Phase 0 reference results and reproduction commands in `docs/experiments.md`.
- [x] Review the importer's memory use, stable IDs, and license metadata; send specific corrections to its agent.
- [x] Acquire a public Stack Overflow question subset for product ingestion checks.
- [ ] Finish the analyzer and validate the Phase 1 core with golden tests.

## Round 5: complete benchmark inputs and importer fixes

- [x] Download and verify MS MARCO's full `collectionandqueries.tar.gz` against its published MD5.
- [x] Extract and count all `8,841,823` MS MARCO passages.
- [x] Download all 12 CQADupStack sites and the official qrels.
- [x] Pass all four importer tests with 28 assertions.
- [x] Fix importer memory use to retain IDs rather than document bodies.
- [x] Preserve Stack Exchange source identity independently from content checksums.
- [x] Preserve the source's explicit license and account for the historical CC BY-SA 2.5, 3.0, and 4.0 dates.
- [x] Start complete normalized imports for MS MARCO, CQADupStack, and the public product snapshots.
- [x] Add an evaluation-runner task on the requested 5.6-luna provider.
- [x] Protect evaluator per-query records from special object-property query IDs.
- [ ] Finish all normalized imports and run the full Phase 1 comparisons.

## Round 6: full imports and core validation

- [x] Import all `8,841,823` MS MARCO passages into normalized JSONL.
- [x] Import every CQADupStack site, with its original document IDs and corpus hash.
- [x] Import `104,645` Computer Science Stack Exchange posts and `1,635` duplicate links.
- [x] Import `100` public Stack Overflow questions and combine both product sources into `product.jsonl`.
- [x] Pass all 15 current tests and the strict TypeScript check.
- [x] Validate the bounded heap against sorting and exhaustive DAAT against an independent document scan.
- [x] Validate BM25's term ledger and Lucene length-quantization invariants.
- [x] Add the Apache license file for the Lucene Porter port.
- [x] Fetch the published Anserini nDCG@10 reference for each CQADupStack site before comparisons.
- [x] Record the analyzer limitation: Bun's ICU segmentation may differ from Lucene on Unicode boundaries. A passed full-quality comparison is still required.
- [ ] Run all full-corpus reference comparisons; do not start Phase 2 until the gate passes.

## Round 7: first full retrieval comparison

- [x] Evaluate all 699 judged queries on all 22,998 CQADupStack Android documents.
- [x] Pass its declared nDCG@10 tolerance: Trace `0.3810591391`, Anserini `0.3801`, absolute difference `0.0009591391`.
- [x] Save the full TREC run, metrics, latency distributions, counters, and hardware metadata.
- [x] Start exhaustive MS MARCO indexing and its complete 6,980-query evaluation with `k1=0.82`, `b=0.68`.
- [x] Start the remaining 11 CQADupStack site comparisons.
- [x] Include third-party source attribution in `NOTICE.md`.
- [ ] Verify all remaining comparisons and their dataset counts before passing the overall Phase 1 gate.
