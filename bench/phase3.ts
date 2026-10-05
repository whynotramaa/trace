import { mkdir, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildIndex } from "../engine/index.ts";
import { DiskIndex, MODES, type Mode } from "../engine/disk.ts";
import { collectEnvironment, hashFile, memoryUsage } from "./environment.ts";
import { args } from "../eval/io.ts";
import { loadQrels } from "../eval/metrics.ts";
import { loadQueries } from "../eval/run.ts";

const SHARED = ["lexicon.bin", "lexicon.u32", "df.u32", "norms.u8", "docids.bin", "docids.u32", "rank.u32", "byrank.u32"];
const LAYOUT: Record<Mode, string[]> = {
  flat: ["flat.doc.u32", "flat.tf.u16", "flat.off.f64"],
  vbyte: ["vbyte.bin", "vbyte.off.f64"],
  block: ["block.words.u32", "block.term.u32", "block.last.u32", "block.off.u32", "block.width.u8"],
  maxscore: ["block.words.u32", "block.term.u32", "block.last.u32", "block.off.u32", "block.width.u8", "block.max.f32", "term.max.f32"],
  bmw: ["block.words.u32", "block.term.u32", "block.last.u32", "block.off.u32", "block.width.u8", "block.max.f32", "term.max.f32"],
};

function percentile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction, lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function stats(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted.at(-1)! };
}

async function dropCache(files: string[]) {
  for (const file of files) {
    const child = Bun.spawn(["dd", "if=/dev/null", `of=${file}`, "oflag=nocache", "conv=notrunc,fdatasync", "count=0", "status=none"]);
    if (await child.exited !== 0) throw new Error(`Could not drop page cache for ${file}`);
  }
}

async function residentBytes(files: string[]): Promise<number> {
  const child = Bun.spawn(["fincore", "--bytes", "--noheadings", "--output", "RES", ...files], { stdout: "pipe" });
  const text = await new Response(child.stdout).text();
  await child.exited;
  return text.trim().split("\n").reduce((sum, line) => sum + Number(line.trim() || 0), 0);
}

const config = args(["queries", "dataset", "mode", "out"], ["queries", "qrels", "dataset", "mode", "out", "index", "corpus", "k", "repeats", "warmup", "k1", "b"]);
const mode = config.mode as Mode | "heap";
if (mode !== "heap" && !MODES.includes(mode)) throw new Error(`--mode must be heap or one of ${MODES.join(", ")}`);
const k = Number(config.k ?? 10), repeats = Number(config.repeats ?? 3), warmupCount = Number(config.warmup ?? 100);
const [inputQueries, qrels, queryHash, machine] = await Promise.all([
  loadQueries(config.queries!), config.qrels ? loadQrels(config.qrels) : null, hashFile(config.queries!), collectEnvironment(resolve(import.meta.dir, "..")),
]);
const queries = qrels ? inputQueries.filter(query => qrels.has(query.id)) : inputQueries;
const excludeSelf = config.dataset!.startsWith("cqadupstack-");
const before = memoryUsage();

type Result = { hits: { doc_id: string; score: number }[]; candidate_count: number; postings_visited: number; terms?: { blocks_decoded: number; blocks_skipped: number }[]; timings: { total_ms: number } };
let search: (text: string, id: string) => Result;
let index: Record<string, unknown>;
let files: string[] = [];
const openStarted = performance.now();
if (mode === "heap") {
  if (!config.corpus) throw new Error("--corpus is required for the heap index");
  const parameters = { k1: Number(config.k1 ?? 0.9), b: Number(config.b ?? 0.4) };
  const heap = await buildIndex(config.corpus);
  const startupMs = performance.now() - openStarted;
  Bun.gc(true);
  const after = memoryUsage();
  index = { kind: "heap", corpus: config.corpus, corpus_sha256: heap.corpusHash, documents: heap.documents.length, parameters, startup_ms: startupMs,
    heap_bytes_after_build: after.heap_used_bytes - before.heap_used_bytes, rss_after_build: after.rss_bytes };
  search = (text, id) => heap.search(text, { k, parameters, exclude: excludeSelf ? id : undefined });
} else {
  const directory = config.index!;
  files = [...SHARED, ...LAYOUT[mode]].map(name => join(directory, name));
  await dropCache(files);
  const residentBefore = await residentBytes(files);
  const disk = new DiskIndex(directory);
  const openMs = performance.now() - openStarted;
  const bytes = (names: string[]) => names.reduce((sum, name) => sum + disk.meta.sizes[name]!, 0);
  index = { kind: "disk", directory, corpus: disk.meta.corpus, documents: disk.meta.documents, parameters: disk.meta.parameters, open_ms: openMs,
    shared_bytes: bytes(SHARED), postings_bytes: bytes(LAYOUT[mode]), resident_before_open: residentBefore };
  search = (text, id) => disk.search(text, { k, mode, exclude: excludeSelf ? id : undefined });
}

const runPath = `${config.out}.run.trec`, temporary = `${runPath}.${process.pid}.part`;
await mkdir(dirname(resolve(runPath)), { recursive: true });
const writer = Bun.file(temporary).writer();
const passes: { latency: number[]; visited: number[]; scored: number[]; decoded: number[]; skipped: number[] }[] = [];
const firstQueryStarted = performance.now();
search(queries[0]!.text, queries[0]!.id);
const firstQueryMs = performance.now() - firstQueryStarted;
for (let repeat = 0; repeat <= repeats; repeat++) {
  if (repeat === 1) for (const query of queries.slice(0, warmupCount)) search(query.text, query.id);
  const pass = { latency: [] as number[], visited: [] as number[], scored: [] as number[], decoded: [] as number[], skipped: [] as number[] };
  for (const query of queries) {
    const result = search(query.text, query.id);
    pass.latency.push(result.timings.total_ms);
    pass.visited.push(result.postings_visited);
    pass.scored.push(result.candidate_count);
    pass.decoded.push(result.terms?.reduce((sum, term) => sum + term.blocks_decoded, 0) ?? 0);
    pass.skipped.push(result.terms?.reduce((sum, term) => sum + term.blocks_skipped, 0) ?? 0);
    if (repeat === 0) result.hits.forEach((hit, rank) => writer.write(`${query.id} Q0 ${hit.doc_id} ${rank + 1} ${hit.score} trace\n`));
  }
  passes.push(pass);
  console.error(`${config.dataset} ${mode} k=${k}: pass ${repeat}/${repeats}, P50 ${stats(pass.latency)!.p50.toFixed(3)} ms`);
}
await writer.end();
await rename(temporary, runPath);
const warm = passes.slice(1);
const flat = (key: keyof (typeof passes)[number]) => warm.flatMap(pass => pass[key]);
const record = {
  dataset: config.dataset, mode, k, queries: { path: config.queries, sha256: queryHash, count: queries.length, judged_only: Boolean(qrels) },
  index, first_query_ms: firstQueryMs,
  cold_pass: { note: "First full pass after dropping the index files from the page cache.", latency_ms: stats(passes[0]!.latency) },
  warm: { warmup_queries: Math.min(warmupCount, queries.length), repeats, latency_ms: stats(flat("latency")), postings_visited: stats(flat("visited")),
    docs_scored: stats(flat("scored")), blocks_decoded: stats(flat("decoded")), blocks_skipped: stats(flat("skipped")) },
  memory: { before_index: before, after_benchmark: memoryUsage(), resident_index_bytes: files.length ? await residentBytes(files) : null },
  run: { path: runPath, sha256: await hashFile(runPath) },
  tracing: "off", machine,
};
await Bun.write(`${config.out}.json`, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ mode, k, warm: record.warm.latency_ms, run: record.run.sha256 }));
