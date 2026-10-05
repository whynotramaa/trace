# Third-party code

`engine/porter.ts` ports Apache Lucene's `PorterStemmer.java` to TypeScript. `engine/bm25.ts` reimplements Lucene's length encoding and BM25 floating-point convention. The relevant source belongs to the Apache Software Foundation and uses the Apache License, Version 2.0, included in `LICENSES/Apache-2.0.txt`.

Upstream sources:

- [Lucene Porter stemmer](https://github.com/apache/lucene/blob/main/lucene/analysis/common/src/java/org/apache/lucene/analysis/en/PorterStemmer.java)
- [Lucene SmallFloat](https://github.com/apache/lucene/blob/main/lucene/core/src/java/org/apache/lucene/util/SmallFloat.java)
- [Lucene BM25Similarity](https://github.com/apache/lucene/blob/main/lucene/core/src/java/org/apache/lucene/search/similarities/BM25Similarity.java)

The inverted index, on-disk index format and builder, VByte and bitpacking codecs, exhaustive retrieval, MaxScore, Block-Max WAND, top-k heap, metrics, and query orchestration are Trace code. Parquet parsing uses `hyparquet` and `hyparquet-compressors`. The evaluator check runs `pytrec_eval`. These libraries are named separately from the retrieval engine.

The search interface uses React and React DOM under their MIT license, included in `LICENSES/React-MIT.txt`. They render results and evidence; they do not implement retrieval. The local production executable bundles their code and the Bun runtime.

The Phase 3 speed comparison in `bench/libraries.ts` runs MiniSearch 7.2.0 (MIT) and Orama 3.1.18 (Apache-2.0) as reference systems. They are benchmark subjects only and are not part of Trace's retrieval path.

Phases 4 and 5 use two models and two inference libraries. They are named here because Trace does not implement them:

- `BAAI/bge-small-en-v1.5` (MIT) embeds documents and queries.
- `cross-encoder/ms-marco-MiniLM-L6-v2` (Apache-2.0) reranks candidates.
- ONNX Runtime through `onnxruntime-node` 1.30.0 (MIT) runs both models in Bun.
- usearch 2.26.3 (Apache-2.0) builds and searches the HNSW graph.
- sentence-transformers and PyTorch run the offline GPU embedding job.

The WordPiece tokenizer, int8 vector store, exact dense search, reciprocal rank fusion, and evaluation code are Trace code.
