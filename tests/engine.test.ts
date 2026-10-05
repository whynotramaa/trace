import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { InvertedIndex } from "../engine/index.ts";
import { TopK, compareHits } from "../engine/heap.ts";
import { contribution, idf, lengthNorm, luceneLength, defaults } from "../engine/bm25.ts";
import type { Document } from "../engine/document.ts";
import { batchedSearch } from "../eval/batched.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareReference } from "../eval/run.ts";

function document(id: string, body: string): Document {
  return { doc_id: id, title: "", body, uri: "", source: "golden", content_type: "test", published_at: null, checksum: createHash("sha256").update(body).digest("hex") };
}

test("bounded heap agrees with a full sort for varied k and ties", () => {
  const hits = Array.from({ length: 200 }, (_, i) => ({ doc_id: String(i), index_id: i, score: (i * 47) % 31 }));
  for (const k of [1, 2, 10, 199, 250]) {
    const heap = new TopK(k);
    for (const hit of hits) heap.add(hit);
    expect(heap.sorted()).toEqual([...hits].sort((a, b) => compareHits(b, a)).slice(0, k));
  }
});

test("BM25 golden ledger uses hand-verifiable tf, df, length, and positive IDF", () => {
  const index = new InvertedIndex("technical");
  index.add(document("a", "alpha alpha beta"));
  index.add(document("b", "alpha gamma"));
  index.add(document("c", "beta"));
  const result = index.search("alpha", { k: 3 });
  expect(result.hits.map(hit => hit.doc_id)).toEqual(["a", "b"]);
  expect(result.candidate_count).toBe(2);
  expect(result.postings_visited).toBe(2);
  const ledger = index.explain(result.hits[0]!, result.tokens);
  expect(ledger[0]!.tf).toBe(2);
  expect(ledger[0]!.df).toBe(2);
  expect(ledger[0]!.idf).toBeCloseTo(Math.log(1 + 1.5 / 2.5), 6);
  expect(ledger[0]!.length_norm).toBeCloseTo(0.9 * (0.6 + 0.4 * 3 / 2), 10);
  expect(ledger[0]!.contribution).toBe(result.hits[0]!.score);
  expect(index.search("unknown").hits).toEqual([]);
  expect(index.search("").candidate_count).toBe(0);
  expect(index.search("alpha", { exclude: "a" }).hits.map(hit => hit.doc_id)).toEqual(["b"]);
});

test("exhaustive DAAT agrees with an independent full document scan", () => {
  const index = new InvertedIndex("technical");
  const bodies = ["alpha beta", "beta beta gamma", "gamma", "alpha alpha delta", "", "beta delta alpha"];
  bodies.forEach((body, i) => index.add(document(String(i), body)));
  for (const query of ["alpha", "beta gamma", "alpha alpha delta", "alpha missing"]) {
    for (const strategy of ["tf", "tfidf", "bm25"] as const) {
      const tokens = query.split(" ");
      const expected = bodies.map((body, i) => {
        const words = body ? body.split(" ") : [];
        let score = 0, matched = false;
        for (const term of tokens) {
          const tf = words.filter(word => word === term).length;
          const df = bodies.filter(other => other.split(" ").includes(term)).length;
          if (!tf) continue;
          matched = true;
          const rarity = idf(index.indexedDocuments, df);
          score += strategy === "tf" ? tf : strategy === "tfidf" ? tf * rarity : contribution(tf, rarity, lengthNorm(words.length, index.avgdl, defaults, false), false);
        }
        return { doc_id: String(i), index_id: i, score, matched };
      }).filter(hit => hit.matched).sort((a, b) => compareHits(b, a)).slice(0, 3);
      const actual = index.search(query, { k: 3, strategy }).hits;
      expect(actual.map(hit => hit.doc_id)).toEqual(expected.map(hit => hit.doc_id));
      actual.forEach((hit, i) => expect(hit.score).toBeCloseTo(expected[i]!.score, 6));
    }
  }
});

test("Lucene length quantization preserves small lengths and floors larger ones", () => {
  for (let length = 0; length < 40; length++) expect(luceneLength(length)).toBe(length);
  let last = 0;
  for (let length = 0; length < 10_000; length++) {
    const decoded = luceneLength(length);
    expect(decoded).toBeLessThanOrEqual(length);
    expect(decoded).toBeGreaterThanOrEqual(last);
    last = decoded;
  }
});

test("index rejects duplicate source identities and invalid scoring input", () => {
  const index = new InvertedIndex("technical");
  index.add(document("a", "alpha"));
  expect(() => index.add(document("a", "beta"))).toThrow("Duplicate");
  expect(() => index.search("alpha", { k: 0 })).toThrow();
  expect(() => index.search("alpha", { parameters: { k1: NaN, b: 0.4 } })).toThrow();
});

test("offline batches preserve full-corpus BM25 scores, ties, and exhaustive counters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trace-batches-"));
  try {
    const documents = ["alpha beta", "alpha alpha", "beta gamma", "", "gamma delta", "alpha beta", "alpha"]
      .map((body, i) => document(String(i), body));
    const path = join(directory, "corpus.jsonl");
    await Bun.write(path, documents.map(doc => JSON.stringify(doc)).join("\n") + "\n");
    for (const analyzer of ["anserini", "technical"] as const) {
      const full = new InvertedIndex(analyzer);
      documents.forEach(doc => full.add(doc));
      const queries = ["alpha", "alpha alpha beta", "beta gamma", "missing", ""].map((text, i) => ({ id: String(i), text }));
      const batched = await batchedSearch(path, queries, { batchSize: 2, analyzer, parameters: defaults, k: 3, excludeSelf: true });
      queries.forEach((query, i) => {
        const expected = full.search(query.text, { k: 3, exclude: query.id });
        expect(batched.heaps[i]!.sorted().map(({ doc_id, score }) => ({ doc_id, score })))
          .toEqual(expected.hits.map(({ doc_id, score }) => ({ doc_id, score })));
        expect(batched.candidates[i]).toBe(expected.candidate_count);
        expect(batched.postings[i]).toBe(expected.postings_visited);
      });
      expect(batched.count).toBe(documents.length);
      expect(batched.statistics.indexedDocuments).toBe(full.indexedDocuments);
    }
    await Bun.write(path, `${JSON.stringify(documents[0])}\n${JSON.stringify(documents[0])}\n`);
    await expect(batchedSearch(path, [], { batchSize: 1, analyzer: "anserini", parameters: defaults, k: 3 })).rejects.toThrow("Duplicate");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("reference gate rejects malformed declarations instead of treating them as absent", () => {
  const metrics = { mrr_10: 0.2, ndcg_cut_10: 0, recall_100: 0, recall_1000: 0 };
  const actual = { dataset: "msmarco", document_count: 7, query_count: 3, k1: 0.82, b: 0.68 };
  for (const reference of [
    { aggregate: { mrr_10: 0.2 }, document_count: "7" },
    { aggregate: { mrr_10: 0.2 }, query_count: -1 },
    { aggregate: { mrr_10: 0.2 }, k1: "0.82" },
    { aggregate: { mrr_10: 0.2 }, k1: null, scoring: { k1: 0.82 } },
  ]) expect(compareReference(metrics, reference, 0.001, actual).passed).toBe(false);
});
