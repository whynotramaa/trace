# Index format

`engine/build.ts` writes one directory per corpus. Every file is a flat little-endian typed array, so `engine/disk.ts` opens it with `Bun.mmap` and wraps it in a typed-array view. Nothing is parsed or copied at startup except `meta.json`.

```sh
bun engine/build.ts --corpus data/normalized/msmarco.jsonl --out data/index/msmarco --k1 0.82 --b 0.68
```

Format version 1 supports the `anserini` analyzer with Lucene float scoring only. `k1` and `b` are fixed at build time because the block-max bounds depend on them. Exhaustive modes accept other values. MaxScore and BMW refuse them.

## Documents

Internal document IDs are 0 to N−1 in corpus order. Postings store these IDs.

| File | Type | Length | Contents |
| --- | --- | --- | --- |
| `docids.bin` | bytes | | UTF-8 external IDs, concatenated |
| `docids.u32` | u32 | N+1 | Byte offsets into `docids.bin` |
| `rank.u32` | u32 | N | Position of each document's external ID in sorted order. The top-k heap breaks score ties with it, so ties match `trec_eval` without comparing strings. |
| `byrank.u32` | u32 | N | Inverse of `rank.u32`. Binary search over it maps an external ID to an internal one. |
| `lengths.u32` | u32 | N | Analyzed token count |
| `norms.u8` | u8 | N | Lucene `SmallFloat` length byte. A query builds a 256-entry norm table from it. |
| `store.f64` | f64 | 2N | Start and end byte offsets of each document's line in the source JSONL. The server maps the corpus and parses one line per result. |

## Lexicon

Terms are sorted by UTF-8 bytes. A query term is found by binary search over the mapped bytes.

| File | Type | Length | Contents |
| --- | --- | --- | --- |
| `lexicon.bin` | bytes | | UTF-8 terms, concatenated |
| `lexicon.u32` | u32 | T+1 | Byte offsets into `lexicon.bin` |
| `df.u32` | u32 | T | Document frequency |

## Postings

All three layouts hold the same postings, in increasing document order, and score identically.

**Flat.** `flat.doc.u32` and `flat.tf.u16` hold every posting uncompressed. `flat.off.f64` (T+1) gives each term's first posting. Inspect's per-result ledger reads tf from this layout by binary search.

**VByte.** `vbyte.bin` holds, per posting, the document gap and then tf, each as a little-endian base-128 varint with a continuation bit. `vbyte.off.f64` (T+1) gives each term's byte offset.

**Blocks.** Each term's postings are cut into blocks of 128. The last block may be shorter.

| File | Type | Length | Contents |
| --- | --- | --- | --- |
| `block.words.u32` | u32 | | Bitpacked payload. Per block: 128 document gaps at one bit width, then 128 values of tf−1 at another. |
| `block.term.u32` | u32 | T+1 | Each term's first block |
| `block.off.u32` | u32 | B+1 | Each block's first word in the payload |
| `block.width.u8` | u8 | 2B | Gap width, then tf width |
| `block.last.u32` | u32 | B | Last document in the block. This is the skip data: a cursor passes blocks whose last document is below its target without decoding them. |
| `block.max.f32` | f32 | B | Largest BM25 saturation `tf · (1/norm)` in the block |
| `term.max.f32` | f32 | T | Largest saturation over the whole term |

A block's first gap is relative to the previous block's last document, or to 0 for a term's first block.

The bounds store saturation, not scores. A term's contribution is `w − w/(1 + x)` for query weight `w` and saturation `x`, and it never decreases as `x` grows. So one stored maximum yields an exact upper bound for any query weight, computed with the same float32 steps as the score itself.

## Exactness

MaxScore and BMW return the same top-k as exhaustive scoring, scores and tie order included:

- Scores add contributions in query-term order, as the exhaustive scorer does, whatever order the pruning visited them in.
- A document is skipped only when `fround(bound · (1 + 1e−12)) < threshold`. The float32 rounding matches the final score. The slack covers float64 sums taken in a different order. The comparison is strict, because a document that ties the threshold can still win on its document ID.

`bench/phase3.ts` writes a TREC run for every variant, and the Phase 3 exit check compares their SHA-256 hashes.
