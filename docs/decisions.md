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
| Phase ordering | A passed evaluator check permits Phase 1. Phase 2 starts only after Phase 1's full reference-quality gate passes. A unit test or subset run cannot substitute for that gate. |

The [Anserini analyzer source](https://github.com/castorini/anserini/blob/master/src/main/java/io/anserini/analysis/DefaultEnglishAnalyzer.java) defines parity tokenization. The [MS MARCO reproduction instructions](https://github.com/castorini/pyserini/blob/master/docs/experiments-msmarco-passage.md) define the passage collection and tuned BM25 baseline. The [CQADupStack Android regression](https://github.com/castorini/anserini/blob/master/docs/reproduce/from-document-collection/beir-v1.0.0-cqadupstack-android.flat.md) defines flat indexing and self-query removal.

Public ingestion uses the [Stack Exchange archive](https://archive.org/details/stackexchange) and the [Stack Exchange API](https://api.stackexchange.com/docs/questions). The [dump access announcement](https://meta.stackexchange.com/questions/401324/announcing-a-change-to-the-data-dump-process) describes the current access process. No signed-in dump account is used. Attribution and the source contribution's license remain part of every imported post.
