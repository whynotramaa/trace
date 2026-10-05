import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Index, MetricKind, ScalarKind } from "usearch";
import { args } from "../eval/io.ts";

export type DenseMode = "exact" | "ann";
export interface DenseHit { row: number; score: number }
export const HNSW = { connectivity: 16, expansion_add: 128 };

class TopRows {
  readonly scores: Float64Array; readonly rows: Int32Array;
  size = 0;
  constructor(readonly k: number) { this.scores = new Float64Array(k); this.rows = new Int32Array(k); }
  private less(i: number, j: number) { return this.scores[i]! < this.scores[j]! || (this.scores[i] === this.scores[j] && this.rows[i]! > this.rows[j]!); }
  private swap(i: number, j: number) {
    const s = this.scores[i]!, r = this.rows[i]!;
    this.scores[i] = this.scores[j]!; this.rows[i] = this.rows[j]!; this.scores[j] = s; this.rows[j] = r;
  }
  add(score: number, row: number) {
    if (this.size === this.k && score <= this.scores[0]!) return;
    let i: number;
    if (this.size < this.k) i = this.size++;
    else {
      i = 0;
      this.scores[0] = score; this.rows[0] = row;
      for (;;) {
        const left = i * 2 + 1, right = left + 1;
        if (left >= this.size) return;
        const smaller = right < this.size && this.less(right, left) ? right : left;
        if (!this.less(smaller, i)) return;
        this.swap(i, smaller); i = smaller;
      }
    }
    this.scores[i] = score; this.rows[i] = row;
    while (i > 0) { const parent = (i - 1) >>> 1; if (!this.less(i, parent)) break; this.swap(i, parent); i = parent; }
  }
  sorted(): DenseHit[] {
    return Array.from({ length: this.size }, (_, i) => ({ row: this.rows[i]!, score: this.scores[i]! })).sort((a, b) => b.score - a.score || a.row - b.row);
  }
}

export class DenseIndex {
  readonly meta: { model: string; revision: string; dimensions: number; documents: number; quantization: string; corpus: { path: string; sha256: string; bytes: number } };
  readonly vectors: Int8Array; readonly scales: Float32Array;
  private ann?: { index: Index; ef: number };

  constructor(readonly directory: string) {
    this.meta = JSON.parse(readFileSync(join(directory, "dense.json"), "utf8"));
    const vectors = Bun.mmap(join(directory, "vectors.i8")), scales = Bun.mmap(join(directory, "scales.f32"));
    this.vectors = new Int8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength);
    this.scales = new Float32Array(scales.buffer, scales.byteOffset, scales.byteLength / 4);
    if (this.scales.length !== this.meta.documents || this.vectors.length !== this.meta.documents * this.meta.dimensions) throw new Error("Dense files do not match dense.json");
  }

  get annPath(): string { return join(this.directory, "hnsw.usearch"); }

  scan(queries: Float32Array, k: number, from = 0, to = this.meta.documents, exclude?: Int32Array): DenseHit[][] {
    const d = this.meta.dimensions, count = queries.length / d, v = this.vectors, s = this.scales;
    const heaps = Array.from({ length: count }, () => new TopRows(k));
    for (let row = from; row < to; row++) {
      const base = row * d, scale = s[row]!;
      for (let q = 0; q < count; q++) {
        if (exclude && exclude[q] === row) continue;
        let dot = 0;
        for (let j = 0, at = q * d; j < d; j++) dot += queries[at + j]! * v[base + j]!;
        heaps[q]!.add(dot * scale, row);
      }
    }
    return heaps.map(heap => heap.sorted());
  }

  score(query: Float32Array, row: number): number {
    const d = this.meta.dimensions, base = row * d;
    let dot = 0;
    for (let j = 0; j < d; j++) dot += query[j]! * this.vectors[base + j]!;
    return dot * this.scales[row]!;
  }

  search(query: Float32Array, k: number, mode: DenseMode = "exact", exclude = -1): DenseHit[] {
    if (mode === "exact") return this.scan(query, k, 0, this.meta.documents, Int32Array.of(exclude))[0]!;
    const ef = Math.max(k + 1, 128);
    if (!this.ann || this.ann.ef !== ef) {
      const index = new Index({ dimensions: this.meta.dimensions, metric: MetricKind.Cos, quantization: ScalarKind.I8, multi: false, expansion_search: ef, ...HNSW });
      index.view(this.annPath);
      this.ann = { index, ef };
    }
    let max = 0;
    for (const value of query) max = Math.max(max, Math.abs(value));
    const quantized = Int8Array.from(query, value => Math.round(value / (max || 1) * 127));
    const keys = this.ann.index.search(quantized, k + 1, 1).keys;
    const hits: DenseHit[] = [];
    for (const key of keys) { const row = Number(key); if (row !== exclude && row < this.meta.documents) hits.push({ row, score: this.score(query, row) }); }
    return hits.sort((a, b) => b.score - a.score || a.row - b.row).slice(0, k);
  }
}

export function rrf<T>(lists: T[][], k = 60): { id: T; score: number; ranks: (number | null)[] }[] {
  const fused = new Map<T, { id: T; score: number; ranks: (number | null)[] }>();
  lists.forEach((list, which) => list.forEach((id, rank) => {
    let entry = fused.get(id);
    if (!entry) fused.set(id, (entry = { id, score: 0, ranks: lists.map(() => null) }));
    entry.score += 1 / (k + rank + 1);
    entry.ranks[which] = rank + 1;
  }));
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

if (import.meta.main) {
  const config = args(["vectors"], ["vectors", "threads"]);
  const dense = new DenseIndex(config.vectors!), d = dense.meta.dimensions, n = dense.meta.documents;
  const threads = Number(config.threads ?? navigator.hardwareConcurrency);
  const index = new Index({ dimensions: d, metric: MetricKind.Cos, quantization: ScalarKind.I8, multi: false, expansion_search: 128, ...HNSW });
  const started = performance.now();
  for (let from = 0; from < n; from += 100_000) {
    const to = Math.min(n, from + 100_000);
    const keys = new BigUint64Array(to - from).map((_, i) => BigInt(from + i));
    index.add(keys, Array.from({ length: to - from }, (_, i) => dense.vectors.subarray((from + i) * d, (from + i + 1) * d)), threads);
    console.error(`HNSW: ${to.toLocaleString()} / ${n.toLocaleString()}`);
  }
  index.save(dense.annPath);
  const build = { ...HNSW, metric: "cos", quantization: "i8", documents: n, threads, build_ms: performance.now() - started, bytes: Bun.file(dense.annPath).size, rss_bytes: process.memoryUsage().rss };
  await Bun.write(join(config.vectors!, "hnsw.json"), `${JSON.stringify(build, null, 2)}\n`);
  console.log(JSON.stringify(build));
}
