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

- [x] Implement Anserini parity-mode analyzer with Porter stemming and Lucene stopwords; full benchmark parity passes its declared tolerances.
- [x] Separate technical-token analyzer.
- [x] In-memory inverted index and exhaustive document-at-a-time retrieval.
- [x] TF, TF-IDF, BM25, and a bounded top-k heap.
- [x] Tiny-corpus golden tests and scoring invariants.
- [x] Full MS MARCO dev and all CQADupStack evaluations against Anserini.
- [x] First measured row in `docs/experiments.md`.
- [x] Exit gate: benchmark parity within a tolerance declared before the run.

## Phase 2: search and Inspect

- [x] `GET /search` and `GET /trace/{query_id}` using `Bun.serve`.
- [x] Actual stage timers, candidate counts, and per-term BM25 ledger.
- [x] Results page and Inspect drawer.
- [x] End-to-end API and browser verification.
- [x] Exit gate: first two minutes of the demo work end to end.

## Scope guard

- [x] Leave `TRACE.v2.md` unchanged.
- [x] Keep phase completion tied to its exit gate. The user has authorized parallel Phase 2 implementation while full MS MARCO validation runs.
- [x] Keep Phase 3 compression, mmap, pruning, and workers out of this implementation request.
- [x] Keep neural retrieval, reranking, Compare, and Benchmarks out of these three phases.

## Round 2: public data and delegated Phase 0 work

- [x] Create the Bun package, strict TypeScript configuration, streaming file reader, and locked document schema.
- [x] Confirm that the initial TypeScript check passes.
- [x] Delegate metrics and corpus import as separate 5.6-luna tasks on the requested providers.
- [x] Find a published Anserini BM25 run with a published checksum for Phase 0 evaluator parity.
- [x] Add public dataset acquisition and bounded Parquet conversion in TypeScript.
- [x] Pin the CQADupStack snapshot revision and verify downloaded Parquet files against their source hashes.
- [x] Finish the running MS MARCO and Stack Exchange snapshot downloads.
- [x] Verify imported public data and evaluator outputs before starting Phase 1.

## Round 3: external evaluator parity

- [x] Verify the published Anserini TREC-COVID round 3 abstract BM25 run against MD5 `d08d85c87e30d6c4abf54799806d282f`.
- [x] Match all four metrics per query and in aggregate against `pytrec_eval` on 40 judged queries. Maximum absolute difference: `2.220446049250313e-16` with a numerical precision threshold of `1e-12`.
- [x] Save the input hashes and both evaluator outputs in `artifacts/phase0-parity.json`.
- [x] Pass two evaluator tests with 15 assertions, including graded relevance, ties, missing results, and malformed records.
- [x] Verify the public Computer Science Stack Exchange dump against MD5 `f7cb3c523ae1a4ed1c341faeb2e6d3c9` and extract Posts.xml and PostLinks.xml.
- [x] Complete importer validation and normalized corpus acquisition.

## Round 4: Phase 1 core and review

- [x] Add the in-memory inverted index, exhaustive document-at-a-time retrieval, TF, TF-IDF, and BM25.
- [x] Add the bounded top-k heap and deterministic score tie policy.
- [x] Implement Lucene length quantization and float scoring for BM25 parity mode.
- [x] Declare benchmark parity tolerances before retrieval runs in `docs/decisions.md`.
- [x] Record Phase 0 reference results and reproduction commands in `docs/experiments.md`.
- [x] Review the importer's memory use, stable IDs, and license metadata; send specific corrections to its agent.
- [x] Acquire a public Stack Overflow question subset for product ingestion checks.
- [x] Finish the analyzer and validate the Phase 1 core with golden tests.

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
- [x] Finish all normalized imports and run the full Phase 1 comparisons.

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
- [x] Run all full-corpus reference comparisons. The original sequential ordering was superseded by the user's authorization in Round 11.

## Round 7: first full retrieval comparison

- [x] Evaluate all 699 judged queries on all 22,998 CQADupStack Android documents.
- [x] Pass its declared nDCG@10 tolerance: Trace `0.3810591391`, Anserini `0.3801`, absolute difference `0.0009591391`.
- [x] Save the full TREC run, metrics, latency distributions, counters, and hardware metadata.
- [x] Start exhaustive MS MARCO indexing and its complete 6,980-query evaluation with `k1=0.82`, `b=0.68`.
- [x] Start the remaining 11 CQADupStack site comparisons.
- [x] Include third-party source attribution in `NOTICE.md`.
- [x] Verify all remaining comparisons and their dataset counts before passing the overall Phase 1 gate.

## Round 8: resume and bounded full-corpus evaluation

- [x] Confirm all 12 CQADupStack site runs finished and passed their predeclared nDCG@10 tolerances.
- [x] Confirm the initial full-heap MS MARCO process stopped without producing a result. Do not count it as a passed run.
- [x] Add an offline exhaustive evaluation mode that uses bounded in-memory batches and full-corpus document frequencies and average length.
- [x] Check batched ranking against the whole in-memory index, including exact scores, ties, exclusions, empty documents, and candidate/postings counters.
- [x] Fix the reference gate to reject malformed count and scoring declarations.
- [x] Pass 17 tests and strict TypeScript checking.
- [x] Restart the complete 8,841,823-document, 6,980-query MS MARCO quality run. Batch timings do not count as online latency measurements.
- [x] Record all CQADupStack metrics and their equal-site macro in `docs/experiments.md`.
- [x] Start fresh CQADupStack runs to replace earlier artifacts with incomplete input hashes and inconsistent source snapshots.
- [x] Run the batch evaluator on all CQADupStack Android documents and 699 queries, then compare its complete top-1,000 run against the whole-index run.
- [x] Obtain an independent read-only review of the batch scorer. Preserve a source archive for each active experiment snapshot, and fix null scoring declarations that could bypass validation.
- [x] Verify the completed MS MARCO metrics and corpus hash before passing the Phase 1 gate.

## Round 9: corpus reproduction and benchmark provenance

- [x] Add README commands for installing dependencies, running checks, acquiring benchmark inputs, importing them, and reproducing quality runs.
- [x] Replace the temporary product conversion with `eval/product.ts`, reusing the dump importer for the public Stack Overflow API response.
- [x] Include the bounded public API snapshot in product acquisition and record its hash in the combined product manifest.
- [x] Verify API entity decoding, source IDs, and attribution through the existing importer.
- [x] Verify all fresh CQADupStack counts, input hashes, corpus hashes, scoring settings, source archives, and per-site gates.
- [x] Pass the equal-site macro gate: Trace nDCG@10 `0.3022149057`, Anserini `0.3021166667`, absolute difference `0.0000982390`.
- [x] Confirm the archived engine files are identical across all fresh CQADupStack runs.
- [x] Rebuild all 104,745 product documents and 1,635 duplicate links. The current importer removes artificial newlines after inline code found in the older normalized snapshot.
- [x] Fix multiline API body escaping so it remains compatible with the streaming dump parser.
- [x] Pass all 18 tests, strict TypeScript checking, and whitespace checks after the corpus-reproduction changes.

## Round 10: full MS MARCO run and external validation

- [x] Complete corpus-wide statistics for all 8,841,823 passages with duplicate-ID checks.
- [x] Start exhaustive scoring of all 6,980 queries across bounded batches. Progress is recorded in `artifacts/msmarco.log`.
- [x] Delegate verification of the completed run and its hashes, counts, settings, provenance, and MRR tolerance to the requested 5.6-luna provider.
- [x] Pass the complete MS MARCO reference gate and record the measured row.
- [x] Begin Phase 2 in parallel under the user's subsequent authorization; keep the full Phase 1 quality gate pending.

## Round 11: parallel Phase 2 implementation

- [x] Record the user's authorization to keep building while the full benchmark runs, preserving the pending quality gate.
- [x] Choose React with Bun's native HTML bundler and install pinned dependencies.
- [x] Record product facts and the search/Inspect layout from the supplied plan.
- [x] Delegate the search API and real query-trace contract to the requested 5.6-luna provider.
- [x] Build and verify the results page and Inspect panel against real product queries.

## Round 12: complete Phase 2 demo

- [x] Implement metadata, input validation, source excerpts, attribution, and bounded query traces.
- [x] Build the React results page and the server-backed BM25 Inspect ledger.
- [x] Verify four real queries and all forty result ledgers on the full product snapshot.
- [x] Verify desktop and mobile behavior, result selection, the query shortcut, zero matches, and error recovery.
- [x] Obtain an independent review and resolve its design-record and keyboard-focus findings.
- [x] Verify that Escape restores focus to the particular result button that opened Inspect.
- [x] Fix the pinned Bun version's production JSX mismatch and execute the standalone build in the browser.
- [x] Pass all 22 tests, strict TypeScript checking, and whitespace checks.
- [x] Preserve a source archive and record demo verification separately from benchmark measurements.
- [x] Continue review and completion validation on the active connection after the requested Luna accounts returned expired-token errors.
- [x] Confirm the final design documentation handoff; extracted tokens and component examples match the implementation.

## Round 13: complete Phase 1 validation and Phases 0–2

- [x] Verify the full MS MARCO corpus, input hashes, archived source, scoring configuration, and all 6,974,599 TREC rows without repeating retrieval.
- [x] Recompute all four metrics; every per-query value agrees exactly and aggregate differences remain below `1e-12`.
- [x] Pass the MRR@10 gate: Trace `0.18719675262655042`, reference `0.18741227770955546`, absolute difference `0.00021552508300504147 < 0.001`.
- [x] Record the offline 90.16-minute run and 2.89 GiB sampled peak RSS separately from serving performance.
- [x] Close the Phase 1 gate, retain Phase 2 evidence and Round 12, and update current completion status without changing `TRACE.v2.md`.

## Phase 3: performance

- [x] Flat typed-array index on disk, opened with `Bun.mmap`.
- [x] VByte postings.
- [x] 128-posting bitpacked blocks with last-document skip data and per-block saturation bounds.
- [x] Exact MaxScore.
- [x] Exact Block-Max WAND.
- [x] Segmented parallel build; Android files byte-identical across 1-segment, 3-segment, and single-pass builds.
- [x] Full MS MARCO index: 8,841,823 passages, 266,276,999 postings, 265 s, 4.72 GB peak sampled RSS.
- [x] Server on the disk index, with `--mode`, `--workers`, and `--trace off`; Inspect shows per-term postings stats.
- [x] Android: all five modes give a top-1,000 run identical to Phase 1.
- [ ] Step 1 row: heap index on the 1M-passage prefix.
- [ ] Steps 2–6 rows: every mode on full MS MARCO at k=10 and k=1,000, cold and warm.
- [ ] Step 7 row: QPS at declared concurrency, 1 worker against one per core.
- [ ] Step 8 row: MiniSearch and Orama.
- [ ] Exit gate: every pruned variant equals exhaustive top-k on all 6,980 dev queries, recorded in `artifacts/phase3/gate.json`.
- [ ] Decide on the optional C++ kernel from a profile.

## Phase 4: dense and hybrid

- [x] `neural/embed.py`: offline GPU document embeddings with bge-small-en-v1.5, int8 with per-vector scales, row order equal to the disk index.
- [x] Online query embeddings in Bun through ONNX Runtime, with a WordPiece tokenizer in TypeScript.
- [x] Exact int8 brute-force search, parallel across worker threads for offline runs.
- [x] usearch HNSW build (`bun engine/dense.ts`) and ANN search re-scored by the exact scorer.
- [x] RRF fusion, k = 60.
- [x] `eval/dense.ts`: dense, ANN, BM25, and hybrid runs and metrics, ANN recall against exact, Recall@100 gain over BM25, latency.
- [x] Server `--vectors`, `--dense`, `--models`; trace stages for embedding, dense search, and fusion.
- [x] Inspect: retriever overlap, which retriever produced each result, dense similarity, RRF score, rank movement.
- [x] Pinned model downloads with `bun eval/fetch.ts --dataset models`.
- [ ] Embed all 12 CQADupStack corpora and MS MARCO on Colab, then copy them to `data/dense/`.
- [ ] Run `eval/neural.sh` after the Phase 3 benchmark finishes.
- [ ] Exit gate: dense-only and hybrid rows on every dataset in `docs/experiments.md`, with Recall@100 gain over BM25.

## Phase 5: reranking

- [x] Batched cross-encoder over the fused top N in the server (`--rerank N`) and in Inspect.
- [x] `eval/rerank.ts`: sweep N in {10, 20, 50, 100}, quality on every judged query, added latency per N, SVG plot.
- [x] Declare the rule for choosing N before running the sweep.
- [ ] Run the sweep on MS MARCO dev and CQADupStack Android.
- [ ] Exit gate: a chosen N, justified by the plot, and the server default set to it.
