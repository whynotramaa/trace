import { mkdir, rename, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { args } from "./io.ts";

export const cqaSites = ["android", "english", "gaming", "gis", "mathematica", "physics", "programmers", "stats", "tex", "unix", "webmasters", "wordpress"];
const cqaRevision = "e84b7220ce5a4e6c49aeb568983b0ec5a7584c2c";
const castorini = "https://raw.githubusercontent.com/castorini/eval/master";

async function hash(path: string, algorithm = "sha256"): Promise<string> {
  const digest = createHash(algorithm);
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function download(url: string, path: string, expected?: string, algorithm = "sha256") {
  await mkdir(dirname(path), { recursive: true });
  if (await Bun.file(path).exists()) {
    const digest = await hash(path, algorithm);
    if (!expected || digest === expected) return;
    throw new Error(`Existing ${path} has an invalid ${algorithm}; remove it before retrying`);
  }
  const temporary = `${path}.${process.pid}.part`;
  try {
    // curl handles the dataset CDN redirects reliably and is already available.
    const process = Bun.spawn(["curl", "-fL", "--retry", "2", "--max-time", "180", "--silent", "--show-error", url, "-o", temporary], { stdout: "ignore", stderr: "pipe" });
    const [error, code] = await Promise.all([new Response(process.stderr).text(), process.exited]);
    if (code !== 0) throw new Error(`Download failed for ${url}: ${error}`);
    if (expected && await hash(temporary, algorithm) !== expected) throw new Error(`Checksum mismatch for ${url}`);
    await rename(temporary, path);
    await Bun.write(`${path}.source.json`, JSON.stringify({ url, sha256: await hash(path), fetched_at: new Date().toISOString() }, null, 2));
  } finally { await rm(temporary, { force: true }); }
}

async function parquetToJSONL(path: string, output: string) {
  const file = await asyncBufferFromFile(path);
  const metadata = await parquetMetadataAsync(file);
  const temporary = `${output}.${process.pid}.part`;
  const writer = Bun.file(temporary).writer();
  try {
    // Read bounded batches. The source is a published dataset snapshot, not a crawler.
    for (let start = 0; start < Number(metadata.num_rows); start += 4096) {
      const rows = await parquetReadObjects({ file, metadata, compressors, rowStart: start, rowEnd: Math.min(start + 4096, Number(metadata.num_rows)) });
      for (const row of rows) writer.write(`${JSON.stringify(row)}\n`);
      await writer.flush();
    }
    await writer.end();
    await rename(temporary, output);
  } catch (error) { await writer.end(); await rm(temporary, { force: true }); throw error; }
}

async function fetchCQA(root: string) {
  // Two simultaneous sites keep the importer workload and network buffers bounded.
  for (let offset = 0; offset < cqaSites.length; offset += 2) {
    await Promise.all(cqaSites.slice(offset, offset + 2).map(async site => {
      const base = join(root, "cqadupstack", site);
      for (const kind of ["corpus", "queries"]) {
        const treeURL = `https://huggingface.co/api/datasets/BeIR/cqadupstack/tree/${cqaRevision}/${site}/${kind}`;
        const response = await fetch(treeURL);
        if (!response.ok) throw new Error(`${treeURL}: ${response.status}`);
        const entries = await response.json() as { type: string; path: string; lfs?: { oid: string } }[];
        const parts = entries.filter(entry => entry.type === "file" && entry.path.endsWith(".parquet"));
        if (parts.length !== 1) throw new Error(`Expected one ${kind} parquet for ${site}`);
        const entry = parts[0]!;
        const path = join(base, `${kind}.parquet`);
        await download(`https://huggingface.co/datasets/BeIR/cqadupstack/resolve/${cqaRevision}/${entry.path}?download=true`, path, entry.lfs?.oid);
        await parquetToJSONL(path, join(base, `${kind}.jsonl`));
      }
      await download(`${castorini}/qrels/qrels.beir-v1.0.0-cqadupstack-${site}.test.txt`, join(base, "qrels.txt"));
      console.log(`Ready: cqadupstack-${site}`);
    }));
  }
}

async function main() {
  const config = args(["dataset"], ["dataset", "out"]);
  const root = config.out ?? "data/raw";
  if (config.dataset === "cqadupstack") return fetchCQA(root);
  if (config.dataset === "reference") {
    await download("https://rgw.cs.uwaterloo.ca/pyserini/data/anserini.covid-r3.abstract.qq.bm25.txt", join(root, "anserini.covid-r3.abstract.qq.bm25.txt"), "d08d85c87e30d6c4abf54799806d282f", "md5");
    await download(`${castorini}/qrels/qrels.covid-round3-cumulative.txt`, join(root, "qrels.covid-round3-cumulative.txt"));
    return;
  }
  if (config.dataset === "msmarco") {
    await download("https://msmarco.z22.web.core.windows.net/msmarcoranking/collectionandqueries.tar.gz", join(root, "collectionandqueries.tar.gz"), "31644046b18952c1386cd4564ba2ae69", "md5");
    await download(`${castorini}/qrels/qrels.msmarco-passage.dev-subset.txt`, join(root, "qrels.msmarco-passage.dev-subset.txt"));
    await download(`${castorini}/topics/topics.msmarco-passage.dev-subset.txt`, join(root, "topics.msmarco-passage.dev-subset.tsv"));
    return;
  }
  if (config.dataset === "product") {
    await download("https://archive.org/download/stackexchange/cs.stackexchange.com.7z", join(root, "cs.stackexchange.com.7z"), "f7cb3c523ae1a4ed1c341faeb2e6d3c9", "md5");
    await download("https://api.stackexchange.com/2.3/questions?order=desc&sort=votes&site=stackoverflow&pagesize=100&filter=withbody", join(root, "stackoverflow-questions.json"));
    return;
  }
  if (config.dataset === "models") {
    const models = config.out ?? "data/models";
    const bge = "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/5c38ec7c405ec4b44b94cc5a9bb96e735b38267a";
    const minilm = "https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2/resolve/233902d25c440f23af6f7d6e94d2946bac0bee0a";
    await download(`${bge}/onnx/model.onnx`, join(models, "bge-small-en-v1.5", "model.onnx"), "828e1496d7fabb79cfa4dcd84fa38625c0d3d21da474a00f08db0f559940cf35");
    await download(`${bge}/vocab.txt`, join(models, "bge-small-en-v1.5", "vocab.txt"));
    await download(`${minilm}/onnx/model_quint8_avx2.onnx`, join(models, "ms-marco-MiniLM-L6-v2", "model.onnx"), "c80a8b34256ea453093d612e3ac48d3d965a0c0a48c7906709af8b8e28461bf9");
    await download(`${minilm}/vocab.txt`, join(models, "ms-marco-MiniLM-L6-v2", "vocab.txt"));
    return;
  }
  throw new Error("--dataset must be reference, cqadupstack, msmarco, product, or models");
}

if (import.meta.main) await main();
