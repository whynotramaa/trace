import { analyze, type AnalyzerMode } from "./analyzer.ts";
import { validateDocument, type Document } from "./document.ts";
import { contribution, defaults, idf, lengthNorm, validateParameters, type Parameters } from "./bm25.ts";
import { TopK, type Hit } from "./heap.ts";
import { lines } from "../eval/io.ts";

export type Strategy = "tf" | "tfidf" | "bm25";
export interface Posting { doc: number; tf: number }
export interface TermEvidence { term: string; query_tf: number; tf: number; df: number; idf: number; length_norm: number; contribution: number }

export class InvertedIndex {
  readonly documents: Document[] = [];
  readonly lengths: number[] = [];
  readonly postings = new Map<string, Posting[]>();
  private readonly ids = new Set<string>();
  tokens = 0;
  indexedDocuments = 0;
  postingCount = 0;
  corpusHash = "";
  constructor(readonly analyzer: AnalyzerMode = "anserini") {}
  get avgdl(): number { return this.indexedDocuments ? this.tokens / this.indexedDocuments : 0; }

  add(document: Document) {
    validateDocument(document);
    if (this.ids.has(document.doc_id)) throw new Error(`Duplicate document ID ${document.doc_id}`);
    this.ids.add(document.doc_id);
    const doc = this.documents.length;
    const tokens = analyze(`${document.title} ${document.body}`, this.analyzer);
    const frequencies = new Map<string, number>();
    for (const term of tokens) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    this.documents.push(document);
    this.lengths.push(tokens.length);
    this.tokens += tokens.length;
    if (tokens.length) this.indexedDocuments++;
    for (const [term, tf] of frequencies) {
      let list = this.postings.get(term);
      if (!list) this.postings.set(term, list = []);
      list.push({ doc, tf });
      this.postingCount++;
    }
  }

  search(query: string, options: { k?: number; strategy?: Strategy; parameters?: Parameters; exclude?: string } = {}) {
    const started = performance.now();
    const strategy = options.strategy ?? "bm25";
    if (!["tf", "tfidf", "bm25"].includes(strategy)) throw new Error("Unsupported strategy");
    const parameters = validateParameters(options.parameters ?? defaults);
    const tokens = analyze(query, this.analyzer);
    const tokenizeMs = performance.now() - started;
    const queryTF = new Map<string, number>();
    for (const token of tokens) queryTF.set(token, (queryTF.get(token) ?? 0) + 1);
    const terms = [...queryTF].map(([term, count]) => {
      const list = this.postings.get(term) ?? [];
      return { term, count, list, cursor: 0, idf: list.length ? idf(this.indexedDocuments, list.length) : 0 };
    });
    const heap = new TopK(options.k ?? 10);
    let visited = 0, scored = 0;
    const rankingStarted = performance.now();
    // Exhaustive document-at-a-time scoring: every union candidate is fully scored.
    while (true) {
      let doc = Infinity;
      for (const term of terms) doc = Math.min(doc, term.list[term.cursor]?.doc ?? Infinity);
      if (doc === Infinity) break;
      const norm = lengthNorm(this.lengths[doc]!, this.avgdl, parameters, this.analyzer === "anserini");
      let score = 0;
      for (const term of terms) {
        const posting = term.list[term.cursor];
        if (posting?.doc !== doc) continue;
        visited++;
        const weight = Math.fround(term.idf * term.count);
        score += strategy === "tf" ? posting.tf * term.count : strategy === "tfidf" ? weight * posting.tf : contribution(posting.tf, weight, norm, this.analyzer === "anserini");
        term.cursor++;
      }
      if (this.documents[doc]!.doc_id === options.exclude) continue;
      scored++;
      heap.add({ doc_id: this.documents[doc]!.doc_id, index_id: doc, score: this.analyzer === "anserini" ? Math.fround(score) : score });
    }
    const hits = heap.sorted();
    return {
      hits, tokens, strategy, parameters, candidate_count: scored, postings_visited: visited,
      timings: { tokenize_ms: tokenizeMs, retrieve_ms: performance.now() - rankingStarted, total_ms: performance.now() - started },
    };
  }

  explain(hit: Hit, tokens: string[], parameters: Parameters = defaults): TermEvidence[] {
    const qtf = new Map<string, number>();
    for (const term of tokens) qtf.set(term, (qtf.get(term) ?? 0) + 1);
    const norm = lengthNorm(this.lengths[hit.index_id]!, this.avgdl, parameters, this.analyzer === "anserini");
    const evidence: TermEvidence[] = [];
    for (const [term, queryTF] of qtf) {
      const list = this.postings.get(term) ?? [];
      let lo = 0, hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (list[mid]!.doc < hit.index_id) lo = mid + 1; else hi = mid;
      }
      const posting = list[lo];
      const tf = posting?.doc === hit.index_id ? posting.tf : 0;
      const termIDF = list.length ? idf(this.indexedDocuments, list.length) : 0;
      evidence.push({ term, query_tf: queryTF, tf, df: list.length, idf: termIDF, length_norm: norm, contribution: tf ? contribution(tf, Math.fround(termIDF * queryTF), norm, this.analyzer === "anserini") : 0 });
    }
    return evidence;
  }
}

export async function buildIndex(path: string, analyzer: AnalyzerMode = "anserini"): Promise<InvertedIndex> {
  const index = new InvertedIndex(analyzer);
  const digest = new Bun.CryptoHasher("sha256");
  for await (const line of lines(path)) {
    digest.update(`${line}\n`);
    index.add(validateDocument(JSON.parse(line)));
    if (index.documents.length % 100_000 === 0) console.error(`Indexed ${index.documents.length} documents; RSS ${(process.memoryUsage().rss / 2 ** 30).toFixed(2)} GiB`);
  }
  index.corpusHash = digest.digest("hex");
  if (!index.documents.length) throw new Error("Cannot build an empty index");
  return index;
}
