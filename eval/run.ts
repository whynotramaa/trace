import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildIndex } from "../engine/index.ts";
import type { AnalyzerMode } from "../engine/analyzer.ts";
import { defaults, type Parameters } from "../engine/bm25.ts";
import { collectEnvironment, hashFile, memoryUsage } from "../bench/environment.ts";
import { args, lines } from "./io.ts";
import { evaluate, loadQrels, loadRun, type MetricValues } from "./metrics.ts";

type Query = { id: string; text: string };

const METRICS = ["mrr_10", "ndcg_cut_10", "recall_100", "recall_1000"] as const;
type ReferenceGate = {
  passed: boolean;
  status?: "not_run";
  metrics_match: boolean;
  counts_match: boolean;
  config_match: boolean;
  declared: Record<string, unknown>;
  expected_counts: { document_count?: number; query_count?: number };
  failures: string[];
};

function numberOption(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`--${name} must be finite`);
  return result;
}

function integerOption(value: string | undefined, name: string, fallback: number): number {
  const result = numberOption(value, name, fallback);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`--${name} must be a positive integer`);
  return result;
}

function analyzerOption(value: string | undefined): AnalyzerMode {
  const analyzer = value ?? "anserini";
  if (analyzer !== "anserini" && analyzer !== "technical") throw new Error("--analyzer must be anserini or technical");
  return analyzer;
}

async function loadQueries(path: string): Promise<Query[]> {
  const result: Query[] = [];
  const seen = new Set<string>();
  let lineNumber = 0;

  for await (const raw of lines(path)) {
    lineNumber++;
    const line = lineNumber === 1 ? raw.replace(/^\uFEFF/, "") : raw;
    let id: unknown;
    let text: unknown;
    if (line.trimStart().startsWith("{")) {
      let record: unknown;
      try { record = JSON.parse(line); } catch (error) { throw new Error(`Malformed query JSON on line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`); }
      if (!record || typeof record !== "object") throw new Error(`Malformed query JSON on line ${lineNumber}`);
      ({ _id: id, text } = record as { _id?: unknown; text?: unknown });
    } else {
      const separator = line.indexOf("\t");
      if (separator <= 0) throw new Error(`Malformed query TSV on line ${lineNumber}`);
      id = line.slice(0, separator).trim();
      text = line.slice(separator + 1);
    }

    if ((typeof id !== "string" && typeof id !== "number") || (typeof id === "string" && !id) || (typeof id === "number" && !Number.isFinite(id))) {
      throw new Error(`Query ID must be a non-empty string or finite number on line ${lineNumber}`);
    }
    if (typeof text !== "string") throw new Error(`Query text must be a string on line ${lineNumber}`);
    const queryId = String(id);
    if (seen.has(queryId)) throw new Error(`Duplicate query ID ${queryId} on line ${lineNumber}`);
    seen.add(queryId);
    result.push({ id: queryId, text });
  }
  if (!result.length) throw new Error("Query file is empty");
  return result;
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function stats(values: number[]) {
  if (!values.length) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

function defaultTolerance(dataset: string): number {
  if (dataset === "msmarco") return 0.001;
  if (dataset.startsWith("cqadupstack")) return 0.002;
  return 0.001;
}

function expectedMetrics(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reference JSON must contain metrics");
  const record = value as Record<string, unknown>;
  const aggregate = record.aggregate;
  return aggregate && typeof aggregate === "object" && !Array.isArray(aggregate) ? aggregate as Record<string, unknown> : record;
}

function compareReference(
  actual: MetricValues,
  reference: unknown,
  tolerance: number,
  expectedActual: { dataset: string; document_count: number; query_count: number; k1: number; b: number },
): ReferenceGate {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw new Error("Reference JSON must contain metrics");
  const root = reference as Record<string, unknown>;
  const expected = expectedMetrics(reference);
  const declared: Record<string, { actual: number; expected: number; delta: number }> = {};
  for (const metric of METRICS) {
    if (!(metric in expected)) continue;
    const value = expected[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Reference ${metric} must be finite`);
    const delta = Math.abs(actual[metric] - value);
    declared[metric] = { actual: actual[metric], expected: value, delta };
  }
  const failed = Object.entries(declared).filter(([, result]) => result.delta > tolerance).map(([metric, result]) => `${metric} differs by ${result.delta}, exceeding tolerance ${tolerance}`);
  const counts: Record<string, { actual: number; expected: number; match: boolean }> = {};
  const config: Record<string, { actual: number | string; expected: number | string; match: boolean }> = {};
  const failures = [...failed];
  const declaredValue = (name: string): unknown => {
    if (name in root) return root[name];
    const corpus = root.corpus;
    if (corpus && typeof corpus === "object" && !Array.isArray(corpus) && name in corpus) return (corpus as Record<string, unknown>)[name];
    return undefined;
  };
  for (const [name, actualValue] of Object.entries({ document_count: expectedActual.document_count, query_count: expectedActual.query_count })) {
    const value = declaredValue(name);
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) { failures.push(`Reference ${name} must be a nonnegative integer`); continue; }
    const match = value === actualValue;
    counts[name] = { actual: actualValue, expected: value, match };
    if (!match) failures.push(`${name} is ${value}, actual is ${actualValue}`);
  }
  const scoring = root.scoring && typeof root.scoring === "object" && !Array.isArray(root.scoring) ? root.scoring as Record<string, unknown> : {};
  const parameters = scoring.parameters && typeof scoring.parameters === "object" && !Array.isArray(scoring.parameters) ? scoring.parameters as Record<string, unknown> : {};
  const declaredConfig = (name: "k1" | "b"): unknown => root[name] ?? scoring[name] ?? parameters[name];
  for (const [name, actualValue] of Object.entries({ k1: expectedActual.k1, b: expectedActual.b }) as ["k1" | "b", number][]) {
    const value = declaredConfig(name);
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) { failures.push(`Reference ${name} must be finite`); continue; }
    const match = value === actualValue;
    config[name] = { actual: actualValue, expected: value, match };
    if (!match) failures.push(`${name} is ${value}, actual is ${actualValue}`);
  }
  if (root.dataset !== undefined) {
    const match = root.dataset === expectedActual.dataset;
    config.dataset = { actual: expectedActual.dataset, expected: String(root.dataset), match };
    if (!match) failures.push(`dataset is ${String(root.dataset)}, actual is ${expectedActual.dataset}`);
  }
  const metricsMatch = failed.length === 0 && Object.keys(declared).length > 0;
  if (!Object.keys(declared).length) failures.push("Reference declares no supported metrics");
  const countsMatch = Object.values(counts).every((value) => value.match);
  const configMatch = Object.values(config).every((value) => value.match);
  return {
    passed: metricsMatch && countsMatch && configMatch,
    metrics_match: metricsMatch,
    counts_match: countsMatch,
    config_match: configMatch,
    declared: { metrics: declared, counts, config },
    expected_counts: {
      document_count: counts.document_count?.expected,
      query_count: counts.query_count?.expected,
    },
    failures,
  };
}

function metricQids(actual: ReturnType<typeof evaluate>, qrels: Map<string, Map<string, number>>) {
  const actualQids = Object.keys(actual.per_query).sort();
  const judgedQids = [...qrels.keys()].sort();
  return { actual: actualQids, judged: judgedQids, match: actualQids.length === judgedQids.length && actualQids.every((qid, index) => qid === judgedQids[index]) };
}

async function main() {
  const options = args(
    ["corpus", "queries", "qrels", "dataset", "out"],
    ["corpus", "queries", "qrels", "dataset", "out", "analyzer", "k1", "b", "reference", "tolerance", "repeats"],
  );
  const dataset = options.dataset!;
  const analyzer = analyzerOption(options.analyzer);
  const parameters: Parameters = { k1: numberOption(options.k1, "k1", defaults.k1), b: numberOption(options.b, "b", defaults.b) };
  if (parameters.k1 <= 0 || parameters.b < 0 || parameters.b > 1) throw new Error("BM25 needs k1 > 0 and 0 <= b <= 1");
  const repeats = integerOption(options.repeats, "repeats", 3);
  const tolerance = numberOption(options.tolerance, "tolerance", defaultTolerance(dataset));
  if (tolerance < 0) throw new Error("--tolerance must be nonnegative");

  const [queries, qrels, queryHash, qrelsHash, environment] = await Promise.all([
    loadQueries(options.queries!),
    loadQrels(options.qrels!),
    hashFile(options.queries!),
    hashFile(options.qrels!),
    collectEnvironment(resolve(import.meta.dir, "..")),
  ]);
  const queryIds = new Set(queries.map((query) => query.id));
  const missingQids = [...qrels.keys()].filter((qid) => !queryIds.has(qid));
  if (missingQids.length) throw new Error(`Qrels contain query IDs absent from queries: ${missingQids.slice(0, 10).join(", ")}`);
  const judgedQueries = queries.filter((query) => qrels.has(query.id));

  const buildStarted = performance.now();
  const index = await buildIndex(options.corpus!, analyzer);
  const indexBuildMs = performance.now() - buildStarted;
  const indexMemory = memoryUsage();
  const runPath = `${options.out!}.run.trec`;
  const jsonPath = `${options.out!}.json`;
  await mkdir(dirname(resolve(runPath)), { recursive: true });

  const latencies: number[] = [];
  const postingsVisited: number[] = [];
  const docsScored: number[] = [];
  const warmup = judgedQueries.slice(0, Math.min(100, judgedQueries.length));
  const exclude = dataset.startsWith("cqadupstack-") ? (query: Query) => query.id : () => undefined;
  const search = (query: Query) => index.search(query.text, { k: 1000, strategy: "bm25", parameters, exclude: exclude(query) });
  for (const query of warmup) search(query);

  const writer = Bun.file(runPath).writer();
  try {
    for (let repeat = 0; repeat < repeats; repeat++) {
      for (let queryIndex = 0; queryIndex < judgedQueries.length; queryIndex++) {
        const query = judgedQueries[queryIndex]!;
        const result = search(query);
        latencies.push(result.timings.total_ms);
        postingsVisited.push(result.postings_visited);
        docsScored.push(result.candidate_count);
        if (repeat === 0) {
          result.hits.forEach((hit, rank) => writer.write(`${query.id} Q0 ${hit.doc_id} ${rank + 1} ${hit.score} trace\n`));
        }
        const completed = queryIndex + 1;
        if (completed % 100 === 0 || completed === judgedQueries.length) console.error(`Benchmark repeat ${repeat + 1}/${repeats}: ${completed}/${judgedQueries.length} queries`);
      }
    }
  } finally {
    await writer.end();
  }

  const run = await loadRun(runPath);
  const actual = evaluate(qrels, run);
  const qidValidation = metricQids(actual, qrels);
  const referenceGate: ReferenceGate = options.reference
    ? compareReference(actual.aggregate, JSON.parse(await readFile(options.reference, "utf8")), tolerance, {
      dataset,
      document_count: index.documents.length,
      query_count: judgedQueries.length,
      k1: parameters.k1,
      b: parameters.b,
    })
    : { passed: false, status: "not_run", metrics_match: false, counts_match: false, config_match: false, declared: {}, expected_counts: {}, failures: [] };
  const record = {
    dataset,
    counts: {
      corpus: index.documents.length,
      indexed_documents: index.indexedDocuments,
      input_queries: queries.length,
      queries: judgedQueries.length,
      judged_queries: qrels.size,
      run_queries: run.size,
    },
    corpus: { path: options.corpus, hash: index.corpusHash, documents: index.documents.length },
    inputs: { queries: { path: options.queries, sha256: queryHash }, qrels: { path: options.qrels, sha256: qrelsHash } },
    analyzer,
    scoring: { strategy: "bm25", parameters },
    index_build_ms: indexBuildMs,
    benchmark: {
      warmup_queries: warmup.length,
      repeats,
      measured_queries: judgedQueries.length * repeats,
      latency_ms: stats(latencies),
      postings_visited: stats(postingsVisited),
      docs_scored: stats(docsScored),
    },
    metrics: actual.aggregate,
    metrics_actual: actual,
    memory: { after_index_build: indexMemory, after_benchmark: memoryUsage() },
    machine: environment,
    validation: {
      metrics_actual_qids: qidValidation,
      corpus_counts: { actual: index.documents.length, expected: referenceGate.expected_counts.document_count ?? null, match: referenceGate.counts_match },
      reference_gate: referenceGate,
      passed: Boolean(options.reference && referenceGate.passed && qidValidation.match),
    },
  };
  await Bun.write(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
  if (options.reference && !referenceGate.passed) throw new Error(referenceGate.failures.join("; "));
  if (!qidValidation.match) throw new Error("Metrics actual query IDs do not match judged query IDs");
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
