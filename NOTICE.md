# Third-party code

`engine/porter.ts` ports Apache Lucene's `PorterStemmer.java` to TypeScript. `engine/bm25.ts` reimplements Lucene's length encoding and BM25 floating-point convention. The relevant source belongs to the Apache Software Foundation and uses the Apache License, Version 2.0, included in `LICENSES/Apache-2.0.txt`.

Upstream sources:

- [Lucene Porter stemmer](https://github.com/apache/lucene/blob/main/lucene/analysis/common/src/java/org/apache/lucene/analysis/en/PorterStemmer.java)
- [Lucene SmallFloat](https://github.com/apache/lucene/blob/main/lucene/core/src/java/org/apache/lucene/util/SmallFloat.java)
- [Lucene BM25Similarity](https://github.com/apache/lucene/blob/main/lucene/core/src/java/org/apache/lucene/search/similarities/BM25Similarity.java)

The inverted index, exhaustive retrieval, top-k heap, metrics, and query orchestration are Trace code. Parquet parsing uses `hyparquet` and `hyparquet-compressors`. The evaluator check runs `pytrec_eval`. These libraries are named separately from the retrieval engine.
