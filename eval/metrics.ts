import { lines } from "./io.ts";

export type Qrels = Map<string, Map<string, number>>;
export type Run = Map<string, Map<string, number>>;

export type MetricValues = {
  mrr_10: number;
  ndcg_cut_10: number;
  recall_100: number;
  recall_1000: number;
};

export type Evaluation = {
  query_count: number;
  aggregate: MetricValues;
  per_query: Record<string, MetricValues>;
};

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function value(token: string, name: string, line: number): number {
  if (!NUMBER.test(token)) throw new Error(`Malformed ${name} on line ${line}: ${token}`);
  const result = Number(token);
  if (!Number.isFinite(result)) throw new Error(`Nonfinite ${name} on line ${line}: ${token}`);
  return result;
}

function field(token: string | undefined, name: string, line: number): string {
  if (!token) throw new Error(`Malformed ${name} on line ${line}`);
  return token;
}

function put(target: Map<string, Map<string, number>>, query: string, document: string, score: number, line: number) {
  let documents = target.get(query);
  if (!documents) target.set(query, (documents = new Map()));
  if (documents.has(document)) throw new Error(`Duplicate ${query}/${document} on line ${line}`);
  documents.set(document, score);
}

export async function loadQrels(path: string): Promise<Qrels> {
  const result: Qrels = new Map();
  let first = true;
  let beir = false;
  let lineNumber = 0;

  for await (const raw of lines(path)) {
    lineNumber++;
    const line = lineNumber === 1 ? raw.replace(/^\uFEFF/, "") : raw;
    if (first) {
      const header = line.split("\t").map((part) => part.trim().toLowerCase());
      beir = header.length === 3 && header[0] === "query-id" && header[1] === "corpus-id" && header[2] === "score";
      first = false;
      if (beir) continue;
    }

    if (beir) {
      const fields = line.split("\t").map((part) => part.trim());
      if (fields.length !== 3) throw new Error(`Malformed BEIR qrels on line ${lineNumber}`);
      const query = field(fields[0], "query ID", lineNumber);
      const document = field(fields[1], "document ID", lineNumber);
      put(result, query, document, value(field(fields[2], "relevance", lineNumber), "relevance", lineNumber), lineNumber);
    } else {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4) throw new Error(`Malformed TREC qrels on line ${lineNumber}`);
      const query = field(fields[0], "query ID", lineNumber);
      const document = field(fields[2], "document ID", lineNumber);
      put(result, query, document, value(field(fields[3], "relevance", lineNumber), "relevance", lineNumber), lineNumber);
    }
  }
  return result;
}

export async function loadRun(path: string): Promise<Run> {
  const result: Run = new Map();
  let lineNumber = 0;
  for await (const raw of lines(path)) {
    lineNumber++;
    const fields = raw.trim().split(/\s+/);
    if (fields.length !== 6) throw new Error(`Malformed TREC run on line ${lineNumber}`);
    const query = field(fields[0], "query ID", lineNumber);
    const document = field(fields[2], "document ID", lineNumber);
    const rank = value(field(fields[3], "rank", lineNumber), "rank", lineNumber);
    if (!Number.isInteger(rank) || rank < 1) throw new Error(`Malformed rank on line ${lineNumber}`);
    const score = value(field(fields[4], "score", lineNumber), "score", lineNumber);
    field(fields[1], "run iteration", lineNumber);
    field(fields[5], "run tag", lineNumber);
    put(result, query, document, score, lineNumber);
  }
  return result;
}

function compareDocumentsDescending(a: string, b: string): number {
  return a === b ? 0 : a < b ? 1 : -1;
}

function ranked(run: Map<string, number> | undefined): [string, number][] {
  return [...(run ?? [])].sort((a, b) => b[1] - a[1] || compareDocumentsDescending(a[0], b[0]));
}

function metricsFor(qrel: Map<string, number>, results: Map<string, number> | undefined): MetricValues {
  const ranking = ranked(results);
  const relevant = [...qrel.values()].filter((score) => score > 0);
  const ideal = relevant.sort((a, b) => b - a).slice(0, 10);
  const idcg = ideal.reduce((sum, score, index) => sum + score / Math.log2(index + 2), 0);
  let dcg = 0;
  let mrr = 0;
  let retrieved100 = 0;
  let retrieved1000 = 0;

  for (let index = 0; index < ranking.length; index++) {
    const [document] = ranking[index]!;
    const relevance = qrel.get(document) ?? 0;
    const rank = index + 1;
    if (relevance > 0) {
      if (rank <= 10 && mrr === 0) mrr = 1 / rank;
      if (rank <= 10) dcg += relevance / Math.log2(rank + 1);
      if (rank <= 100) retrieved100++;
      if (rank <= 1000) retrieved1000++;
    }
  }

  const denominator = relevant.length;
  return {
    mrr_10: mrr,
    ndcg_cut_10: idcg === 0 ? 0 : dcg / idcg,
    recall_100: denominator === 0 ? 0 : retrieved100 / denominator,
    recall_1000: denominator === 0 ? 0 : retrieved1000 / denominator,
  };
}

export function evaluate(qrels: Qrels, run: Run): Evaluation {
  const perQuery: Record<string, MetricValues> = Object.create(null);
  const aggregate: MetricValues = { mrr_10: 0, ndcg_cut_10: 0, recall_100: 0, recall_1000: 0 };

  for (const [query, qrel] of qrels) {
    const metrics = metricsFor(qrel, run.get(query));
    perQuery[query] = metrics;
    for (const metric of Object.keys(aggregate) as (keyof MetricValues)[]) aggregate[metric] += metrics[metric];
  }

  const queryCount = qrels.size;
  if (queryCount > 0) {
    for (const metric of Object.keys(aggregate) as (keyof MetricValues)[]) aggregate[metric] /= queryCount;
  }
  return { query_count: queryCount, aggregate, per_query: perQuery };
}
