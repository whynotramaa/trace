# Decisions for Phases 0 to 2

The implementation follows `TRACE.v2.md`. Its first three phases are numbered 0, 1, and 2. The specification has not changed.

| Decision | Implementation |
| --- | --- |
| Engine and evaluation | TypeScript on Bun 1.3.14. No external search engine in the retrieval path. |
| Phase 0 reference | Published Anserini TREC-COVID round 3 abstract BM25 run, verified against its published MD5. This checks the evaluator, not Trace's retrieval quality. |
| Evaluator precision | Compare every query and aggregate metric to `pytrec_eval` with absolute numerical tolerance `1e-12`. Floating-point implementations can differ in their last bits. |
| Benchmark corpus | Full MS MARCO V1 passage collection and all 12 CQADupStack sites. Each CQADupStack site is evaluated independently; its macro average weights sites equally. |
| Corpus storage | The specified normalized JSONL schema with source IDs and SHA-256 content checksums. Parquet is only an upstream download format. |
| Parquet conversion | `hyparquet` and its codec package read the published CQADupStack mirror in bounded batches. They implement file parsing, not retrieval. Bun has no native Parquet reader. |
| Product ingestion | Public April 2024 Computer Science Stack Exchange dump, plus a public Stack Overflow API question subset. Actual imported counts are recorded; this is not a claim of millions of product documents. |
| BM25 reference settings | Anserini flat single-field indexing concatenates title and body. Lucene length quantization and float scoring apply only in parity mode. No BM25F. |
| BM25 tolerance | Declare maximum absolute MRR@10 difference `0.001` on all 6,980 MS MARCO dev queries and nDCG@10 difference `0.002` on each CQADupStack site and its macro average before running comparisons. These are quality tolerances, not score equality guarantees. |
| Educational strategies | TF is the sum of term frequencies multiplied by query term frequency. TF-IDF weights these terms with the same positive IDF as BM25. Both use exhaustive candidate scoring. |
| Ties | Descending score, then descending external document ID, matching `trec_eval`'s interpretation of tied run scores. |
| Phase ordering | A passed evaluator check permits Phase 1. The user subsequently authorized Phase 2 implementation while the full reference-quality check runs. Phase 1 remains pending until that complete gate passes; unit tests and subset runs do not replace it. |
| Offline memory limit | Full MS MARCO quality evaluation can score bounded in-memory batches with corpus-wide document frequencies and average length, then merge their top-k heaps. Every matching document is scored. This changes execution order, not BM25 scores or corpus coverage. Batch times are not serving latency measurements. The serving index remains the Phase 1 heap index; disk layouts and pruning remain Phase 3. |

The [Anserini analyzer source](https://github.com/castorini/anserini/blob/master/src/main/java/io/anserini/analysis/DefaultEnglishAnalyzer.java) defines parity tokenization. The [MS MARCO reproduction instructions](https://github.com/castorini/pyserini/blob/master/docs/experiments-msmarco-passage.md) define the passage collection and tuned BM25 baseline. The [CQADupStack Android regression](https://github.com/castorini/anserini/blob/master/docs/reproduce/from-document-collection/beir-v1.0.0-cqadupstack-android.flat.md) defines flat indexing and self-query removal.

Public ingestion uses the [Stack Exchange archive](https://archive.org/details/stackexchange) and the [Stack Exchange API](https://api.stackexchange.com/docs/questions). The [dump access announcement](https://meta.stackexchange.com/questions/401324/announcing-a-change-to-the-data-dump-process) describes the current access process. No signed-in dump account is used. Attribution and the source contribution's license remain part of every imported post.

Phase 2 uses React with Bun's native HTML bundler and a standalone executable. With the pinned Bun 1.3.14 runtime, classic React JSX avoids the HTML bundler's development-transform mismatch with the production JSX runtime. Production builds set `NODE_ENV=production` before compiling; browser execution is checked in addition to HTTP asset delivery.

# Decisions for Phase 3

| Decision | Implementation |
| --- | --- |
| Index files | One directory per corpus with flat, VByte, and 128-posting bitpacked block layouts side by side. Every file is a little-endian typed array opened with `Bun.mmap`. [index-format.md](index-format.md) has the layout. |
| Build | The corpus is cut into byte ranges of about 256 MiB at line boundaries. Child processes analyze them in parallel, 4 at a time, into term-sorted segments, and the parent merges the segments by term. A child returns its memory to the OS when it exits. |
| Supported scoring | The disk index supports the `anserini` analyzer with Lucene float scoring only. Block bounds use the build-time `k1` and `b`, and pruned modes refuse others. |
| Exactness | MaxScore and BMW must return the exhaustive top-k, scores and tie order included. Scores add in query-term order. A document is skipped only if its float32-rounded bound, with relative slack `1e-12`, is strictly below the threshold. |
| Tie order | A precomputed rank of each external document ID replaces string comparison in the heap and keeps `trec_eval` order. |
| Document store | The server reads a result's JSONL line with a positional read at its stored offset. `Bun.mmap` aborts on files of 4 GiB and above, and MS MARCO's JSONL is 4.69 GB. |
| Heap baseline scale | The Phase 1 heap index cannot hold all 8.8M passages on this machine. Step 1 compares heap and flat on the first 1,000,000 MS MARCO passages. Full-corpus rows cover the disk layouts only. |
| Benchmark protocol | One process per layout and mode, so mapped pages from one mode do not count toward another's RSS. Each run drops the mode's index files from the page cache with `dd oflag=nocache`, times opening and a first query, makes one cold pass over all judged queries, warms up on 100 queries, then makes 3 warm passes. Query traces are off. |
| Gate | Every mode's TREC run must be byte-identical to the flat exhaustive run on all 6,980 MS MARCO dev queries at k=10 and k=1,000. The full k=1,000 run must also equal the Phase 1 run. |
| Serving | `--workers n` starts n processes that bind one port with `SO_REUSEPORT` and map the same files. Traces are shared through a temporary directory. |
| Library comparison | MiniSearch 7.2.0 and Orama 3.1.18 index title plus body with their own tokenizers and scoring. They run at sizes they can hold, under a 10 GiB RSS cap. Their quality numbers are not BM25 parity results. |

# Decisions for Phases 4 and 5

| Decision | Implementation |
| --- | --- |
| Phase order | The user asked for Phases 4 and 5 while the Phase 3 benchmark still runs. The Phase 3 rows and its exact-top-k gate stay open; Phase 4 and 5 code does not depend on them. |
| Dense model | `BAAI/bge-small-en-v1.5` at revision `5c38ec7c`, 384 dimensions, CLS pooling, L2-normalized. Documents are `title + " " + body`, embedded without a prefix. Queries get the model's retrieval instruction, `Represent this sentence for searching relevant passages: `. |
| Document embeddings | `neural/embed.py` runs once per corpus on a GPU (Colab) in fp16 with sentence-transformers, in corpus line order, so row `i` is document `i` of the disk index. It records the corpus SHA-256 and the server refuses vectors built from another corpus. |
| Query embeddings | Online in Bun through `onnxruntime-node` 1.30.0 with the fp32 ONNX export of the same revision. The WordPiece tokenizer is Trace code that follows BERT's uncased rules. |
| Vector storage | int8 with one float32 scale per vector (absmax / 127), memory-mapped. Full MS MARCO is 3.4 GB of vectors, which fits under the 4 GiB typed-array limit. float32 would be 13.6 GB. |
| Exact search | Brute-force dot product over every int8 vector with a float32 query. Offline evaluation splits rows across one worker thread per logical core and processes queries in batches of 32 to keep them in cache. Its time is reported as offline throughput, never as serving latency. |
| ANN | usearch 2.26.3 HNSW, cosine on the stored int8 vectors, connectivity 16, `expansion_add` 128, `expansion_search` max(128, k + 1). ANN only proposes candidates; Trace re-scores them with the same int8 dot product, so its scores equal exact scores and only recall can differ. Recall is measured against the exact top 10, 100, and 1,000. |
| Fusion | Reciprocal rank fusion with k = 60 over BM25 and exact dense lists. Evaluation fuses top-1,000 lists; the server fuses top-100 lists. |
| BM25 input for hybrid rows | The Phase 1 top-1,000 runs that passed the Anserini gates (`artifacts/msmarco.run.trec`, `artifacts/cqadupstack-*.run.trec`). Self-matches stay excluded on CQADupStack for every retriever. |
| Reranker | `cross-encoder/ms-marco-MiniLM-L6-v2` at revision `233902d2`, `onnx/model_quint8_avx2.onnx`. This CPU has AVX2 and no AVX-512. Pairs are `[CLS] query [SEP] passage [SEP]`, at most 256 tokens, query capped at 64, passage truncated, batches of 32. |
| Rerank sweep | N in {10, 20, 50, 100} over the hybrid run. Quality uses every judged query; each query's top 100 is scored once and depth N reorders the first N. Latency is timed separately for each N on the first 500 judged queries after 20 warm-up queries. The sweep runs on MS MARCO dev and CQADupStack Android. The other 11 sites would add hours of CPU inference without changing the decision. |
| Choosing N | Declared before the sweep: the smallest N whose nDCG@10 is within 0.005 of the best N in the sweep. The plot shows P50 and P95 added latency next to quality so the choice can be checked by eye. |
| Server | `--vectors dir` turns on hybrid retrieval, `--dense exact|ann` picks the dense path, `--rerank N` turns on reranking, and `--models dir` locates both ONNX models. Reranking stays off by default until the sweep chooses N. |
