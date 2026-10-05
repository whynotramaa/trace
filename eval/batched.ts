import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { analyze, type AnalyzerMode } from "../engine/analyzer.ts";
import { validateDocument } from "../engine/document.ts";
import { InvertedIndex, type CorpusStatistics } from "../engine/index.ts";
import { TopK } from "../engine/heap.ts";
import { defaults, validateParameters, type Parameters } from "../engine/bm25.ts";
import { collectEnvironment, hashFile, memoryUsage } from "../bench/environment.ts";
import { args, lines } from "./io.ts";
import { evaluate, loadQrels, type Evaluation } from "./metrics.ts";
import { compareReference, loadQueries } from "./run.ts";

type Query = { id: string; text: string };

/** Exact offline evaluation on machines that cannot retain the entire heap index. */
export async function batchedSearch(path: string, queries: Query[], options: {
  batchSize: number; analyzer: AnalyzerMode; parameters: Parameters; k: number; excludeSelf?: boolean;
}) {
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1) throw new Error("batchSize must be a positive integer");
  validateParameters(options.parameters);
  const terms = new Set(queries.flatMap(query => analyze(query.text, options.analyzer)));
  const df = new Map([...terms].map(term => [term, 0]));
  const statistics: CorpusStatistics = { indexedDocuments: 0, tokens: 0, df };
  const ids = new Set<string>();
  const digest = new Bun.CryptoHasher("sha256");
  let count = 0, peakRSS = process.memoryUsage().rss;
  const started = performance.now();
  for await (const line of lines(path)) {
    digest.update(`${line}\n`);
    const document = validateDocument(JSON.parse(line));
    if (ids.has(document.doc_id)) throw new Error(`Duplicate document ID ${document.doc_id}`);
    ids.add(document.doc_id);
    const tokens = analyze(`${document.title} ${document.body}`, options.analyzer);
    statistics.tokens += tokens.length;
    if (tokens.length) statistics.indexedDocuments++;
    for (const term of new Set(tokens)) if (terms.has(term)) df.set(term, df.get(term)! + 1);
    count++;
    if (count % 100_000 === 0) {
      peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
      console.error(`Corpus statistics: ${count} documents; RSS ${(peakRSS / 2 ** 30).toFixed(2)} GiB`);
    }
  }
  if (!count) throw new Error("Cannot evaluate an empty corpus");
  ids.clear();
  const corpusHash = digest.digest("hex");
  const statisticsMs = performance.now() - started;
  const heaps = queries.map(() => new TopK(options.k));
  const candidates = queries.map(() => 0), postings = queries.map(() => 0);
  let batch = new InvertedIndex(options.analyzer), processed = 0, batches = 0;
  const secondDigest = new Bun.CryptoHasher("sha256");
  const scoreBatch = () => {
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i]!;
      const result = batch.search(query.text, { k: options.k, parameters: options.parameters, statistics,
        exclude: options.excludeSelf ? query.id : undefined });
      candidates[i]! += result.candidate_count;
      postings[i]! += result.postings_visited;
      for (const hit of result.hits) heaps[i]!.add(hit);
    }
    processed += batch.documents.length;
    batches++;
    peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
    console.error(`Scored batch ${batches}: ${processed}/${count} documents; RSS ${(process.memoryUsage().rss / 2 ** 30).toFixed(2)} GiB`);
    batch = new InvertedIndex(options.analyzer);
    // Release each batch promptly. This is offline evaluation, not a serving benchmark.
    Bun.gc(true);
  };
  for await (const line of lines(path)) {
    secondDigest.update(`${line}\n`);
    batch.add(validateDocument(JSON.parse(line)));
    if (batch.documents.length === options.batchSize) scoreBatch();
  }
  if (batch.documents.length) scoreBatch();
  if (processed !== count || secondDigest.digest("hex") !== corpusHash) throw new Error("Corpus changed between statistics and scoring passes");
  return { heaps, candidates, postings, count, corpusHash, statistics, batches, statisticsMs,
    totalMs: performance.now() - started, peakRSS };
}

async function main() {
  const config = args(["corpus", "queries", "qrels", "dataset", "reference", "out"],
    ["corpus", "queries", "qrels", "dataset", "reference", "out", "batch-size", "analyzer", "k1", "b"]);
  const analyzer = config.analyzer ?? "anserini";
  if (analyzer !== "anserini" && analyzer !== "technical") throw new Error("Unknown analyzer");
  const parameters = validateParameters({ k1: Number(config.k1 ?? defaults.k1), b: Number(config.b ?? defaults.b) });
  const [inputQueries, qrels, queryHash, qrelsHash, machine, reference] = await Promise.all([
    loadQueries(config.queries!), loadQrels(config.qrels!), hashFile(config.queries!), hashFile(config.qrels!),
    collectEnvironment(resolve(import.meta.dir, "..")), Bun.file(config.reference!).json(),
  ]);
  const queryIds = new Set(inputQueries.map(query => query.id));
  for (const qid of qrels.keys()) if (!queryIds.has(qid)) throw new Error(`Missing judged query ${qid}`);
  const queries = inputQueries.filter(query => qrels.has(query.id));
  if (!queries.length) throw new Error("No judged queries");
  const batchSize = Number(config["batch-size"] ?? 100_000);
  const result = await batchedSearch(config.corpus!, queries, { batchSize, analyzer, parameters, k: 1000,
    excludeSelf: config.dataset!.startsWith("cqadupstack-") });
  const path = `${config.out}.run.trec`, temporary = `${path}.${process.pid}.part`;
  await mkdir(dirname(resolve(path)), { recursive: true });
  const writer = Bun.file(temporary).writer();
  const actual: Evaluation = { query_count: queries.length, aggregate: { mrr_10: 0, ndcg_cut_10: 0, recall_100: 0, recall_1000: 0 }, per_query: Object.create(null) };
  let runQueries = 0;
  try {
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i]!, hits = result.heaps[i]!.sorted();
      if (hits.length) runQueries++;
      hits.forEach((hit, rank) => writer.write(`${query.id} Q0 ${hit.doc_id} ${rank + 1} ${hit.score} trace\n`));
      const metric = evaluate(new Map([[query.id, qrels.get(query.id)!]]),
        new Map([[query.id, new Map(hits.map(hit => [hit.doc_id, hit.score]))]])).aggregate;
      actual.per_query[query.id] = metric;
      for (const name of Object.keys(metric) as (keyof typeof metric)[]) actual.aggregate[name] += metric[name] / queries.length;
    }
    await writer.end();
    await rename(temporary, path);
  } catch (error) { await writer.end(); await rm(temporary, { force: true }); throw error; }
  const tolerance = config.dataset === "msmarco" ? 0.001 : 0.002;
  const gate = compareReference(actual.aggregate, reference, tolerance, { dataset: config.dataset!,
    document_count: result.count, query_count: queries.length, ...parameters });
  const record = {
    dataset: config.dataset, execution: "batched_offline_exhaustive", counts: { corpus: result.count,
      indexed_documents: result.statistics.indexedDocuments, input_queries: inputQueries.length,
      queries: queries.length, judged_queries: qrels.size, run_queries: runQueries },
    corpus: { path: config.corpus, hash: result.corpusHash, documents: result.count },
    inputs: { queries: { path: config.queries, sha256: queryHash }, qrels: { path: config.qrels, sha256: qrelsHash } },
    analyzer, scoring: { strategy: "bm25", parameters }, metrics: actual.aggregate, metrics_actual: actual,
    offline: { batch_size: batchSize, batches: result.batches, statistics_ms: result.statisticsMs,
      total_ms: result.totalMs, peak_sampled_rss_bytes: result.peakRSS,
      note: "Quality evaluation only. Batch times are not online query latency or throughput." },
    counters: { candidates: result.candidates, postings_visited: result.postings }, machine,
    validation: { reference_gate: gate, passed: gate.passed, tolerance },
  };
  await Bun.write(`${config.out}.json`, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ metrics: actual.aggregate, gate }, null, 2));
  if (!gate.passed) throw new Error(gate.failures.join("; "));
}

if (import.meta.main) main().catch(error => { console.error(error); process.exitCode = 1; });
