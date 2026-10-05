# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript on Bun, as specified in TRACE.v2.md. Phase 2 uses React and Bun's native HTML bundler. React is an implementation choice; the brief does not name a frontend framework.

## Users

Developers search for technical sources. Engineers and interviewers inspect how the custom retrieval engine ranks those sources.

## Product purpose

Search technical knowledge and expose the actual retrieval pipeline. Search works without an LLM.

## Operating context

The first demo searches public Computer Science Stack Exchange posts and a bounded Stack Overflow question snapshot. A user searches, opens a source, then opens Inspect for the same query and compares term contributions across results.

## Capabilities and constraints

Phase 2 provides ranked results and a BM25 Inspect drawer with real timings, candidate counts, and per-term scores. TF, TF-IDF, and BM25 exist in the engine. Compression, pruning, neural retrieval, Compare, and Benchmarks are later phases. The user authorized Phase 2 implementation during full MS MARCO validation; both phases are now complete.

## Brand commitments

Trace. Search, from first principles. The supplied plan calls for a typographic wordmark, a prominent query field, near-monochrome surfaces, clear source identity, and complexity revealed through Inspect.

## Evidence on hand

The rebuilt product corpus contains 104,745 public posts with source URLs and attribution. All twelve CQADupStack quality checks and the full MS MARCO quality check pass their declared tolerances. MS MARCO covers 8,841,823 passages and 6,980 judged queries, separately from the product corpus. No UI may invent benchmark metrics, corpus scale, or scoring data.

## Product principles

Search comes first. Preserve source provenance. Show engine evidence. Publish measurements only after their complete input set has been evaluated.
