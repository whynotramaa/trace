import { resolve } from "node:path";
import { collectEnvironment } from "./environment.ts";
import { args } from "../eval/io.ts";
import { loadQueries } from "../eval/run.ts";

const config = args(["url", "queries", "out"], ["url", "queries", "out", "concurrency", "seconds", "warmup", "k", "label"]);
const concurrency = Number(config.concurrency ?? 32), seconds = Number(config.seconds ?? 30), warmup = Number(config.warmup ?? 5), k = Number(config.k ?? 10);
const queries = await loadQueries(config.queries!);
const latencies: number[] = [];
let errors = 0, next = 0, measuring = false;
const deadline = { warm: performance.now() + warmup * 1000, end: performance.now() + (warmup + seconds) * 1000 };

async function client() {
  while (performance.now() < deadline.end) {
    const query = queries[next++ % queries.length]!;
    const started = performance.now();
    const response = await fetch(`${config.url}/search?k=${k}&q=${encodeURIComponent(query.text.slice(0, 512))}`);
    await response.arrayBuffer();
    if (started >= deadline.warm && !measuring) measuring = true;
    if (!measuring) continue;
    if (!response.ok) errors++;
    else latencies.push(performance.now() - started);
  }
}

await Promise.all(Array.from({ length: concurrency }, client));
latencies.sort((a, b) => a - b);
const at = (fraction: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))]!;
const record = {
  label: config.label ?? null, url: config.url, concurrency, seconds, warmup_seconds: warmup, k, requests: latencies.length, errors,
  qps: latencies.length / seconds, latency_ms: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: latencies.at(-1) },
  note: "Client-side latency from a load generator on the same machine. Includes HTTP, JSON, and document snippets.",
  machine: await collectEnvironment(resolve(import.meta.dir, "..")),
};
await Bun.write(config.out!, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ label: record.label, qps: record.qps, latency_ms: record.latency_ms, errors }));
