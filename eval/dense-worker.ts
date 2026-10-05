import { DenseIndex } from "../engine/dense.ts";

declare const self: Worker;
const BATCH = 32;

self.onmessage = ({ data }: MessageEvent<{ directory: string; queries: Float32Array; k: number; from: number; to: number; exclude: Int32Array }>) => {
  const index = new DenseIndex(data.directory), d = index.meta.dimensions, count = data.exclude.length, k = data.k;
  const rows = new Int32Array(count * k).fill(-1), scores = new Float64Array(count * k);
  for (let q = 0; q < count; q += BATCH) {
    const end = Math.min(count, q + BATCH);
    index.scan(data.queries.subarray(q * d, end * d), k, data.from, data.to, data.exclude.subarray(q, end)).forEach((hits, i) => hits.forEach((hit, r) => {
      rows[(q + i) * k + r] = hit.row; scores[(q + i) * k + r] = hit.score;
    }));
  }
  self.postMessage({ rows, scores }, [rows.buffer, scores.buffer]);
};
