import { mkdir } from "node:fs/promises";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DenseIndex, rrf } from "../engine/dense.ts";
import { Embedder } from "../server/neural.ts";
import { collectEnvironment, hashFile, memoryUsage } from "../bench/environment.ts";
import { args, lines } from "./io.ts";
import { evaluate, loadQrels, loadRun, ranked, type Run } from "./metrics.ts";
import { loadQueries, stats } from "./run.ts";

const DEPTH = 1000, CANDIDATES = 100, WARMUP = 20;
const config = args(["dataset", "vectors", "queries", "qrels", "out"], ["dataset", "vectors", "queries", "qrels", "out", "bm25", "models", "threads", "latency-queries"]);
const out = config.out!, models = config.models ?? "data/models";
const threads = Number(config.threads ?? cpus().length), latencyQueries = Number(config["latency-queries"] ?? 100);
const [allQueries, qrels, machine, queryHash, qrelsHash] = await Promise.all([
  loadQueries(config.queries!), loadQrels(config.qrels!), collectEnvironment(resolve(import.meta.dir, "..")), hashFile(config.queries!), hashFile(config.qrels!),
]);
const queries = allQueries.filter(query => qrels.has(query.id));
const dense = new DenseIndex(config.vectors!), d = dense.meta.dimensions, n = dense.meta.documents;
const ids: string[] = [];
for await (const line of lines(join(config.vectors!, "ids.txt"))) ids.push(line);
if (ids.length !== n) throw new Error(`ids.txt has ${ids.length} rows, dense.json declares ${n}`);
const rowOf = config.dataset!.startsWith("cqadupstack-") ? new Map(ids.map((id, row) => [id, row])) : null;
const exclude = Int32Array.from(queries, query => rowOf?.get(query.id) ?? -1);
await mkdir(dirname(resolve(out)), { recursive: true });

const embedder = await Embedder.open(models);
for (const query of queries.slice(0, WARMUP)) await embedder.query(query.text);
const vectors = new Float32Array(queries.length * d), embedMs: number[] = [];
for (const [i, query] of queries.entries()) {
  const started = performance.now();
  vectors.set(await embedder.query(query.text), i * d);
  embedMs.push(performance.now() - started);
}
console.error(`Embedded ${queries.length} queries, P50 ${stats(embedMs).p50.toFixed(2)} ms`);

const per = Math.ceil(n / threads), scanStarted = performance.now();
const parts = await Promise.all(Array.from({ length: threads }, (_, t) => new Promise<{ rows: Int32Array; scores: Float64Array }>((done, fail) => {
  const worker = new Worker(new URL("./dense-worker.ts", import.meta.url).href);
  worker.onmessage = event => { done(event.data); worker.terminate(); };
  worker.onerror = event => fail(new Error(event.message));
  worker.postMessage({ directory: config.vectors, queries: vectors, k: DEPTH, from: Math.min(n, t * per), to: Math.min(n, (t + 1) * per), exclude });
})));
const scanMs = performance.now() - scanStarted;
const exact = queries.map((_, q) => {
  const hits: { row: number; score: number }[] = [];
  for (const part of parts) for (let r = q * DEPTH; r < (q + 1) * DEPTH && part.rows[r]! >= 0; r++) hits.push({ row: part.rows[r]!, score: part.scores[r]! });
  return hits.sort((a, b) => b.score - a.score || a.row - b.row).slice(0, DEPTH);
});
console.error(`Exact scan: ${(scanMs / 1000).toFixed(1)} s on ${threads} threads`);

const sample = queries.slice(0, Math.min(latencyQueries, queries.length));
for (const [q] of sample.slice(0, WARMUP).entries()) dense.search(vectors.subarray(q * d, (q + 1) * d), CANDIDATES, "exact", exclude[q]!);
const exactMs = sample.map((_, q) => {
  const started = performance.now();
  dense.search(vectors.subarray(q * d, (q + 1) * d), CANDIDATES, "exact", exclude[q]!);
  return performance.now() - started;
});

async function save(name: string, lists: [string, number][][]): Promise<Run> {
  const path = `${out}.${name}.run.trec`, writer = Bun.file(path).writer(), run: Run = new Map();
  queries.forEach((query, q) => {
    run.set(query.id, new Map(lists[q]));
    lists[q]!.forEach(([doc, score], rank) => writer.write(`${query.id} Q0 ${doc} ${rank + 1} ${score} trace-${name}\n`));
  });
  await writer.end();
  return run;
}

const denseLists = exact.map(hits => hits.map(hit => [ids[hit.row]!, hit.score] as [string, number]));
const systems: Record<string, Run> = { dense: await save("dense", denseLists) };

let ann: Record<string, unknown> | null = null;
if (await Bun.file(dense.annPath).exists()) {
  const annMs: number[] = [];
  for (const [q] of queries.slice(0, WARMUP).entries()) dense.search(vectors.subarray(q * d, (q + 1) * d), CANDIDATES, "ann", exclude[q]!);
  queries.forEach((_, q) => {
    const started = performance.now();
    dense.search(vectors.subarray(q * d, (q + 1) * d), CANDIDATES, "ann", exclude[q]!);
    annMs.push(performance.now() - started);
  });
  const recall = { at_10: 0, at_100: 0, at_1000: 0 };
  const annLists = queries.map((_, q) => {
    const hits = dense.search(vectors.subarray(q * d, (q + 1) * d), DEPTH, "ann", exclude[q]!);
    for (const [key, k] of [["at_10", 10], ["at_100", 100], ["at_1000", 1000]] as const) {
      const truth = new Set(exact[q]!.slice(0, k).map(hit => hit.row));
      recall[key] += hits.slice(0, k).filter(hit => truth.has(hit.row)).length / Math.max(1, truth.size) / queries.length;
    }
    return hits.map(hit => [ids[hit.row]!, hit.score] as [string, number]);
  });
  systems.ann = await save("ann", annLists);
  ann = { config: await Bun.file(join(config.vectors!, "hnsw.json")).json(), latency_ms_k100: stats(annMs), recall_vs_exact: recall, ef_k100: 128, ef_k1000: DEPTH + 1 };
}

let overlap: Record<string, unknown> | null = null;
if (config.bm25) {
  const bm25 = await loadRun(config.bm25);
  const bm25Lists = queries.map(query => ranked(bm25.get(query.id)).slice(0, DEPTH));
  systems.bm25 = await save("bm25", bm25Lists);
  const shared: number[] = [];
  const hybrid = queries.map((_, q) => {
    const lexical = bm25Lists[q]!.map(([doc]) => doc), semantic = denseLists[q]!.map(([doc]) => doc);
    const top = new Set(lexical.slice(0, CANDIDATES));
    shared.push(semantic.slice(0, CANDIDATES).filter(doc => top.has(doc)).length);
    return rrf([lexical, semantic]).slice(0, DEPTH).map(entry => [entry.id, entry.score] as [string, number]);
  });
  systems.hybrid = await save("hybrid", hybrid);
  overlap = { depth: CANDIDATES, shared_documents: stats(shared) };
}

const metrics = Object.fromEntries(Object.entries(systems).map(([name, run]) => [name, evaluate(qrels, run).aggregate]));
const gain = (name: string) => metrics[name] && metrics.bm25 ? metrics[name]!.recall_100 - metrics.bm25.recall_100 : null;
const record = {
  dataset: config.dataset,
  counts: { documents: n, queries: queries.length },
  inputs: {
    queries: { path: config.queries, sha256: queryHash }, qrels: { path: config.qrels, sha256: qrelsHash },
    bm25_run: config.bm25 ? { path: config.bm25, sha256: await hashFile(config.bm25) } : null, dense: dense.meta,
  },
  fusion: { method: "reciprocal rank fusion", k: 60, depth: DEPTH, inputs: ["bm25", "dense exact"] },
  metrics,
  recall_100_gain_over_bm25: { dense: gain("dense"), hybrid: gain("hybrid") },
  overlap,
  query_embedding_ms: stats(embedMs),
  exact: { offline_scan_ms: scanMs, threads, online_latency_ms_k100: stats(exactMs), online_sample_queries: sample.length },
  ann,
  memory: memoryUsage(),
  tracing: "off",
  machine,
};
await Bun.write(`${out}.json`, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ dataset: config.dataset, metrics, recall_100_gain_over_bm25: record.recall_100_gain_over_bm25 }));
