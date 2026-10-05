# Trace

Search, from first principles.

Trace is a search engine for technical knowledge. I wrote the retrieval core myself: tokenizer, inverted index, BM25, on-disk compressed postings and dynamic pruning. On top of that sit dense retrieval, hybrid fusion and cross-encoder reranking. Every ranking and performance claim comes from a benchmark script in the repo, measured against an external reference system.

The project should hold up from three angles:

- Ignore the UI, and the engine is still impressive.
- Ignore the code, and the Inspect view still shows how the engine works.
- Ignore both, and the experiment table still tells the story in numbers.

## The claim this project exists to earn

> Built Trace, a search engine in TypeScript on Bun over [N]M documents. BM25 matches Lucene/Anserini quality within [x] nDCG@10. Memory-mapped, block-compressed postings with Block-Max WAND cut P95 latency from [a] ms to [b] ms and index memory by [c]x. Hybrid dense retrieval plus cross-encoder reranking raised nDCG@10 from [d] to [e] for [f] ms of added latency.

Every bracket gets filled by a script. If a bracket can't be filled, the sentence changes. Nothing gets rounded up.

## Locked decisions

These are defaults. Flip any of them now, before code exists, and record the choice in `docs/decisions.md`.

| Decision | Default | Why |
| --- | --- | --- |
| Engine language | TypeScript on Bun | Your strongest language, so you can defend every line in an interview. `Bun.mmap` and typed arrays still give you real control over memory layout. |
| Query path | `Bun.serve` with one worker per core. Each worker maps the same index files. Neural models run through `onnxruntime-node`. | The OS page cache shares the mapped index across workers. `onnxruntime-node` 1.30 runs under Bun 1.3 (checked on 2026-10-05 with the int8 MiniLM reranker). |
| Hot loops | Allocation-free code over typed arrays | Keeps GC pauses out of P99. Measure GC's effect on tail latency directly. |
| C++ | Optional, at the end of Phase 3 only. One kernel behind `bun:ffi`. | See "Optional C++ kernel" below. |
| Offline / eval | TypeScript, plus one Python script for the GPU embedding job | Metrics are in TS and checked against `pytrec_eval` once. |
| Web | Same repo, your usual frontend stack, one framework, no extras | The UI is a window onto the engine, not the project. |
| Scale benchmark | MS MARCO passage (8.8M passages, 6,980 dev queries) | Large enough that compression and pruning matter. Published BM25 baselines exist. |
| Technical-domain eval | BEIR CQADupStack | Real StackExchange technical questions with qrels. |
| Product corpus | Stack Exchange technical sites (Stack Overflow subset + smaller tech sites), a few million posts | Technical, CC BY-SA, and duplicate-question links give **free relevance labels**. You don't have to self-judge queries. Check current dump access terms first. |
| Quality reference | Anserini/Pyserini BM25 | Proves your BM25 is correct, not just plausible. |
| Speed reference | Your own exhaustive baseline, plus MiniSearch and Orama at corpus sizes they can handle | Same language, so it's a fair fight. Where they run out of memory, that is a finding too. A Tantivy number can appear as context, not as a target. |
| Hardware | One declared machine for every published number | Numbers from different machines don't compare. |
| ANN | Exact brute force over int8 vectors first, then an HNSW library from npm | The sparse engine is the "from scratch" part. Your own HNSW in TS is a stretch goal. |
| Dense model | Small bi-encoder (e.g. bge-small or e5-small), ONNX | Doc embeddings computed offline on Colab. Query embeddings computed online in Bun. |
| Reranker | MiniLM-L6 MS MARCO cross-encoder, ONNX int8, top 20 to 50 on CPU | Rerank depth is a measured trade-off, not a guess. |
| Live demo | Hosted on a subset (~500k docs) on a small VPS | Full-scale numbers come from local runs and are labeled as such. |

## Scope

| In v1 | Later, if v1 is done | Cut |
| --- | --- | --- |
| Tokenizer with a technical-token policy | BM25F field weighting (title vs body) | Explore / topic synthesis |
| In-memory index, then on-disk mmap index | Phrase and proximity queries (positions) | Crawling |
| TF, TF-IDF, BM25 with exhaustive top-k | Immutable segments, merges and deletes | Distributed sharding (discussion only) |
| VByte, then block bitpacking with skip data | SPLADE learned sparse retrieval on your own index | Query result caching |
| MaxScore, then Block-Max WAND (exact) | Your own HNSW | |
| Worker-per-core query serving | | |
| Dense retrieval, RRF hybrid, cross-encoder rerank | | |
| Search page, Inspect, Compare, Benchmarks | | |

SPLADE is the strongest "later" item. It is a neural model whose output goes straight into the inverted index you built, which ties the ML half to the systems half.

## Architecture

```text
offline   corpus → normalize → doc store (JSONL + stable ids)
                       ├→ analyzer → index builder → lexicon + postings + doc table (mmap files)
                       └→ bi-encoder (GPU) → embeddings → ANN index

online    query → analyzer ─┬→ BM25 (BMW over compressed postings) ─┐
                            └→ bi-encoder → ANN ──────────────────────┼→ RRF → top-N → cross-encoder → results
                                                                      └→ trace events → Inspect
```

Whiteboard order: doc ids → postings → BM25 + top-k heap → on-disk layout + compression → pruning → dense as a second candidate generator → fusion → rerank → evaluation, which validates every box before it.

## Phases

Each phase ends in a state you could stop at and still talk about. Don't start a phase until the previous one meets its exit criterion.

### Phase 0 · Harness

- Import MS MARCO, CQADupStack and the product corpus into one JSONL schema: `doc_id, uri, title, body, source, content_type, published_at, checksum`.
- Metrics code (MRR@10, nDCG@10, Recall@100/1000).
- **Exit:** your metrics reproduce `pytrec_eval` output exactly on Anserini's published BM25 run file. This validates the evaluator before it judges anything.

### Phase 1 · Correct BM25

- Analyzer, in-memory inverted index, TF / TF-IDF / BM25, exhaustive document-at-a-time scoring with a top-k heap.
- Parity mode: copy Anserini's analyzer (Porter stemmer, its stopword list) so scores are comparable. The technical-token analyzer is a separate experiment on the product corpus.
- Golden tests on a tiny hand-checkable corpus.
- **Exit:** MRR@10 on MS MARCO dev and nDCG@10 on CQADupStack match Anserini within a stated tolerance. First row of the experiment table.

### Phase 2 · Search API, UI and Inspect v1

- `GET /search` and `GET /trace/{query_id}`. Traces record real stage timings, candidate counts and per-term BM25 components.
- Results page and an Inspect drawer showing the BM25 ledger (tf, df, idf, length norm, contribution).
- **Exit:** the first two minutes of the demo work end to end.

### Phase 3 · Performance

Each step is one row in `docs/experiments.md` with latency (P50/P95/P99), postings visited, docs scored, index bytes and RSS. Quality must not move, because every step is exact.

1. Heap index (JS objects and Maps) as the baseline, with its memory measured.
2. Flat typed-array layout on disk, read through `Bun.mmap`, with cold and warm cache measured separately.
3. VByte postings compression.
4. 128-doc blocks with bitpacking and per-block max-score and skip metadata.
5. MaxScore.
6. Block-Max WAND.
7. Worker-per-core serving, QPS at declared concurrency.
8. MiniSearch and Orama on the same queries and corpus sizes.

Step 1 to 2 is the best interview story in the project. It shows what moving from JS objects to a flat binary layout does to memory, startup time and GC.

#### Optional C++ kernel

Do this only after step 8, and only if the profiler shows block decode and scoring dominating query time.

- Port one function to C++: decode a run of posting blocks and score them, writing results into a buffer the caller passes in. Keep it to a few hundred lines with an `extern "C"` interface, built with `clang++ -O3 -march=native` into a shared library.
- Cross the FFI boundary once per query term, never once per posting. Pass the mmap'd buffer with `ptr()` so no bytes get copied.
- The TS version stays as the reference. Both must return identical top-k on the full dev query set.
- Record it as one more row in the experiment table, TS kernel against C++ kernel.
- If you can't explain every line of the C++ under questioning, leave it out. A clean TS result beats a C++ speedup you can't defend.

- **Exit:** the experiment table, plus a check that the top-k from every pruned variant equals the exhaustive top-k across the full dev query set. **This is already a strong résumé project on its own.**

### Phase 4 · Dense and hybrid

- Offline document embeddings, exact search first, then ANN with recall measured against exact search.
- RRF fusion. Inspect shows which retriever produced each candidate and the overlap between the two.
- **Exit:** dense-only and hybrid rows in the quality table on every dataset, with Recall@100 gain over BM25 reported.

### Phase 5 · Reranking

- Cross-encoder over the fused top-N, batched.
- Sweep N in {10, 20, 50, 100} and plot quality against latency.
- Reference point from the Bun check: one batch of 32 pairs at 128 tokens took about 140 ms on CPU. Expect the sweep to land near N = 20.
- **Exit:** a chosen N, justified by the plot.

### Phase 6 · Product and story

- Compare page: BM25, dense, hybrid and hybrid+rerank side by side, with rank-movement lines.
- Benchmarks page rendered from `docs/experiments.md` data, with dataset, commit and hardware shown on every number.
- README covering architecture, index format, methodology and reproduction steps.
- Hosted subset demo and a recorded 3 to 5 minute walkthrough.
- **Exit:** a fresh clone can rebuild the index and reproduce one table row from the README alone.

If you run short on time, finish Phase 3 and Phase 6 before starting Phase 4.

## Measurement rules

- One machine. Record CPU, RAM, OS, Bun version, corpus version, index config and commit with every run.
- Warm up first, then run the full query set several times and report distributions.
- Index build time is reported separately from query latency.
- Tracing can be switched off, and benchmark runs keep it off.
- Every quality number names its dataset and query count.
- Each experiment answers two questions: did quality change, and what did it cost.

## Inspect

Inspect reads real trace events from the engine, never values recomputed in the UI.

- Pipeline stages with timings and candidate counts.
- Per-result ledger with BM25 term components, dense similarity, RRF contribution and reranker score.
- Rank movement, e.g. BM25 #31 → hybrid #8 → reranked #2.
- Postings stats per query term: df, block count, compressed bytes, blocks skipped by BMW.

The last item is the one that makes the performance work visible.

## Repo layout

```text
engine/   TS: analyzer, index build, postings codecs, BM25, pruning
server/   Bun: HTTP API, workers, orchestration, ONNX inference, tracing
neural/   one Python script: offline document embeddings on GPU
eval/     TS: metrics, qrels, experiment runner
bench/    latency and load scripts
web/      UI
docs/     decisions.md, index-format.md, experiments.md
```

## Do not claim

- "Production-scale", "Google-scale", or any corpus size you didn't index.
- A latency number without hardware next to it.
- A quality gain without the dataset next to it.
- "From scratch" for parts that use a library (ANN, ONNX Runtime). Name them.

## Interview prep

Keep the question list and the pitch from the first draft (§14) in a separate `INTERVIEW.md`. The build spec stays about building.
