import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { hashFile } from "./environment.ts";

const directory = "artifacts/phase3";
const ORDER = ["heap", "flat", "vbyte", "block", "maxscore", "bmw"];
type Stat = { p50: number; p95: number; p99: number; mean: number } | null;
type Record = {
  dataset: string; mode: string; k: number; queries: { count: number }; first_query_ms: number;
  index: { kind: string; corpus: string | { path: string }; documents: number; open_ms?: number; startup_ms?: number; postings_bytes?: number; shared_bytes?: number; heap_bytes_after_build?: number };
  cold_pass: { latency_ms: Stat }; warm: { latency_ms: Stat; postings_visited: Stat; docs_scored: Stat; blocks_decoded: Stat; blocks_skipped: Stat };
  memory: { after_benchmark: { rss_bytes: number; heap_used_bytes: number } }; run: { path: string; sha256: string };
};

const records: (Record & { group: string })[] = [];
for (const name of (await readdir(directory)).sort()) {
  const match = /^(.*)-(heap|flat|vbyte|block|maxscore|bmw)-k(\d+)\.json$/.exec(name);
  if (!match) continue;
  const record = await Bun.file(join(directory, name)).json() as Record;
  const corpus = typeof record.index.corpus === "string" ? record.index.corpus : record.index.corpus.path;
  records.push({ ...record, group: `${match[1]} · ${record.index.documents.toLocaleString("en-US")} docs · k=${match[3]} · ${corpus.split("/").at(-1)}` });
}

const groups = new Map<string, typeof records>();
for (const record of records) groups.set(record.group, [...(groups.get(record.group) ?? []), record]);
const gate: { group: string; reference: string; sha256: string; modes: { mode: string; sha256: string; identical: boolean }[]; passed: boolean }[] = [];
const ms = (value: number | undefined) => value === undefined ? "–" : value < 10 ? value.toFixed(2) : value.toFixed(1);
const count = (value: number | undefined) => value === undefined ? "–" : Math.round(value).toLocaleString("en-US");
const mib = (value: number | undefined) => value === undefined ? "–" : (value / 2 ** 20).toFixed(1);
const lines: string[] = [];
for (const [group, rows] of groups) {
  rows.sort((a, b) => ORDER.indexOf(a.mode) - ORDER.indexOf(b.mode));
  const reference = rows.find(row => row.mode === "flat") ?? rows[0]!;
  const modes = rows.map(row => ({ mode: row.mode, sha256: row.run.sha256, identical: row.run.sha256 === reference.run.sha256 }));
  gate.push({ group, reference: reference.mode, sha256: reference.run.sha256, modes, passed: modes.every(mode => mode.identical) });
  lines.push(`### ${group}`, "", `${rows[0]!.queries.count.toLocaleString("en-US")} queries. Warm latency is three passes after a 100-query warm-up. Cold is the first pass after dropping the index files from the page cache.`, "",
    "| Mode | Warm P50 ms | P95 | P99 | Cold P50 ms | Cold P95 | Postings scored | Docs scored | Blocks decoded | Blocks skipped | Postings MiB | Other index MiB | Heap MiB | RSS MiB | Open ms | Same top-k as flat |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of rows) {
    const warm = row.warm, heap = row.index.heap_bytes_after_build;
    lines.push(`| ${row.mode} | ${ms(warm.latency_ms?.p50)} | ${ms(warm.latency_ms?.p95)} | ${ms(warm.latency_ms?.p99)} | ${row.mode === "heap" ? "–" : ms(row.cold_pass.latency_ms?.p50)} | ${row.mode === "heap" ? "–" : ms(row.cold_pass.latency_ms?.p95)} | ${count(warm.postings_visited?.mean)} | ${count(warm.docs_scored?.mean)} | ${row.mode === "heap" ? "–" : count(warm.blocks_decoded?.mean)} | ${row.mode === "heap" ? "–" : count(warm.blocks_skipped?.mean)} | ${mib(row.index.postings_bytes)} | ${mib(row.index.shared_bytes)} | ${mib(heap ?? row.memory.after_benchmark.heap_used_bytes)} | ${mib(row.memory.after_benchmark.rss_bytes)} | ${ms(row.index.open_ms ?? row.index.startup_ms)} | ${row.run.sha256 === reference.run.sha256 ? "yes" : "**no**"} |`);
  }
  lines.push("");
}

const phase1 = "artifacts/msmarco.run.trec", full = records.find(row => row.dataset === "msmarco" && row.k === 1000 && row.mode === "flat" && row.index.documents === 8_841_823);
const phase1Check = full && await Bun.file(phase1).exists() ? { phase1_run: phase1, phase1_sha256: await hashFile(phase1), phase3_sha256: full.run.sha256 } : null;
const result = { groups: gate, phase1: phase1Check && { ...phase1Check, identical: phase1Check.phase1_sha256 === phase1Check.phase3_sha256 },
  passed: gate.length > 0 && gate.every(group => group.passed) && (!phase1Check || phase1Check.phase1_sha256 === phase1Check.phase3_sha256) };
await Bun.write(join(directory, "gate.json"), `${JSON.stringify(result, null, 2)}\n`);

const libraries: string[] = [];
for (const name of (await readdir(directory)).sort()) {
  if (!/-(minisearch|orama)-k\d+\.json$/.test(name)) continue;
  const row = await Bun.file(join(directory, name)).json();
  libraries.push(row.status !== "complete"
    ? `| ${row.dataset} | ${row.library} ${row.versions[row.library]} | stopped at ${count(row.documents_indexed)} docs | – | – | – | – | ${mib(row.peak_sampled_rss_bytes)} | – |`
    : `| ${row.dataset} | ${row.library} ${row.versions[row.library]} | ${count(row.documents)} | ${(row.build_ms / 1000).toFixed(1)} | ${ms(row.latency_ms.p50)} | ${ms(row.latency_ms.p95)} | ${ms(row.latency_ms.p99)} | ${mib(row.peak_sampled_rss_bytes)} | ${row.dataset.startsWith("cqadupstack") && row.quality ? row.quality.ndcg_cut_10.toFixed(4) : "–"} |`);
}
if (libraries.length) lines.push("### MiniSearch and Orama", "", "| Dataset | Library | Docs | Build s | P50 ms | P95 | P99 | Peak RSS MiB | nDCG@10 |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |", ...libraries, "");

const serving: string[] = [];
for (const name of (await readdir(directory)).sort()) {
  if (!/^serve-workers\d+\.json$/.test(name)) continue;
  const row = await Bun.file(join(directory, name)).json();
  serving.push(`| ${row.label} | ${row.concurrency} | ${row.seconds} | ${count(row.requests)} | ${row.errors} | ${row.qps.toFixed(1)} | ${ms(row.latency_ms.p50)} | ${ms(row.latency_ms.p95)} | ${ms(row.latency_ms.p99)} |`);
}
if (serving.length) lines.push("### Serving", "", "| Workers | Concurrency | Seconds | Requests | Errors | QPS | P50 ms | P95 | P99 |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |", ...serving, "");

console.log(lines.join("\n"));
console.error(JSON.stringify({ passed: result.passed, phase1: result.phase1 }, null, 2));
