import page from "../web/index.html";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDiskIndex } from "../engine/build.ts";
import { DiskIndex, MODES, type Mode } from "../engine/disk.ts";
import { createApi } from "./api.ts";
import { DenseIndex, type DenseMode } from "../engine/dense.ts";
import { Embedder, Reranker } from "./neural.ts";
import { args } from "../eval/io.ts";

const config = args([], ["index", "corpus", "port", "workers", "mode", "trace", "vectors", "dense", "rerank", "models"]);
const port = Number(config.port ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be 1..65535");
const workers = Number(config.workers ?? 1);
if (!Number.isInteger(workers) || workers < 1) throw new Error("--workers must be a positive integer");
const mode = (config.mode ?? "maxscore") as Mode;
if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
if (config.trace && config.trace !== "on" && config.trace !== "off") throw new Error("--trace must be on or off");
const directory = config.index ?? "data/index/product";
const denseMode = (config.dense ?? "exact") as DenseMode;
if (denseMode !== "exact" && denseMode !== "ann") throw new Error("--dense must be exact or ann");
const rerankDepth = Number(config.rerank ?? 0);
if (!Number.isInteger(rerankDepth) || rerankDepth < 0 || rerankDepth > 100) throw new Error("--rerank must be an integer from 0 to 100");
const models = config.models ?? "data/models";

if (process.env.TRACE_WORKER) {
  const index = new DiskIndex(directory);
  const threads = workers > 1 ? Math.max(1, Math.floor(navigator.hardwareConcurrency / workers)) : 0;
  let dense;
  if (config.vectors) {
    const vectors = new DenseIndex(config.vectors);
    if (vectors.meta.corpus.sha256 !== index.meta.corpus.sha256 || vectors.meta.documents !== index.meta.documents) throw new Error("--vectors were not built from this index's corpus");
    dense = { index: vectors, embedder: await Embedder.open(models, threads), mode: denseMode };
  }
  const rerank = rerankDepth ? { model: await Reranker.open(models, threads), depth: rerankDepth } : undefined;
  const api = createApi(index, { mode, tracing: config.trace !== "off", traceDirectory: process.env.TRACE_STORE, dense, rerank });
  const server = Bun.serve({ port, hostname: "127.0.0.1", reusePort: workers > 1, routes: { "/": page }, fetch: api, development: process.execArgv.includes("--hot") });
  console.log(`Trace worker ${process.pid}: ${server.url} · ${index.meta.documents.toLocaleString()} documents · ${[mode, dense && `dense ${denseMode}`, rerank && `rerank ${rerankDepth}`].filter(Boolean).join(" · ")}`);
} else {
  if (!(await Bun.file(join(directory, "meta.json")).exists())) {
    const corpus = config.corpus ?? "data/normalized/product.jsonl";
    console.log(`Building the disk index for ${corpus} in ${directory}`);
    await buildDiskIndex(corpus, directory, { k1: 0.9, b: 0.4 });
  }
  const store = workers > 1 ? await mkdtemp(join(tmpdir(), "trace-store-")) : undefined;
  const script = Bun.main.startsWith("/$bunfs") ? [] : [Bun.main];
  const children = Array.from({ length: workers }, () => Bun.spawn([process.execPath, ...process.execArgv, ...script, ...process.argv.slice(2)], {
    env: { ...process.env, TRACE_WORKER: "1", ...(store ? { TRACE_STORE: store } : {}) }, stdio: ["inherit", "inherit", "inherit"],
  }));
  const stop = async () => {
    for (const child of children) child.kill();
    if (store) await rm(store, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await Promise.race(children.map(child => child.exited));
  await stop();
}
