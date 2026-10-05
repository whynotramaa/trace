import { mkdir } from "node:fs/promises";
import { cqaSites } from "./fetch.ts";

// Record the published Anserini reference values before computing Trace scores.
await mkdir("data/reference", { recursive: true });
for (const site of cqaSites) {
  const path = `src/main/resources/reproduce/from-document-collection/configs/beir-v1.0.0-cqadupstack-${site}.flat.yaml`;
  const source = `https://raw.githubusercontent.com/castorini/anserini/master/${path}`;
  const response = await fetch(source, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  const yaml = await response.text();
  const metric = yaml.match(/results:\s*\n\s+nDCG@10:\s*\n\s+-\s+([\d.]+)/);
  const count = yaml.match(/documents:\s*(\d+)/);
  if (!metric || !count) throw new Error(`Cannot read Anserini's ${site} reference`);
  await Bun.write(`data/reference/cqadupstack-${site}.json`, JSON.stringify({
    dataset: `cqadupstack-${site}`, document_count: Number(count[1]), aggregate: { ndcg_cut_10: Number(metric[1]) },
    source, source_sha256: new Bun.CryptoHasher("sha256").update(yaml).digest("hex"), k1: 0.9, b: 0.4,
  }, null, 2));
}
await Bun.write("data/reference/msmarco.json", JSON.stringify({
  dataset: "msmarco", document_count: 8_841_823, query_count: 6_980,
  aggregate: { mrr_10: 0.18741227770955546 },
  source: "https://github.com/castorini/pyserini/blob/master/docs/experiments-msmarco-passage.md", k1: 0.82, b: 0.68,
}, null, 2));
