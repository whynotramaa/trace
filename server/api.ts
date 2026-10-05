import { join } from "node:path";
import { unlink } from "node:fs/promises";
import type { Parameters } from "../engine/bm25.ts";
import type { DiskIndex, Mode, TermStats } from "../engine/disk.ts";
import type { TermEvidence } from "../engine/index.ts";
import { rrf, type DenseIndex, type DenseMode } from "../engine/dense.ts";
import type { Document } from "../engine/document.ts";
import type { Embedder, Reranker } from "./neural.ts";

const CANDIDATES = 100, RRF_K = 60;

export interface Metadata {
  documents: number;
  indexed_documents: number;
  terms: number;
  postings: number;
  analyzer: string;
  sources: { name: string; documents: number }[];
}

export interface SearchHit {
  doc_id: string;
  uri: string;
  title: string;
  snippet: string;
  source: string;
  content_type: string;
  published_at: string | null;
  attribution?: { author: string; author_uri: string | null; license: string };
  document_length: number;
  score: number;
}

export type Stage = "bm25" | "dense" | "rrf" | "rerank";

export interface SearchResponse {
  query_id: string;
  query: string;
  pipeline: Stage[];
  tokens: string[];
  docs_scored: number;
  timings: { tokenize_ms: number; retrieve_ms: number; explain_ms: number; total_ms: number };
  hits: SearchHit[];
}

export interface QueryTrace {
  query_id: string;
  query: string;
  tokens: string[];
  candidate_count: number;
  postings_visited: number;
  parameters: Parameters;
  analyzer: string;
  mode: Mode;
  stages: { name: string; ms: number; count: number; unit: string }[];
  postings: TermStats[];
  pipeline: Stage[];
  fusion: { k: number; bm25: number; dense: number; overlap: number; fused: number; dense_mode: DenseMode } | null;
  results: {
    doc_id: string; score: number; document_length: number; terms: TermEvidence[];
    bm25: { rank: number; score: number } | null; dense: { rank: number; similarity: number } | null;
    rrf: { rank: number; score: number } | null; rerank: { rank: number; score: number } | null;
  }[];
}

type ErrorBody = { error: string };
type TraceEntry = { trace: QueryTrace; expires: number };

const MAX_TRACES = 128;
const TRACE_TTL = 5 * 60_000;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function snippet(title: string, body: string, tokens: string[]): string {
  const text = (body || title).replace(/\s+/g, " ").trim();
  if (text.length <= 300) return text;
  const lower = text.toLocaleLowerCase();
  const match = tokens.map((token) => lower.indexOf(token.toLocaleLowerCase())).find((position) => position >= 0) ?? 0;
  let start = Math.max(0, Math.min(match - 120, text.length - 300));
  if (start) {
    const boundary = text.indexOf(" ", start);
    if (boundary >= 0 && boundary < start + 30) start = boundary + 1;
  }
  let end = Math.min(start + 300, text.length);
  if (end < text.length) {
    const boundary = text.lastIndexOf(" ", end);
    if (boundary > end - 30) end = boundary;
  }
  return `${start ? "… " : ""}${text.slice(start, end).trim()}${end < text.length ? " …" : ""}`;
}

export interface ApiOptions {
  mode?: Mode; tracing?: boolean; traceDirectory?: string;
  dense?: { index: DenseIndex; embedder: Embedder; mode: DenseMode };
  rerank?: { model: Reranker; depth: number };
}

type Candidate = { row: number; score: number; bm25?: { rank: number; score: number }; dense?: { rank: number; similarity: number }; rrf?: { rank: number; score: number }; rerank?: { rank: number; score: number } };

export function createApi(index: DiskIndex, options: ApiOptions = {}): (request: Request) => Promise<Response> {
  const traces = new Map<string, TraceEntry>();
  const mode = options.mode ?? "maxscore", tracing = options.tracing ?? true, directory = options.traceDirectory;
  const sources = index.meta.sources ?? [];
  const file = (id: string) => join(directory!, `${id}.json`);
  const forget = (id: string) => { traces.delete(id); if (directory) void unlink(file(id)).catch(() => {}); };

  return async (request) => {
    for (const [id, entry] of traces) if (entry.expires <= Date.now()) forget(id);
    const url = new URL(request.url);
    if (request.method !== "GET") {
      const response = json({ error: "Method not allowed" } satisfies ErrorBody, 405);
      response.headers.set("Allow", "GET");
      return response;
    }

    if (url.pathname === "/metadata") {
      return json({
        documents: index.meta.documents,
        indexed_documents: index.meta.indexed_documents,
        terms: index.meta.terms,
        postings: index.meta.postings,
        analyzer: index.analyzer,
        sources,
      } satisfies Metadata);
    }

    if (url.pathname === "/search") {
      const query = url.searchParams.get("q");
      if (query === null || !query.trim()) return json({ error: "q is required" } satisfies ErrorBody, 400);
      if (query.length > 512) return json({ error: "q must be at most 512 characters" } satisfies ErrorBody, 400);
      const rawK = url.searchParams.get("k");
      const k = rawK === null ? 10 : Number(rawK);
      if (rawK !== null && (!/^\d+$/.test(rawK) || !Number.isInteger(k) || k < 1 || k > 20)) {
        return json({ error: "k must be an integer from 1 to 20" } satisfies ErrorBody, 400);
      }

      const started = performance.now();
      const dense = options.dense, rerank = options.rerank;
      const result = index.search(query, { k: dense || rerank ? Math.max(k, CANDIDATES) : k, mode });
      const pipeline: Stage[] = ["bm25"];
      const stages: QueryTrace["stages"] = [
        { name: "tokenize", ms: result.timings.tokenize_ms, count: result.tokens.length, unit: "tokens" },
        { name: `${mode} BM25`, ms: result.timings.retrieve_ms, count: result.candidate_count, unit: "candidates" },
      ];
      let candidates: Candidate[] = result.hits.map((hit, rank) => ({ row: hit.index_id, score: hit.score, bm25: { rank: rank + 1, score: hit.score } }));
      let fusion: QueryTrace["fusion"] = null;
      if (dense) {
        let at = performance.now();
        const vector = await dense.embedder.query(query);
        stages.push({ name: "embed query", ms: performance.now() - at, count: vector.length, unit: "dimensions" });
        at = performance.now();
        const semantic = dense.index.search(vector, CANDIDATES, dense.mode);
        stages.push({ name: `dense ${dense.mode}`, ms: performance.now() - at, count: semantic.length, unit: "candidates" });
        at = performance.now();
        const byRow = new Map(candidates.map(candidate => [candidate.row, candidate]));
        semantic.forEach((hit, rank) => {
          const candidate = byRow.get(hit.row) ?? { row: hit.row, score: 0 };
          candidate.dense = { rank: rank + 1, similarity: hit.score };
          byRow.set(hit.row, candidate);
        });
        const fused = rrf([candidates.map(candidate => candidate.row), semantic.map(hit => hit.row)], RRF_K);
        candidates = fused.map((entry, rank) => Object.assign(byRow.get(entry.id)!, { score: entry.score, rrf: { rank: rank + 1, score: entry.score } }));
        stages.push({ name: "RRF fusion", ms: performance.now() - at, count: fused.length, unit: "candidates" });
        fusion = { k: RRF_K, bm25: result.hits.length, dense: semantic.length, overlap: fused.filter(entry => entry.ranks[0] && entry.ranks[1]).length, fused: fused.length, dense_mode: dense.mode };
        pipeline.push("dense", "rrf");
      }
      const documents = new Map<number, Document>();
      const load = (row: number) => documents.get(row) ?? documents.set(row, index.document(row)).get(row)!;
      if (rerank && candidates.length) {
        const at = performance.now(), head = candidates.slice(0, rerank.depth);
        const scores = await rerank.model.score(query, head.map(candidate => { const document = load(candidate.row); return `${document.title} ${document.body}`.trim(); }));
        head.forEach((candidate, i) => { candidate.score = scores[i]!; });
        head.sort((a, b) => b.score - a.score).forEach((candidate, rank) => { candidate.rerank = { rank: rank + 1, score: candidate.score }; });
        candidates = [...head, ...candidates.slice(head.length)];
        stages.push({ name: "rerank", ms: performance.now() - at, count: head.length, unit: "pairs" });
        pipeline.push("rerank");
      }
      const final = candidates.slice(0, k);
      const queryId = crypto.randomUUID();
      const evidenceStarted = performance.now();
      const results = !tracing ? [] : final.map((candidate) => ({
        doc_id: index.docId(candidate.row),
        score: candidate.score,
        document_length: index.lengths[candidate.row]!,
        terms: index.explain({ doc_id: index.docId(candidate.row), index_id: candidate.row, score: candidate.score }, result.tokens),
        bm25: candidate.bm25 ?? null, dense: candidate.dense ?? null, rrf: candidate.rrf ?? null, rerank: candidate.rerank ?? null,
      }));
      const explainMs = performance.now() - evidenceStarted;
      if (tracing) {
        const trace: QueryTrace = {
          query_id: queryId,
          query,
          tokens: result.tokens,
          candidate_count: result.candidate_count,
          postings_visited: result.postings_visited,
          parameters: result.parameters,
          analyzer: index.analyzer,
          mode,
          stages: [...stages, { name: "evidence", ms: explainMs, count: results.length, unit: "results" }],
          postings: result.terms,
          pipeline,
          fusion,
          results,
        };
        const expires = Date.now() + TRACE_TTL;
        traces.set(queryId, { trace, expires });
        if (directory) await Bun.write(file(queryId), JSON.stringify({ trace, expires }));
        while (traces.size > MAX_TRACES) forget(traces.keys().next().value!);
      }

      const hits = final.map((candidate) => {
        const document = load(candidate.row);
        return {
          doc_id: document.doc_id,
          uri: document.uri,
          title: document.title,
          snippet: snippet(document.title, document.body, result.tokens),
          source: document.source,
          content_type: document.content_type,
          published_at: document.published_at,
          ...(document.attribution ? { attribution: document.attribution } : {}),
          document_length: index.lengths[candidate.row]!,
          score: candidate.score,
        } satisfies SearchHit;
      });
      const response: SearchResponse = {
        query_id: queryId,
        query,
        pipeline,
        tokens: result.tokens,
        docs_scored: result.candidate_count,
        timings: { tokenize_ms: result.timings.tokenize_ms, retrieve_ms: result.timings.retrieve_ms, explain_ms: explainMs, total_ms: performance.now() - started },
        hits,
      };
      return json(response);
    }

    if (url.pathname.startsWith("/trace/")) {
      const id = url.pathname.slice("/trace/".length);
      let entry = traces.get(id);
      if (!entry && directory && /^[0-9a-f-]{36}$/.test(id)) entry = await Bun.file(file(id)).json().catch(() => undefined);
      if (!id || !entry || entry.expires <= Date.now()) return json({ error: "Trace not found" } satisfies ErrorBody, 404);
      return json(entry.trace);
    }

    return json({ error: "Not found" } satisfies ErrorBody, 404);
  };
}
