# Engineering log

Append-only. Each entry records a decision or a measured surprise, with the numbers behind it. Entries are never edited or deleted; a later entry corrects an earlier one. `docs/decisions.md` holds the current settled choices, and this file records how they were reached.

## 2026-10-05 · Phase 3 start: one index directory, three postings layouts

The builder writes flat, VByte, and 128-doc block postings into one directory in one run, and each benchmark mode maps only the files it needs. One build means every layout comes from the same analyzed corpus, so the steps differ only in layout. Each mode is benchmarked in its own process, because pages mapped by one mode would otherwise inflate the next mode's RSS.

## 2026-10-05 · Disk index is anserini-parity only

Format version 1 supports only the `anserini` analyzer with Lucene float scoring. The technical analyzer uses float64 scoring, where the saturation bound `w·x/(1+x)` and the score `w·tf/(tf+norm)` can round differently by one ulp, which would make the bound unsafe. Serving and every benchmark use the anserini analyzer, so the second path was not built.

## 2026-10-05 · Block-max bounds store saturation, not scores

Each block stores its largest `x = fround(tf · fround(1/norm))`. The contribution `fround(w − fround(w / fround(1 + x)))` is monotonic in `x`, so one stored float gives an exact bound for any query weight `w`, using the same float32 steps as scoring. Bounds still depend on `k1` and `b` through the norm, so MaxScore and BMW refuse parameters other than those used at build time.

## 2026-10-05 · Exact pruning rules

- Score sums run in query-term order regardless of visit order, so pruned scores are bit-identical to exhaustive ones.
- A document is skipped only if `fround(bound · (1 + 1e−12)) < threshold`. Comparing after float32 rounding matters: an unrounded bound below the threshold can still round up to equal it. The comparison is strict because a tied score can still win on document ID.
- Score ties use a precomputed rank of each external document ID (`rank.u32`), which reproduces `trec_eval` tie order without string comparisons in the heap.

## 2026-10-05 · First equivalence result: CQADupStack Android

All five disk modes (flat, VByte, block, MaxScore, BMW) produced a top-1,000 TREC run with SHA-256 `016edee9…d4d373`, byte-identical to the Phase 1 heap-index run on all 699 queries. At k=10, all three exhaustive and pruned modes tested agree (run `23aef3c2…f09f`).

Warm k=10 latency on Android, 699 queries × 3: flat P50 0.71 ms, MaxScore 0.22 ms, BMW 0.49 ms. BMW scored 1,261 postings per query on average against MaxScore's 3,083, yet ran slower. Its per-iteration work (re-sorting cursors, shallow block lookups, advancing one cursor at a time) costs more than it saves on a 23k-document corpus with long title queries. MS MARCO will show whether that holds at scale.

## 2026-10-05 · Pruning changes what "total hits" means

With MaxScore or BMW, the engine does not know how many documents match, only how many it scored. The API field `total_hits` became `docs_scored`, and the UI now says "posts scored" instead of "matching posts". Reporting the scored count as a match count would have been false.

## 2026-10-05 · Build memory: about 1 GiB of RSS per million MS MARCO passages

The single-pass builder keeps every (term, tf) pair in chunked `Uint32Array` columns, then counting-sorts them into term order. That avoids analyzing the 8.8M-passage corpus twice; analysis alone took 22.5 minutes in the Phase 1 run.

The first full build reached 4.31 GiB RSS at 4M passages, about 1.1 GiB per million, which projects past this machine's 16 GB. The build was stopped and rerun with `Bun.gc(true)` every 500k documents. The curve did not change: 0.77 GiB at 500k, 1.31 GiB at 1M, 1.70 GiB at 1.5M. So the growth is live data, not uncollected garbage. Likely holders are the per-document ID strings, the duplicate-ID `Set`, the `store` offsets as a plain `number[]`, the vocabulary `Map`, and the pair columns. The rerun continues under watch.

## 2026-10-05 · Segmented parallel build replaces the single-pass build

The rerun reached 5.05 GiB RSS at 4.5M passages with only 4 GiB free on the machine, so it was stopped before it could swap. RSS kept climbing at about 1 GiB per million passages after forced collection. The estimated live data (pair columns at roughly 30 unique terms per passage, IDs, the ID `Set`, offsets, vocabulary) is under 0.4 GiB per million. The rest is most likely allocator memory the runtime does not return to the OS, such as ICU segmenter and string churn from analysis. Tuning that in-process was not worth the risk.

The builder now cuts the corpus into byte ranges of about 256 MiB at line boundaries. A child process analyzes each range into a term-sorted segment that has the same file layout as the index (lexicon, flat postings, doc table) and exits, which returns all of its memory to the OS. The parent then runs a k-way merge by term over the memory-mapped segments, rebases document IDs, and streams flat, VByte, and block postings to disk term by term. Duplicate IDs are now caught by checking adjacent entries in the sorted-ID array the tie ranks already need, so the separate `Set` is gone.

This also parallelizes analysis, the dominant cost (4 workers by default). Equivalence check: Android built with 1 segment, with 3 segments, and with the earlier single-pass builder gives byte-identical files for all 22 data files.

The corpus hash in `meta.json` is now the SHA-256 of the file bytes, computed in parallel with segmenting, not a hash of re-joined lines.

## 2026-10-05 · The corpus is read with pread, not mmap

`Bun.mmap` aborts the process (SIGABRT, no JavaScript error) on the 4,688,525,378-byte MS MARCO JSONL. The same call maps the 1,065,107,996-byte `flat.doc.u32` without trouble, so the limit is file size, likely the 4 GiB typed-array ceiling. The document store is only touched for the k results a query returns, so `DiskIndex.document` now reads one line with `readSync` at its stored offset. Every index file stays memory-mapped. The largest, `flat.doc.u32` at about 1 GiB, is well under the limit. A corpus of about 4× MS MARCO would need flat postings split across files.

## 2026-10-05 · MS MARCO index: first numbers

Segmented build of all 8,841,823 passages: 18 segments, 4 in parallel, 222 s of segment analysis, 265 s total, 4.72 GB peak sampled RSS (the merge, not the segments). That covers 2,641,138 terms, 266,276,999 postings, 4,627,010 blocks, and 2.98 GiB on disk across every layout.

Postings bytes by layout: flat 1,597,661,994 (4-byte doc plus 2-byte tf), VByte 629,253,060 (2.5× smaller), bitpacked blocks 442,058,804 payload plus 74,778,148 of block metadata and bounds (3.1× smaller than flat including metadata).

A 200-query probe at k=10 returned identical runs from all five modes. Warm P50: flat 22.2 ms, VByte 23.0 ms, block 26.5 ms, MaxScore 3.1 ms, BMW 2.9 ms. Decoding VByte costs about nothing next to flat, because the exhaustive scorer, not memory traffic, dominates. Block decoding without pruning is slower, since each block is unpacked in full before its first posting is used.

## 2026-10-05 · Heap baseline runs on a 1M-passage prefix

The Phase 1 heap index (JS objects and Maps, documents held in memory) cannot hold 8.8M passages on this 16 GB machine; that is why Phase 1 needed the batched offline evaluator. Step 1 is therefore measured on the first 1,000,000 MS MARCO passages, against the flat mapped index built from the same prefix. Full-corpus rows cover only the disk layouts. Not fitting is the finding for the heap index at full scale.

## 2026-10-05 · Benchmark runtime and the serving default

A full exhaustive pass over the 6,980 MS MARCO dev queries takes about 4.5 minutes. With one cold pass, a 100-query warm-up, and 3 warm passes, each exhaustive mode takes about 19 minutes per k. The whole `bench/phase3.sh` sequence takes about 2.5 hours. It runs in the background while code continues. Only writing code happens alongside it. Builds and tests wait, so they do not perturb the latency numbers.

The server defaults to `--mode maxscore`. On the 200-query probe, MaxScore and BMW are close at P50 (3.1 ms against 2.9 ms), and MaxScore had the lower P99 (26.0 ms against 39.8 ms). The full runs decide the final default, and this entry gets a follow-up if they disagree.

## 2026-10-05 · Phases 4 and 5 start before the Phase 3 gate

The user asked for Phases 4 and 5 while `bench/phase3.sh` still runs. The spec says not to start a phase before the previous exit criterion. Writing code does not disturb the benchmark, and nothing new depends on Phase 3 numbers, so the code went in now and every new run waits until the benchmark finishes. The Phase 3 rows and gate remain open.

## 2026-10-05 · Dense vectors are int8 with a per-vector scale

float32 vectors for 8,841,823 passages at 384 dimensions take 13.6 GB, more than this machine can map alongside the BM25 index. int8 takes 3.4 GB and stays under the 4 GiB typed-array limit that already forced the corpus onto `pread`. Each vector keeps one float32 scale (absmax / 127), so a score is `scale · Σ q·v` with the query left in float32. Per-vector scaling uses the full int8 range; a single global scale would waste most of it, since a unit vector's components in 384 dimensions are mostly under 0.2.

## 2026-10-05 · ANN proposes, the exact scorer decides

usearch builds HNSW over the same int8 vectors. Its cosine distance normalizes by the quantized norm, so it can differ slightly from Trace's scaled dot product. ANN results are re-scored with the exact scorer before ranking. ANN and exact scores for the same document are then identical, and the only thing ANN can lose is recall, which is what the experiment measures.

## 2026-10-05 · The tokenizer is written, not imported

Both models use the BERT uncased vocabulary. A dependency such as transformers.js would bring its own ONNX runtime copy and a large install for about 40 lines of WordPiece: clean control characters, space out CJK, strip accents with NFD, lowercase, split on whitespace and punctuation, then greedy longest-match subwords with `##` continuations. It is short enough to defend line by line. Queries are short, so query-side truncation differences from Hugging Face's `longest_first` rule do not arise; the reranker truncates only the passage.

## 2026-10-05 · The reranker model file matches the CPU

The MiniLM repository ships several int8 exports tuned for different instruction sets. The i5-12450H has AVX2 and AVX-VNNI but no AVX-512, so the sweep uses `model_quint8_avx2.onnx`. The earlier Bun compatibility check measured about 140 ms for 32 pairs of 128 tokens. Pairs here may run to 256 tokens, so expect the sweep's latency per N to be higher than that check.
