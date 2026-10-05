# Trace

Trace implements technical search in TypeScript on Bun. The retrieval core contains an analyzer, TF, TF-IDF, and BM25, an in-memory inverted index, a memory-mapped on-disk index with flat, VByte, and bitpacked block postings, and exact MaxScore and Block-Max WAND pruning. The evaluator reports MRR@10, nDCG@10, Recall@100, and Recall@1000.

The build follows [TRACE.v2.md](TRACE.v2.md). [checklist.md](checklist.md) tracks implementation and phase exit gates. [docs/experiments.md](docs/experiments.md) records measured results and their limits. Neural retrieval belongs to a later phase. [docs/index-format.md](docs/index-format.md) describes the on-disk layout. [docs/engineering-log.md](docs/engineering-log.md) is an append-only record of engineering decisions and measured surprises.

## Check the implementation

Use Bun 1.3.14 and install the locked dependencies:

```sh
bun install --frozen-lockfile
bun test
bun run check
```

Phase 0's evaluator matches `pytrec_eval` on the published Anserini TREC-COVID run. All 12 CQADupStack sites pass their declared quality tolerances. Full MS MARCO validation also passes its declared MRR@10 tolerance, completing the Phase 1 quality gate.

## Search the product corpus

After importing the product corpus below, start the local search page:

```sh
bun start
```

Open <http://localhost:3000>. On first start, the server builds a disk index of the product corpus in `data/index/product`. Later starts map the existing files and accept requests at once. To serve another corpus, build its index first and pass `--index <directory>`. Search returns ten ranked posts with source links, excerpts, and attribution. Inspect shows the same query's engine timings, candidate and postings counts, and each result's per-term BM25 ledger. Display timings describe that request; they are not benchmark latency claims.

Use `bun dev` for hot reload, or `bun run build` followed by `./dist/trace` for a standalone executable with bundled web assets. Both accept these options:

- `--index <directory>` and `--corpus <normalized.jsonl>` choose the index, and the corpus used to build it if the index is missing.
- `--mode maxscore|bmw|flat|vbyte|block` chooses the retrieval algorithm. The default is `maxscore`.
- `--workers <n>` starts n server processes that share one port through `SO_REUSEPORT` and map the same index files.
- `--trace off` disables query traces, as benchmark runs do.
- `--port <number>` sets the port.

The server binds to loopback by default. With several workers, traces are written to a temporary directory so any worker can answer `GET /trace/<query_id>`.

The JSON API exposes `GET /metadata`, `GET /search?q=<query>&k=10` (1–20 results), and `GET /trace/<query_id>`. Search reports `docs_scored`, not a match count, because pruning stops before it finds every match. Query traces expire after five minutes; at most 128 are retained. API responses use `Cache-Control: no-store`.

## Rebuild a benchmark corpus

Download and import all CQADupStack sites:

```sh
bun eval/fetch.ts --dataset cqadupstack --out data/raw
mkdir -p data/normalized
for site in android english gaming gis mathematica physics programmers stats tex unix webmasters wordpress; do
	bun eval/import.ts --format beir --input data/raw/cqadupstack/$site/corpus.jsonl --source cqadupstack-$site --out data/normalized/cqadupstack-$site.jsonl
done
bun eval/references.ts
```

Run one full site comparison:

```sh
bun eval/run.ts --corpus data/normalized/cqadupstack-android.jsonl --queries data/raw/cqadupstack/android/queries.jsonl --qrels data/raw/cqadupstack/android/qrels.txt --dataset cqadupstack-android --reference data/reference/cqadupstack-android.json --out artifacts/phase1/cqadupstack-android
```

Download, extract, and import the full MS MARCO collection:

```sh
bun eval/fetch.ts --dataset msmarco --out data/raw/msmarco
tar -xzf data/raw/msmarco/collectionandqueries.tar.gz -C data/raw/msmarco collection.tsv
bun eval/import.ts --format msmarco --input data/raw/msmarco/collection.tsv --out data/normalized/msmarco.jsonl
bun eval/batched.ts --corpus data/normalized/msmarco.jsonl --queries data/raw/msmarco/topics.msmarco-passage.dev-subset.tsv --qrels data/raw/msmarco/qrels.msmarco-passage.dev-subset.txt --dataset msmarco --k1 0.82 --b 0.68 --reference data/reference/msmarco.json --batch-size 100000 --out artifacts/msmarco
```

The batch evaluator uses full-corpus BM25 statistics, scores all matching documents, and merges batch top-k results. Its complete Android run is byte-for-byte identical to the whole-index run. Batch elapsed times are offline measurements, not serving latency.

Importers write source hashes, content checksums, document counts, and licensing metadata beside each corpus. Data and experiment artifacts stay outside Git. Public benchmark downloads require `curl`; MS MARCO extraction requires `tar`.

## Rebuild the product corpus

The local product snapshot contains 104,645 Computer Science Stack Exchange posts and 100 public Stack Overflow questions. Source URLs, author attribution, and contribution licenses remain in the normalized records. Duplicate-question labels are kept separately from document text.

Download the public Computer Science dump and a bounded [Stack Overflow API question snapshot](https://api.stackexchange.com/docs/questions), then import them:

```sh
bun eval/fetch.ts --dataset product --out data/raw
mkdir -p data/raw/cs data/normalized
bsdtar -xf data/raw/cs.stackexchange.com.7z -C data/raw/cs Posts.xml PostLinks.xml
bun eval/product.ts --posts data/raw/cs/Posts.xml --links data/raw/cs/PostLinks.xml --stackoverflow data/raw/stackoverflow-questions.json --out data/normalized/product.jsonl
```

`bsdtar` comes from libarchive. The API response is cached on disk. A new API snapshot can contain changed posts, so compare the generated manifest hashes when reproducing a previous run. This product corpus is distinct from the 8,841,823-passage scale benchmark.

## Reproduce the Phase 3 performance rows

Build the full MS MARCO index. Analysis runs in 4 parallel processes, one per 256 MiB corpus segment:

```sh
bun engine/build.ts --corpus data/normalized/msmarco.jsonl --out data/index/msmarco --k1 0.82 --b 0.68
bun engine/build.ts --corpus data/normalized/cqadupstack-android.jsonl --out data/index/android
head -n 1000000 data/normalized/msmarco.jsonl > data/normalized/msmarco-1m.jsonl
```

Then run every benchmark and print the tables:

```sh
./bench/phase3.sh
./bench/serve.sh
bun bench/phase3-report.ts
```

`bench/serve.sh` starts the server on full MS MARCO with 1 worker, then with one worker per logical core, and drives each with 64 concurrent connections for 30 seconds. The load generator runs on the same machine, so it competes with the server for cores.

The report writes `artifacts/phase3/gate.json`. It passes when every mode returns a TREC run byte-identical to the exhaustive flat run, and when the full MS MARCO top-1,000 run equals the Phase 1 run. Close other heavy processes first, because latency numbers are only comparable on an otherwise idle machine.

## Reproduce the Phase 4 and 5 rows

Download the two pinned ONNX models:

```sh
bun eval/fetch.ts --dataset models
```

Document embeddings need a GPU. On Colab, upload a normalized corpus and `neural/embed.py`, then run:

```sh
pip install sentence-transformers
python embed.py --corpus msmarco.jsonl --out msmarco
```

Copy the output directory to `data/dense/msmarco`, and likewise `data/dense/cqadupstack-<site>` for each site. Each directory holds `vectors.i8`, `scales.f32`, `ids.txt`, and `dense.json`. Then build the HNSW indexes and run every row:

```sh
./eval/neural.sh
```

That writes dense, ANN, BM25, and hybrid runs and metrics to `artifacts/phase4/`, and the rerank sweep with its plot to `artifacts/phase5/`. To serve hybrid search with reranking:

```sh
bun server/index.ts --vectors data/dense/product --dense exact --rerank 20
```

`--rerank` is off by default until the sweep picks N.

## Read the engine

| Path | Purpose |
| --- | --- |
| `engine/analyzer.ts` | Anserini parity mode and a separate technical-token policy |
| `engine/index.ts` | In-memory heap index, exhaustive DAAT retrieval, and score evidence. The Phase 3 baseline. |
| `engine/build.ts` | Segmented, parallel builder for the on-disk index |
| `engine/disk.ts` | Memory-mapped index, postings cursors, exhaustive DAAT, MaxScore, and Block-Max WAND |
| `engine/codec.ts` | VByte and bitpacking |
| `engine/bm25.ts` | BM25 components and Lucene length and float conventions |
| `engine/heap.ts` | Bounded top-k ranking with deterministic ties |
| `eval/` | Acquisition, importers, metrics, and reference checks |
| `bench/environment.ts` | Input and source hashes, runtime, and hardware metadata |
| `bench/phase3.ts` | Latency, counters, memory, and TREC runs for one index layout and mode |
| `bench/phase3.sh` | Every Phase 3 run in order |
| `bench/serve.sh` | QPS with 1 worker and with one worker per core |
| `bench/phase3-report.ts` | Experiment tables and the exact-top-k gate from `artifacts/phase3` |
| `bench/load.ts` | HTTP load generator for QPS at a declared concurrency |
| `bench/libraries.ts` | MiniSearch and Orama on the same queries and corpora |
| `engine/dense.ts` | int8 vector store, exact search, HNSW build and search through usearch, RRF |
| `neural/embed.py` | Offline GPU document embeddings |
| `server/neural.ts` | WordPiece tokenizer, ONNX query embedder, and cross-encoder reranker |
| `eval/dense.ts` | Dense, ANN, and hybrid runs, metrics, and ANN recall against exact search |
| `eval/rerank.ts` | Rerank depth sweep, quality against added latency, and its plot |
| `server/` | Bun HTTP entry point, search API, and bounded query traces |
| `web/` | React search results and engine-backed Inspect panel |

The parity analyzer uses Bun's ICU segmentation, which can differ from Lucene on Unicode boundaries. Quality comparisons use predeclared tolerances, not a claim that every Lucene token or score is identical. [docs/decisions.md](docs/decisions.md) records the policies. [NOTICE.md](NOTICE.md) attributes the Lucene-derived code and names external libraries.
