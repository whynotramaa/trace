import { test, expect, afterEach, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDiskIndex } from "../engine/build.ts";
import { DiskIndex } from "../engine/disk.ts";
import type { Document } from "../engine/document.ts";
import { createApi, type QueryTrace, type SearchResponse } from "../server/api.ts";

const servers: Bun.Server<unknown>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

function document(id: string, body: string, source = "docs"): Document {
  return { doc_id: id, title: id, body, uri: `https://example.test/${id}`, source, content_type: "text/plain", published_at: null, checksum: createHash("sha256").update(id + body).digest("hex") };
}

const directory = mkdtempSync(join(tmpdir(), "trace-api-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
writeFileSync(join(directory, "corpus.jsonl"), [
  document("a", "alpha alpha beta", "one"),
  { ...document("b", "alpha gamma", "two"), attribution: { author: "Ada", author_uri: null, license: "CC" } },
  document("c", "beta", "one"),
].map((doc) => JSON.stringify(doc)).join("\n") + "\n");
await buildDiskIndex(join(directory, "corpus.jsonl"), join(directory, "index"), { k1: 0.9, b: 0.4 });
const index = new DiskIndex(join(directory, "index"));

function running() {
  const server = Bun.serve({ port: 0, fetch: createApi(index) });
  servers.push(server);
  return server;
}

async function get(server: Bun.Server<unknown>, path: string, init?: RequestInit) {
  return fetch(`${server.url}${path}`, init);
}

test("metadata and search return real index data and ranking", async () => {
  const server = running();
  const metadata = await (await get(server, "/metadata")).json();
  expect(metadata).toEqual({ documents: 3, indexed_documents: 3, terms: 5, postings: 7, analyzer: "anserini", sources: [{ name: "one", documents: 2 }, { name: "two", documents: 1 }] });
  const response = await (await get(server, "/search?q=alpha&k=2")).json() as SearchResponse;
  expect(response.hits.map((hit) => hit.doc_id)).toEqual(["a", "b"]);
  expect(response.docs_scored).toBe(2);
  expect(response.hits[0]!.attribution).toBeUndefined();
  expect(response.hits[1]!.attribution?.author).toBe("Ada");
  expect(response.hits[0]!.snippet).toContain("alpha");
  expect(response.timings.total_ms).toBeGreaterThanOrEqual(response.timings.explain_ms);
});

test("trace contains engine counters and explain ledger", async () => {
  const server = running();
  const response = await (await get(server, "/search?q=alpha")).json() as SearchResponse;
  const trace = await (await get(server, `/trace/${response.query_id}`)).json() as QueryTrace;
  expect(trace.candidate_count).toBe(2);
  expect(trace.postings_visited).toBe(2);
  expect(trace.parameters).toEqual({ k1: 0.9, b: 0.4 });
  expect(trace.stages.map((stage) => stage.name)).toEqual(["tokenize", "maxscore BM25", "evidence"]);
  expect(trace.postings.map((term) => [term.term, term.df, term.blocks])).toEqual([["alpha", 2, 1]]);
  expect(trace.results).toHaveLength(2);
  for (const result of trace.results) expect(result.terms.reduce((sum, term) => sum + term.contribution, 0)).toBeCloseTo(result.score, 5);
});

test("empty results, validation, methods, and unknown paths use HTTP errors", async () => {
  const server = running();
  for (const path of ["/search", "/search?q=", `/search?q=${"x".repeat(513)}`, "/search?q=a&k=0", "/search?q=a&k=1.5", "/search?q=a&k=21"]) {
    const response = await get(server, path);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeString();
  }
  const empty = await (await get(server, "/search?q=missing")).json() as SearchResponse;
  expect(empty.hits).toEqual([]);
  expect(empty.docs_scored).toBe(0);
  expect((await get(server, "/nope")).status).toBe(404);
  expect((await get(server, "/metadata", { method: "POST" })).status).toBe(405);
  expect((await get(server, "/metadata")).headers.get("cache-control")).toBe("no-store");
});

test("traces evict oldest entries and expire", async () => {
  const server = running();
  const ids: string[] = [];
  for (let i = 0; i < 129; i++) {
    const response = await (await get(server, `/search?q=alpha&k=${(i % 2) + 1}`)).json() as SearchResponse;
    ids.push(response.query_id);
  }
  expect((await get(server, `/trace/${ids[0]}`)).status).toBe(404);
  expect((await get(server, `/trace/${ids[128]}`)).status).toBe(200);
  const originalNow = Date.now;
  Date.now = () => originalNow() + 5 * 60_001;
  try { expect((await get(server, `/trace/${ids[128]}`)).status).toBe(404); } finally { Date.now = originalNow; }
});
