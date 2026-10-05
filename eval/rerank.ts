import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PAIR_TOKENS, Reranker, RERANKER } from "../server/neural.ts";
import { collectEnvironment, hashFile, memoryUsage } from "../bench/environment.ts";
import { args, lines } from "./io.ts";
import { evaluate, loadQrels, loadRun, ranked, type Run } from "./metrics.ts";
import { loadQueries, stats } from "./run.ts";

const WARMUP = 20, TOLERANCE = 0.005;
const config = args(["dataset", "corpus", "queries", "qrels", "run", "out"], ["dataset", "corpus", "queries", "qrels", "run", "out", "models", "depths", "latency-queries"]);
const depths = (config.depths ?? "10,20,50,100").split(",").map(Number);
if (depths.some(depth => !Number.isInteger(depth) || depth < 1)) throw new Error("--depths must be positive integers");
const deepest = Math.max(...depths), latencyQueries = Number(config["latency-queries"] ?? 500);
const [allQueries, qrels, fused, machine] = await Promise.all([
  loadQueries(config.queries!), loadQrels(config.qrels!), loadRun(config.run!), collectEnvironment(resolve(import.meta.dir, "..")),
]);
const queries = allQueries.filter(query => qrels.has(query.id));
const lists = new Map(queries.map(query => [query.id, ranked(fused.get(query.id)).map(([doc]) => doc)]));
const needed = new Set([...lists.values()].flatMap(list => list.slice(0, deepest)));
const passages = new Map<string, string>();
for await (const line of lines(config.corpus!)) {
  const document = JSON.parse(line) as { doc_id: string; title: string; body: string };
  if (needed.has(document.doc_id)) passages.set(document.doc_id, `${document.title} ${document.body}`.trim());
}
if (passages.size !== needed.size) throw new Error(`${needed.size - passages.size} run documents are missing from the corpus`);

const reranker = await Reranker.open(config.models ?? "data/models");
const text = (query: { id: string }, depth: number) => lists.get(query.id)!.slice(0, depth).map(doc => passages.get(doc)!);
for (const query of queries.slice(0, WARMUP)) await reranker.score(query.text, text(query, deepest));

const scores = new Map<string, Float32Array>();
const scoringStarted = performance.now();
for (const [i, query] of queries.entries()) {
  scores.set(query.id, await reranker.score(query.text, text(query, deepest)));
  if ((i + 1) % 500 === 0) console.error(`Scored ${i + 1}/${queries.length} queries`);
}
const scoringMs = performance.now() - scoringStarted;

function reranked(depth: number): Run {
  const run: Run = new Map();
  for (const query of queries) {
    const list = lists.get(query.id)!, score = scores.get(query.id)!;
    const head = list.slice(0, depth).map((doc, rank) => ({ doc, rank, score: score[rank]! })).sort((a, b) => b.score - a.score || a.rank - b.rank).map(entry => entry.doc);
    const order = [...head, ...list.slice(depth)];
    run.set(query.id, new Map(order.map((doc, rank) => [doc, order.length - rank])));
  }
  return run;
}

const sample = queries.slice(0, Math.min(latencyQueries, queries.length));
const sweep = [{ depth: 0, metrics: evaluate(qrels, reranked(0)).aggregate, added_latency_ms: null as ReturnType<typeof stats> | null }];
for (const depth of depths) {
  const latency: number[] = [];
  for (const query of sample) {
    const started = performance.now();
    await reranker.score(query.text, text(query, depth));
    latency.push(performance.now() - started);
  }
  sweep.push({ depth, metrics: evaluate(qrels, reranked(depth)).aggregate, added_latency_ms: stats(latency) });
  console.error(`N=${depth}: nDCG@10 ${sweep.at(-1)!.metrics.ndcg_cut_10.toFixed(4)}, P50 ${stats(latency).p50.toFixed(1)} ms`);
}
const best = Math.max(...sweep.slice(1).map(point => point.metrics.ndcg_cut_10));
const suggested = sweep.slice(1).find(point => point.metrics.ndcg_cut_10 >= best - TOLERANCE)!.depth;

function plot(): string {
  const points = sweep.slice(1), width = 640, height = 400, pad = 56;
  const xs = points.map(point => point.added_latency_ms!.p50), ys = sweep.map(point => point.metrics.ndcg_cut_10);
  const xMax = Math.max(...xs) * 1.1, yMin = Math.min(...ys) - 0.01, yMax = Math.max(...ys) + 0.01;
  const x = (value: number) => pad + value / xMax * (width - 2 * pad), y = (value: number) => height - pad - (value - yMin) / (yMax - yMin) * (height - 2 * pad);
  const base = y(sweep[0]!.metrics.ndcg_cut_10);
  const line = points.map((point, i) => `${i ? "L" : "M"}${x(point.added_latency_ms!.p50).toFixed(1)},${y(point.metrics.ndcg_cut_10).toFixed(1)}`).join(" ");
  const marks = points.map(point => {
    const cx = x(point.added_latency_ms!.p50), cy = y(point.metrics.ndcg_cut_10), p95 = x(point.added_latency_ms!.p95);
    return `<line x1="${cx}" y1="${cy}" x2="${p95}" y2="${cy}" stroke="#1d6454" stroke-opacity=".35" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${point.depth === suggested ? 6 : 4}" fill="#1d6454"/><text x="${cx + 8}" y="${cy - 8}" font-size="12">N=${point.depth} · ${point.metrics.ndcg_cut_10.toFixed(4)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="sans-serif" fill="#202b26"><rect width="${width}" height="${height}" fill="#fff"/>`
    + `<line x1="${pad}" y1="${base}" x2="${width - pad}" y2="${base}" stroke="#58665e" stroke-dasharray="4 4"/><text x="${width - pad}" y="${base - 6}" font-size="11" text-anchor="end" fill="#58665e">hybrid, no rerank ${sweep[0]!.metrics.ndcg_cut_10.toFixed(4)}</text>`
    + `<path d="${line}" fill="none" stroke="#1d6454" stroke-width="1.5"/>${marks}`
    + `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#58665e"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#58665e"/>`
    + `<text x="${width / 2}" y="${height - 16}" font-size="12" text-anchor="middle">Added rerank latency, P50 dot to P95 bar (ms), ${sample.length} queries</text>`
    + `<text transform="translate(16 ${height / 2}) rotate(-90)" font-size="12" text-anchor="middle">nDCG@10, ${config.dataset}, ${queries.length} queries</text>`
    + `<text x="${pad}" y="${height - pad + 16}" font-size="11">0</text><text x="${width - pad}" y="${height - pad + 16}" font-size="11" text-anchor="end">${xMax.toFixed(0)}</text>`
    + `<text x="${pad - 6}" y="${y(yMin) + 4}" font-size="11" text-anchor="end">${yMin.toFixed(3)}</text><text x="${pad - 6}" y="${y(yMax) + 4}" font-size="11" text-anchor="end">${yMax.toFixed(3)}</text></svg>\n`;
}

await mkdir(dirname(resolve(config.out!)), { recursive: true });
const record = {
  dataset: config.dataset,
  counts: { queries: queries.length, latency_queries: sample.length, passages: passages.size },
  inputs: {
    corpus: { path: config.corpus, sha256: await hashFile(config.corpus!) }, run: { path: config.run, sha256: await hashFile(config.run!) },
    queries: { path: config.queries, sha256: await hashFile(config.queries!) }, qrels: { path: config.qrels, sha256: await hashFile(config.qrels!) },
  },
  reranker: { model: RERANKER, file: "onnx/model_quint8_avx2.onnx", pair_tokens: PAIR_TOKENS, batch: 32, threads: "ONNX Runtime default" },
  quality_note: `Each query's top ${deepest} were scored once; depth N reorders the first N by those scores. Latency is measured separately per N.`,
  offline_scoring_ms: scoringMs,
  sweep,
  rule: `Smallest N whose nDCG@10 is within ${TOLERANCE} of the best N in the sweep`,
  suggested_n: suggested,
  memory: memoryUsage(),
  tracing: "off",
  machine,
};
await Bun.write(`${config.out}.json`, `${JSON.stringify(record, null, 2)}\n`);
await Bun.write(`${config.out}.svg`, plot());
console.log(JSON.stringify({ dataset: config.dataset, suggested_n: suggested, sweep: sweep.map(point => ({ depth: point.depth, ndcg_cut_10: point.metrics.ndcg_cut_10, p50: point.added_latency_ms?.p50 ?? 0 })) }));
