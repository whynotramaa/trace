import { resolve } from "node:path";
import MiniSearch from "minisearch";
import { create, insertMultiple, search } from "@orama/orama";
import { validateDocument } from "../engine/document.ts";
import { collectEnvironment, hashFile, memoryUsage } from "./environment.ts";
import { args, lines } from "../eval/io.ts";
import { evaluate, loadQrels } from "../eval/metrics.ts";
import { loadQueries } from "../eval/run.ts";

const config = args(["library", "corpus", "queries", "dataset", "out"], ["library", "corpus", "queries", "qrels", "dataset", "out", "k", "repeats", "limit-gib"]);
const library = config.library!;
if (library !== "minisearch" && library !== "orama") throw new Error("--library must be minisearch or orama");
const k = Number(config.k ?? 10), repeats = Number(config.repeats ?? 3), limit = Number(config["limit-gib"] ?? 10) * 2 ** 30;
const [inputQueries, qrels, machine] = await Promise.all([loadQueries(config.queries!), config.qrels ? loadQrels(config.qrels) : null, collectEnvironment(resolve(import.meta.dir, ".."))]);
const queries = qrels ? inputQueries.filter(query => qrels.has(query.id)) : inputQueries;
const excludeSelf = config.dataset!.startsWith("cqadupstack-");
const before = memoryUsage();
const versions = { minisearch: (await Bun.file("node_modules/minisearch/package.json").json()).version, orama: (await Bun.file("node_modules/@orama/orama/package.json").json()).version };

const mini = new MiniSearch<{ id: string; text: string }>({ fields: ["text"], storeFields: [] });
const orama = create({ schema: { text: "string" } as const });
let batch: { id: string; text: string }[] = [], count = 0, peak = 0;
const flush = async () => {
  if (library === "minisearch") mini.addAll(batch); else await insertMultiple(orama, batch, batch.length);
  count += batch.length;
  batch = [];
  peak = Math.max(peak, process.memoryUsage().rss);
  if (peak > limit) {
    await Bun.write(`${config.out}.json`, `${JSON.stringify({ library, dataset: config.dataset, status: "memory_limit", documents_indexed: count, limit_bytes: limit, peak_rss_bytes: peak, versions, machine }, null, 2)}\n`);
    console.log(`${library} exceeded ${limit} bytes after ${count} documents`);
    process.exit(0);
  }
};
const buildStarted = performance.now();
for await (const line of lines(config.corpus!)) {
  const document = validateDocument(JSON.parse(line));
  batch.push({ id: document.doc_id, text: `${document.title} ${document.body}` });
  if (batch.length === 10_000) await flush();
}
await flush();
const buildMs = performance.now() - buildStarted;
Bun.gc(true);
const afterBuild = memoryUsage();

const run = async (text: string, self: string | undefined) => {
  const limitK = k + (self === undefined ? 0 : 1);
  const hits = library === "minisearch"
    ? mini.search(text).slice(0, limitK).map(hit => ({ id: String(hit.id), score: hit.score }))
    : (await search(orama, { term: text, limit: limitK, threshold: 1 })).hits.map(hit => ({ id: hit.id, score: hit.score }));
  return hits.filter(hit => hit.id !== self).slice(0, k);
};
const latencies: number[] = [], trec: string[] = [];
for (const query of queries.slice(0, 100)) await run(query.text, excludeSelf ? query.id : undefined);
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const query of queries) {
    const started = performance.now();
    const hits = await run(query.text, excludeSelf ? query.id : undefined);
    latencies.push(performance.now() - started);
    if (repeat === 0) hits.forEach((hit, rank) => trec.push(`${query.id} Q0 ${hit.id} ${rank + 1} ${hit.score} ${library}`));
  }
}
latencies.sort((a, b) => a - b);
const at = (fraction: number) => latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * fraction))]!;
const runs = new Map<string, Map<string, number>>();
for (const line of trec) {
  const [qid, , doc, , score] = line.split(" ");
  if (!runs.has(qid!)) runs.set(qid!, new Map());
  runs.get(qid!)!.set(doc!, Number(score));
}
await Bun.write(`${config.out}.run.trec`, trec.join("\n") + "\n");
const record = {
  library, versions, dataset: config.dataset, status: "complete", k, documents: count, queries: queries.length, repeats,
  corpus: { path: config.corpus, sha256: await hashFile(config.corpus!) },
  build_ms: buildMs, heap_bytes_after_build: afterBuild.heap_used_bytes - before.heap_used_bytes, rss_after_build: afterBuild.rss_bytes, peak_sampled_rss_bytes: peak,
  latency_ms: { mean: latencies.reduce((a, b) => a + b, 0) / latencies.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: latencies.at(-1) },
  quality: qrels ? { note: `Top ${k} only; each library uses its own tokenizer and scoring.`, ...evaluate(qrels, runs).aggregate } : null,
  machine,
};
await Bun.write(`${config.out}.json`, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ library, dataset: config.dataset, build_ms: buildMs, latency_ms: record.latency_ms, quality: record.quality }));
