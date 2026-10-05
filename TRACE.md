TRACE
# Search, from first principles.
*Product + Engineering Specification*
*A high-performance, inspectable technical-knowledge search engine built to make retrieval quality, latency, and ranking decisions visible.*

> NORTH STAR  Trace should be impressive before anyone learns that an LLM is involved. Search is the product; retrieval is the engineering story; inspection and measurement make the work demonstrable.

| Project | Decision |
| --- | --- |
| Primary product | Search engine for technical knowledge |
| Primary corpus | Technical documentation, engineering writing, papers/abstracts, selected repositories and structured technical datasets |
| Core differentiator | From-scratch retrieval stack + visible ranking pipeline + rigorous evaluation |
| Flagship modes | Search, Inspect, Compare, Benchmarks; Explore is a later layer |
| Interview thesis | Own the complete path from text → index → candidate generation → ranking → performance → evaluation |

<sub>Status: build specification • Name locked: Trace</sub>

## 1. Executive summary
Trace is a search engine whose intellectual core is information retrieval rather than answer generation. It begins with a classical inverted index and BM25, then becomes a performance-engineered retrieval system, and finally adds dense retrieval and neural reranking. The product deliberately exposes the internals so that users—and interviewers—can see why a document ranked, how candidates moved through the pipeline, and what each optimization changed.
### What Trace must prove
- Correctness: tokenization, indexing, scoring and ranking behave predictably and can be tested.
- Speed: the engine can retrieve and rank from a meaningful corpus under a defensible latency budget.
- Quality: ranking changes are evaluated with relevance metrics, not judged by cherry-picked queries.
- Systems depth: index layout, memory mapping, compression, pruning and concurrency are treated as engineering problems.
- ML depth: dense retrieval and cross-encoder reranking are added because they improve retrieval quality, not because the project needs an AI label.
- Product quality: a polished search surface and visual engine inspector make the system understandable in seconds.
### Non-goals
- Building a general-purpose Google competitor or crawling the entire public web.
- Making a chatbot/RAG interface the primary product.
- Fabricating benchmark numbers, relevance labels, scale claims or latency figures.
- Using Elasticsearch/OpenSearch/Lucene as the core engine and merely wrapping it with a UI.
- Adding features whose only purpose is résumé keyword density.
- Optimizing prematurely before a correct, measurable baseline exists.
> PORTFOLIO ROLE  Trace should complement OCTLM rather than duplicate it: OCTLM demonstrates LLM internals; Trace demonstrates retrieval, algorithms, systems performance, evaluation and practical neural IR.

## 2. Product principles and constraints
| Principle | Implication |
| --- | --- |
| Retrieval first | Every major feature should improve retrieval, explain retrieval, or measure retrieval. |
| Own the core | Tokenizer, postings, scoring, retrieval pipeline and benchmark harness are ours. |
| Measure before optimizing | Every optimization gets before/after quality, latency and memory evidence. |
| Simple outside, deep inside | Default UI is a calm search product; complexity appears only when Inspect is opened. |
| Progressive sophistication | Classical IR → performance → neural retrieval. Each stage remains independently demoable. |
| Real provenance | Result and Explore surfaces preserve source URLs/identities and evidence boundaries. |
| Controlled corpus | Start with datasets that are legal, reproducible and evaluable; crawling is optional ingestion, not the project. |
| No magic metrics | Only publish measurements produced by repeatable benchmark scripts. |

### Hard constraints
- Search must work without an LLM.
- BM25 baseline must exist before dense retrieval.
- Evaluation set and benchmark harness must exist before claiming one ranking strategy is better.
- Inspect mode must use actual scores/stages from the engine, not reconstructed UI estimates.
- Search results must return source metadata and stable document identifiers.
- Engine and UI must support reproducible demo queries.
- Architecture should remain understandable enough to explain on a whiteboard in 10–15 minutes.
## 3. Users and core journeys
| User | Goal | Trace experience |
| --- | --- | --- |
| Developer | Find the most relevant technical source quickly | Search → scan ranked sources → filter → open source |
| Learner | Understand a technical topic through authoritative sources | Search → inspect snippets → Explore later |
| Engineer/interviewer | Understand how the engine works | Inspect query → see candidates/scores/stages → compare strategies |
| Builder | Measure whether an optimization helped | Benchmark dashboard → compare runs → inspect regressions |

### Primary journey: Search
1. Enter a technical query.
1. Trace normalizes/tokenizes the query.
1. Classical and/or dense candidate generators retrieve candidates.
1. Fusion produces a bounded candidate pool.
1. Optional cross-encoder reranks the final candidates.
1. UI renders ranked sources with title, snippet, source, metadata and timing.
1. User can open Inspect without changing the query.
### Secondary journey: Inspect ranking
1. Open Inspect for the current query.
1. See the pipeline as stages with counts and latency.
1. Select any result.
1. See term matches, IDF contributions, BM25 components, dense similarity, fusion contribution and reranker score where applicable.
1. Compare its score breakdown against a nearby result.
1. Switch ranking strategy and observe both result-order and metric/latency changes.
## 4. Feature scope
### 4.1 Search surface — V1
- Fast query input with keyboard-first interaction.
- Ranked source results: title, canonical source, concise matched snippet, document type and relevant metadata.
- Query time and result count shown subtly, not as dashboard clutter.
- Filters appropriate to corpus: source family, content type, date where trustworthy, repository/domain where applicable.
- Stable deep links for query + selected ranking mode so demos are reproducible.
- Empty-state and zero-result handling with spelling/token hints where possible.
### 4.2 Inspect / Engine mode — flagship feature
- Pipeline visualization: tokenize → candidate generation → fusion → rerank → final results.
- Stage-level latency and candidate counts.
- Per-result scoring ledger: BM25, matched terms, term frequency, IDF, field/length effects, dense similarity, fusion score, cross-encoder score.
- Postings inspector for selected query terms: document frequency, posting count and compressed size.
- Candidate-set overlap view for sparse vs dense retrieval.
- Rank movement: e.g. sparse rank 31 → hybrid rank 8 → reranked rank 2.
- Toggle between a human-readable explanation and raw numeric details.
### 4.3 Compare mode
| Strategy | Purpose |
| --- | --- |
| TF / simple baseline | Demonstrate why naive term frequency is insufficient. |
| TF-IDF | Introduce corpus rarity and stronger lexical ranking. |
| BM25 | Primary sparse baseline. |
| BM25 + pruning | Demonstrate performance optimization while preserving/quantifying quality. |
| Dense bi-encoder | Handle semantic/vocabulary mismatch. |
| Hybrid | Combine lexical precision and semantic recall. |
| Hybrid + cross-encoder | High-quality final-stage ranking. |

Compare mode should show side-by-side top results, rank movement, overlap, latency and—when relevance labels exist—MRR/nDCG/Recall changes. It is a diagnostic surface, not a marketing chart.
### 4.4 Benchmark dashboard
- Corpus: documents, tokens, unique terms, postings, raw corpus bytes, index bytes, compressed bytes.
- Latency: P50/P95/P99 end-to-end plus stage-level distributions.
- Throughput: QPS under a declared benchmark setup.
- Memory: resident memory / mapped index footprint where measurable.
- Quality: MRR@10, nDCG@10, Recall@K; dataset and query count always displayed.
- Experiment comparison: baseline vs current build with deltas and commit/config identifier.
- Hardware/environment metadata so numbers remain interpretable.
### 4.5 Explore — later, deliberately separated
Explore can create a temporary topic page from documents Trace retrieved. It is not the default search experience and should arrive only after retrieval quality is credible.
- Topic overview assembled from retrieved evidence.
- Sections such as overview, mechanisms, evolution, primary sources and related concepts.
- Sentence/section-level provenance: clicking evidence reveals the supporting retrieved passages.
- Source-first behavior: synthesis must never hide the underlying documents.
- Prefer deterministic retrieval and citation boundaries over conversational theatrics.
## 5. System architecture
```text
┌──────────── INGESTION ────────────┐
Sources → parse → normalize → metadata → doc store   │
                 └──────────────┬────────────────────┘
                                ↓
                   tokenize / analyze fields
                                ↓
                ┌──────── INDEX BUILD ────────┐
                │ lexicon + postings + stats │
                │ doc metadata + forward data│
                └──────────────┬──────────────┘
                               ↓
Query → tokenize → sparse retrieval ─┐
                   dense retrieval ──┼→ fusion → top-N → cross-encoder → results
                                     │
                                     └→ trace events → Inspect / benchmarks
```

### 5.1 Components
| Component | Responsibility |
| --- | --- |
| Ingestion | Acquire permitted corpus, parse formats, canonicalize metadata, assign stable IDs. |
| Analyzer | Normalize text, tokenize, optional stemming/stop-word policy, field-aware token streams. |
| Indexer | Build lexicon, postings, term/document statistics and persistent index segments. |
| Sparse retriever | BM25 and classical baselines; top-k candidate retrieval. |
| Dense retriever | Embedding generation, vector index/search and semantic candidates. |
| Fusion | Combine sparse/dense candidate rankings or normalized scores. |
| Reranker | Cross-encoder scores bounded top-N candidates. |
| Query service | Own request lifecycle, timeouts, strategy selection and response contract. |
| Trace recorder | Capture per-stage timing, counts and score evidence for Inspect. |
| Evaluator | Offline relevance evaluation and experiment comparison. |
| Web client | Search, Inspect, Compare and Benchmark interfaces. |

## 6. Classical information retrieval core
### 6.1 Tokenizer/analyzer
- Unicode-aware normalization with a documented policy.
- Case folding and punctuation handling.
- Technical token policy: preserve meaningful constructs such as C++, C#, snake_case, camelCase boundaries, version strings and package identifiers where useful.
- Optional field-specific analyzers for titles, body, headings, code identifiers and tags.
- Tokenizer tests with a golden corpus of edge cases.
### 6.2 Inverted index
The foundational structure maps each term to a postings list. A posting minimally contains a document identifier and term frequency; positions can be added if phrase/proximity search is implemented.
```text
term: "attention"
df: 18,420
postings:
  [doc_17, tf=8] [doc_91, tf=3] [doc_144, tf=11] ...

document stats:
  doc_17.length = 2,143
  corpus.avgdl  = 1,028.7
```

- Lexicon maps terms to posting offsets/metadata.
- Document table stores length, source metadata and offsets needed to fetch snippets/content.
- Index build is deterministic for the same corpus/config.
- Index version records analyzer and format versions to prevent incompatible reads.
### 6.3 Ranking progression
| Stage | Question it teaches |
| --- | --- |
| Term frequency | Why isn't counting matches enough? |
| TF-IDF | Why should rare terms contribute more? |
| BM25 | How do saturation and document length normalization improve ranking? |
| Pruned BM25 | How can we avoid fully scoring obviously noncompetitive documents? |

BM25 should expose its parameters (k1, b) in benchmark configuration and Inspect. Parameter tuning must be evaluated, not hand-picked from a few queries.
## 7. Performance engineering
Performance work is a first-class chapter of Trace, not cleanup after the search engine works. Each technique needs a baseline, implementation, benchmark and explanation of the trade-off.
### 7.1 Memory-mapped index
- Persist index structures in a layout that can be read without loading the entire index into application heap.
- Use memory mapping where appropriate so the OS page cache participates in index access.
- Measure cold vs warm behavior separately when possible.
- Document file layout and offsets so the format is explainable.
### 7.2 Dynamic pruning / MaxScore
- Maintain term-level upper bounds needed for safe or controlled pruning.
- Skip documents/candidates that cannot enter the current top-k.
- Measure number of scored candidates and postings visited, not only wall-clock latency.
- Verify ranking equivalence for exact pruning variants; quantify quality loss for approximate variants.
### 7.3 Compression
| Technique | Use |
| --- | --- |
| Delta encoding | Store gaps between increasing document IDs rather than absolute IDs. |
| Bit packing | Use the minimum practical bit width for integer blocks. |
| Quantization | Reduce numeric representation where accuracy/quality impact is acceptable. |
| Block metadata | Enable skipping/decompression in bounded chunks. |

### 7.4 Benchmark discipline
- Warm-up phase before timed measurements.
- Fixed query set and declared concurrency.
- Multiple runs; report distributions rather than a single best number.
- Separate index-build time from query latency.
- Record machine, CPU, RAM, OS, runtime/compiler, corpus version and index config.
- Benchmark scripts checked into the repository and runnable by another engineer.
## 8. Neural and hybrid retrieval
### 8.1 Dense bi-encoder retrieval
A bi-encoder embeds documents offline and the query online into the same vector space. It addresses vocabulary mismatch and semantic similarity that lexical matching can miss.
- Precompute document embeddings as part of an explicit indexing pipeline.
- Keep embedding model/version in index metadata.
- Use an ANN/vector structure only after the correctness path is understood.
- Measure dense-only Recall@K and latency before hybridizing.
### 8.2 Hybrid retrieval
```text
BM25 top-K ──────┐
                 ├─→ fusion → bounded candidate set
Dense top-K ─────┘
```

- Start with Reciprocal Rank Fusion (RRF) or another easily explainable fusion baseline.
- Later test normalized score fusion only if score calibration is defensible.
- Inspect mode must show which retriever contributed each candidate.
- Measure candidate overlap and incremental recall gained by dense retrieval.
### 8.3 Cross-encoder reranking
- Apply only to a bounded top-N candidate set due to inference cost.
- Record pre-rerank and post-rerank positions.
- Batch inference where possible.
- Measure quality gain against added latency.
- Expose reranking as an optional strategy so the trade-off is visible in Compare mode.
## 9. Evaluation strategy
Evaluation is what separates Trace from a visually impressive search demo. Every ranking change should answer two questions: did relevance improve, and what did it cost?
| Metric | Meaning |
| --- | --- |
| MRR@10 | How early does the first relevant result appear? |
| nDCG@10 | How good is the ordering when relevance can be graded? |
| Recall@K | Did candidate generation retrieve the relevant documents at all? |
| P50/P95/P99 | What is typical and tail latency? |
| QPS | How much query load can the engine sustain under declared conditions? |
| Index size / RSS | What memory/storage cost accompanies the design? |

### Datasets
- BEIR: use appropriate public retrieval datasets for zero-shot evaluation and comparable IR metrics.
- A curated technical corpus: create a small judged query set for the actual Trace product domain.
- Do not conflate BEIR scores with the product corpus. Display dataset names next to every quality number.
- Store relevance judgments and evaluation configuration under version control.
### Regression gates
- Golden query tests for obvious ranking behavior.
- Index serialization/deserialization consistency.
- Quality regression threshold on the fixed evaluation set.
- Latency regression threshold in controlled benchmark runs.
- Tokenizer/index-format compatibility tests.
## 10. Corpus and ingestion
### Recommended first corpus
- Official technical documentation with clear licensing/access rules.
- Engineering blogs and articles from a curated allowlist.
- Paper metadata/abstracts from permitted datasets.
- Selected repository documentation/READMEs rather than arbitrary source-code crawling at first.
- Structured public technical QA datasets where redistribution/use is allowed.
### Document model
| Field | Notes |
| --- | --- |
| doc_id | Stable internal identifier. |
| canonical_uri | Canonical source identity. |
| title | Highest-value display and ranking field. |
| body | Primary searchable text. |
| headings | Optional separately weighted field. |
| source | Domain/provider/repository family. |
| content_type | docs, paper, blog, README, Q&A, etc. |
| published_at | Only when reliable. |
| ingested_at | Operational metadata. |
| checksum | Deduplication/change detection. |

### Ingestion constraints
- Deduplicate canonical and near-identical content where practical.
- Keep extraction separate from indexing so the index can be rebuilt reproducibly.
- Respect robots/access/licensing constraints for any crawler added later.
- Store enough metadata to explain source provenance in the UI.
- Do not let crawler complexity dominate the project; controlled dataset import is acceptable and often preferable.
## 11. Query API and traceability
### Search response
```text
GET /search?q=flash+attention&strategy=hybrid-rerank

{
  "query_id": "...",
  "strategy": "hybrid-rerank",
  "took_ms": 42.7,
  "results": [ ... ],
  "trace_available": true
}
```

### Trace response
- Normalized query tokens.
- Stage timing and candidate counts.
- Retriever-specific ranks/scores.
- Fusion evidence.
- Reranker score and rank movement.
- BM25 term-level components sufficient to explain the score.
- Index/corpus/config versions so a trace is reproducible.
> PRIVACY/PERFORMANCE  Detailed traces can be enabled for local/demo/debug operation and sampled or disabled in production-like benchmarks. Instrumentation itself should not invalidate latency measurements.

## 12. Visual product specification
The visual goal is to make Trace look like a serious search product first and an engineering instrument second. The default surface should be sparse and calm; Inspect is where density is earned.
### 12.1 Search home
```text
TRACE

┌────────────────────────────────────────────────────────────┐
│ Search technical knowledge…                           ⌘ K │
└────────────────────────────────────────────────────────────┘

Search, from first principles.
```

- Large centered query field; no dashboard cards on the home screen.
- Wordmark is typographic. Avoid literal magnifying-glass/tree/network logo clichés.
- Near-monochrome UI with one restrained accent if desired during implementation.
- Fast keyboard focus and command-palette behavior.
### 12.2 Results page
```text
TRACE   [ flash attention                                      ]
        All   Docs   Papers   Blogs             42 ms · 1,284 results

01  FlashAttention: Fast and Memory-Efficient Exact Attention...
    paper · arxiv / source metadata
    ...IO-aware exact attention algorithm that uses tiling to reduce...

02  FlashAttention-2...
    ...

                                     [ Inspect ranking ]
```

- Strong typography and whitespace; borders/dividers instead of card shadows.
- Rank numbers can appear subtly in demo mode and disappear in consumer mode.
- Snippets emphasize matched terms without turning into yellow-marker noise.
- Source identity should be obvious enough that results feel trustworthy.
### 12.3 Inspect drawer/page
```text
QUERY AUTOPSY · flash attention

Tokenize 0.08ms → BM25 5.4ms ─┐
                               ├→ RRF 0.3ms → rerank 29.1ms → top 10
             Dense 7.8ms ──────┘

Selected result: FlashAttention paper
BM25 rank 3      Dense rank 11      Hybrid rank 2      Final rank 1

BM25  14.82     Dense  .781     RRF  .0287     Cross-encoder  .943

term            tf       df        idf       contribution
flash           17       4,201     3.81      8.12
attention       31       18,420    2.34      6.70
```

### 12.4 Compare mode
- Columns for BM25, dense, hybrid and reranked top-10 results.
- Connect or annotate the same document across columns to show rank movement.
- Top bar shows quality metric and latency for each strategy on the selected evaluation set.
- One-click query examples that intentionally expose lexical vs semantic differences.
### 12.5 Benchmark page
- Hero numbers only when reproducible: corpus size, P95, MRR/nDCG and index size.
- Latency distribution chart, quality-vs-latency plot, index size breakdown and experiment table.
- Every chart carries dataset, commit/config and hardware context.
- Allow baseline selection to visualize deltas from a previous experiment.
### 12.6 Visual polish rules
- No gratuitous gradients, glassmorphism, neon AI aesthetics or floating-card dashboard look.
- Prefer 1px borders, clear type hierarchy, generous whitespace and compact monospace for engine data.
- Animation should explain pipeline transitions/rank movement, not decorate the page.
- Desktop-first Inspect experience, responsive normal Search experience.
- Use real query traces in screenshots and demos.
## 13. Demo design: make the engineering visible
Trace needs a rehearsed 3–5 minute demo that tells an engineering story rather than clicking randomly through features.
1. Search a straightforward lexical query and show fast, sensible BM25 results.
1. Open Inspect and explain tokenizer → postings → BM25 score for one result.
1. Switch to a vocabulary-mismatch query where dense retrieval finds a relevant document lexical search misses.
1. Turn on hybrid retrieval and show candidate overlap/rank movement.
1. Enable cross-encoder reranking and show the quality/latency trade-off.
1. Open Benchmarks and show a real before/after optimization, e.g. uncompressed baseline vs mmap/pruned/compressed index.
### Curated demo query classes
| Class | What it proves |
| --- | --- |
| Rare exact term | IDF and lexical precision. |
| Long document vs short document | BM25 length normalization. |
| Synonym/paraphrase | Dense retrieval's vocabulary-mismatch advantage. |
| Ambiguous technical term | Reranker's contextual discrimination. |
| Common high-frequency term | Why naive TF fails. |
| Performance stress query | Pruning/postings behavior and tail latency. |

## 14. Interview readiness
### 14.1 The 30-second explanation
> PITCH  Trace is a technical search engine I built from first principles. I started with my own tokenizer, inverted index and BM25 ranking, then engineered the index for lower latency using memory mapping, pruning and compressed postings. After establishing a measurable lexical baseline, I added dense retrieval, hybrid fusion and cross-encoder reranking. The UI has an Inspect mode that exposes the actual ranking pipeline and a benchmark harness that measures relevance, latency and memory trade-offs.

### 14.2 Questions Trace should let you answer
- Why an inverted index instead of scanning documents?
- How is IDF derived intuitively and mathematically?
- Why BM25 instead of TF-IDF? What do k1 and b do?
- How are postings represented on disk and in memory?
- What does memory mapping change? What happens on a cold cache?
- How does MaxScore/dynamic pruning avoid unnecessary scoring?
- Why delta encoding works well for sorted document IDs.
- What is the trade-off between compression ratio and decode speed?
- Why dense retrieval helps with vocabulary mismatch.
- Why not use dense retrieval alone?
- How do you combine sparse and dense scores/ranks?
- Why is a cross-encoder more accurate and more expensive than a bi-encoder?
- How did you choose top-K/top-N values?
- What do MRR, nDCG and Recall measure, and when can they disagree?
- How did you avoid benchmark leakage/cherry-picking?
- What is your P95 bottleneck and how did you identify it?
- What breaks first at 10× corpus size?
- How would you shard the index? How would you merge top-k across shards?
- How would updates/deletes work without rebuilding everything?
- How would you make the service highly available?
### 14.3 Whiteboard architecture story
1. Start with corpus and document IDs.
1. Draw term → postings inverted index.
1. Explain BM25 candidate scoring.
1. Add persistent/mmap index and compressed postings.
1. Add top-k heap and pruning.
1. Draw dense retrieval as a parallel candidate generator.
1. Fuse candidate sets.
1. Rerank bounded top-N.
1. Close with evaluation + tracing, because those validate every previous box.
## 15. Build roadmap
| Phase | Deliverable | Exit criterion |
| --- | --- | --- |
| 0 — Harness | Corpus importer, benchmark/eval skeleton, golden queries | Can reproduce corpus + run baseline measurements. |
| 1 — Classical core | Tokenizer, inverted index, TF/TF-IDF, BM25, search UI | Correct ranked search; Inspect shows real BM25 evidence. |
| 2 — Evaluation | MRR/nDCG/Recall pipeline + judged product queries | Ranking changes can be compared objectively. |
| 3 — Performance | Persistent layout, mmap, pruning, compression | Measured latency/memory improvement with correctness/quality checks. |
| 4 — Neural | Bi-encoder dense retrieval | Dense baseline evaluated independently. |
| 5 — Hybrid | Fusion + candidate diagnostics | Hybrid improves target quality/recall on declared dataset. |
| 6 — Reranking | Cross-encoder bounded rerank | Measured quality gain with explicit latency cost. |
| 7 — Product polish | Compare, Benchmarks, demo traces | 3–5 minute demo is coherent and visually polished. |
| 8 — Explore | Evidence-grounded topic synthesis | Search remains primary; provenance is inspectable. |

### Build order within V1
1. Define document schema and a small reproducible corpus.
1. Implement analyzer/tokenizer and golden tests.
1. Build in-memory inverted index first.
1. Implement simple TF and TF-IDF to create educational baselines.
1. Implement BM25 and top-k retrieval.
1. Build evaluation harness before optimizing.
1. Persist index and document metadata.
1. Add search API and minimal UI.
1. Add actual trace events and Inspect.
1. Only then begin mmap/pruning/compression.
## 16. Engineering quality bar
### Repository structure
```text
/engine        tokenizer, index, sparse retrieval, storage
/neural        embeddings, vector retrieval, reranker
/service       query API, orchestration, trace capture
/eval          datasets, qrels, metrics, experiment runner
/bench         latency/memory/load benchmarks
/ingest        corpus adapters and parsers
/web           product UI
/docs          architecture, index format, experiments, ADRs
```

### Testing
- Unit tests for tokenizer edge cases and scoring math.
- Property/invariant tests for postings ordering and encode/decode round trips.
- Golden ranking tests on a tiny hand-verifiable corpus.
- Integration test from corpus → index → query → result.
- Serialization compatibility/version tests.
- Evaluation regression suite.
- Benchmark suite kept separate from correctness tests.
### Observability
- Per-stage timers and counters.
- Candidate counts and postings visited.
- Cache/page-fault indicators where practical.
- Reranker batch size/inference timing.
- Error and timeout counters.
- Structured query trace IDs for debugging and UI Inspect.
## 17. Scaling discussion — design beyond the first machine
Trace does not need distributed search in its first implementation, but the architecture should make the scaling conversation credible.
- Immutable index segments allow incremental ingestion and background merges.
- Partition/shard by document ID or corpus partition; query shards in parallel and merge top-k globally.
- Replicate shards for availability/read throughput.
- Keep query routing and result merging separate from index internals.
- Cache frequent query results only after measuring workload locality.
- Separate offline embedding/index build from online query serving.
- Use bounded reranking so neural cost does not grow with corpus size.
### Failure modes worth discussing
- Hot terms with enormous postings lists.
- Tail latency from disk/page-cache misses.
- Index corruption or incompatible index versions.
- Duplicate/low-quality corpus documents overwhelming rankings.
- Dense retrieval drift after embedding model changes.
- Reranker timeout or GPU/accelerator unavailability.
- Stale index during incremental updates.
## 18. Source quality, safety and provenance
- Maintain source metadata and canonical links.
- Prefer primary/official technical sources where possible.
- Clearly distinguish source content from synthesized Explore text.
- Do not index private/authenticated content without explicit authorization.
- Document corpus licensing/redistribution assumptions.
- Provide deletion/reindex mechanics for corpus corrections.
## 19. Résumé and portfolio packaging
Do not write final résumé metrics until Trace produces them. The project should generate its own evidence.
### Résumé bullet template
> TEMPLATE  Built Trace, a from-scratch multi-stage search engine over [N] documents; implemented inverted indexing, BM25, [pruning], memory-mapped/compressed postings, then added dense retrieval + cross-encoder reranking, improving [metric] by [X] while achieving [P95] latency on [declared hardware].

### Portfolio page evidence
- Architecture diagram.
- Interactive live search.
- Inspect screenshot/GIF showing a query moving through stages.
- One performance experiment with before/after graph.
- One relevance experiment showing sparse vs hybrid vs reranked quality.
- Short index-format explanation.
- Link to reproducible benchmark methodology.
### What not to claim
- “Google-scale”, “production-scale” or “billions of documents” unless literally demonstrated.
- Sub-100 ms because a tutorial achieved it.
- Quality improvements without a fixed evaluation set.
- “Built from scratch” if core retrieval is delegated to a search engine library.
## 20. Architecture decisions to document
| ADR | Decision to capture |
| --- | --- |
| ADR-001 | Corpus choice and why controlled ingestion beats web-scale crawling initially. |
| ADR-002 | Tokenizer policy for technical text. |
| ADR-003 | Index file/segment format. |
| ADR-004 | BM25 parameters and field weighting. |
| ADR-005 | Memory mapping and storage layout. |
| ADR-006 | Pruning algorithm and exact/approximate guarantees. |
| ADR-007 | Posting compression scheme. |
| ADR-008 | Dense embedding model and vector index. |
| ADR-009 | Hybrid fusion method. |
| ADR-010 | Cross-encoder model and rerank depth. |
| ADR-011 | Evaluation datasets and metrics. |
| ADR-012 | Trace instrumentation and benchmark isolation. |

## 21. Definition of done
Trace is portfolio-ready when all of the following are true:
- A fresh checkout can build/import a documented corpus and create the index.
- Search returns credible ranked results through the custom retrieval engine.
- BM25 implementation and scoring are tested and explainable.
- At least one meaningful performance optimization has measured before/after evidence.
- Dense retrieval and hybrid retrieval have independent evaluation results.
- Cross-encoder reranking has a measured quality-vs-latency result if included in the flagship build.
- Inspect shows actual query-stage data and per-result ranking evidence.
- Benchmark page displays reproducible metrics with environment/config context.
- The UI looks polished enough for a screen recording without explanatory apologies.
- The README can explain architecture, trade-offs, benchmark methodology and how to reproduce the demo.
- The 30-second pitch, 5-minute demo and 15-minute deep dive all tell the same coherent engineering story.
> FINAL PRODUCT TEST  If an interviewer ignores the UI, the engine should still be technically impressive. If they ignore the code, the product should still make the engine's sophistication visible.

## 22. Final scope statement
Trace is a high-performance, inspectable search engine for technical knowledge. It owns the retrieval path from tokenization and inverted indexing through BM25, persistent/compressed index access, pruning, dense candidate generation, hybrid fusion and cross-encoder reranking. It evaluates ranking quality and systems performance with reproducible metrics, and exposes the real query pipeline through a polished visual inspector. Search remains the primary product. Evidence-grounded Explore/synthesis is a later extension built on top of Trace's own retrieval system, never a substitute for it.

*TRACE  /  Search, from first principles.*
