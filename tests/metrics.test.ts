import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { evaluate, loadQrels, loadRun } from "../eval/metrics.ts";

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "trace-metrics-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function fixture(name: string, contents: string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

describe("Phase 0 evaluator", () => {
  test("loads TREC and BEIR qrels and evaluates graded relevance", async () => {
    const qrelsPath = await fixture(
      "qrels.txt",
      "q1 0 dA 2\nq1 0 dB 1\nq1 0 dC 0\nq2 0 dX 1\nq2 0 dY 1\nq3 0 dZ 0\nq4 0 dG 2\n",
    );
    const runPath = await fixture(
      "run.txt",
      "q1 Q0 dA 2 1 tag\nq1 Q0 dB 1 1 tag\nq2 Q0 dX 1 2 tag\nq2 Q0 dY 2 2 tag\n",
    );
    const qrels = await loadQrels(qrelsPath);
    const run = await loadRun(runPath);
    const result = evaluate(qrels, run);
    const q1Ndcg = (1 + 2 / Math.log2(3)) / (2 + 1 / Math.log2(3));

    expect(result.query_count).toBe(4);
    expect(result.per_query.q1).toEqual({ mrr_10: 1, ndcg_cut_10: q1Ndcg, recall_100: 1, recall_1000: 1 });
    expect(result.per_query.q2).toEqual({ mrr_10: 1, ndcg_cut_10: 1, recall_100: 1, recall_1000: 1 });
    expect(result.per_query.q3).toEqual({ mrr_10: 0, ndcg_cut_10: 0, recall_100: 0, recall_1000: 0 });
    expect(result.per_query.q4).toEqual({ mrr_10: 0, ndcg_cut_10: 0, recall_100: 0, recall_1000: 0 });
    expect(result.aggregate.mrr_10).toBe(0.5);
    expect(result.aggregate.ndcg_cut_10).toBe((q1Ndcg + 1) / 4);
    expect(result.aggregate.recall_100).toBe(0.5);
    expect(result.aggregate.recall_1000).toBe(0.5);

    const beirPath = await fixture("beir.tsv", "query-id\tcorpus-id\tscore\nq5\tdoc\t2\n");
    expect(await loadQrels(beirPath)).toEqual(new Map([["q5", new Map([["doc", 2]])]]));
  });

  test("rejects malformed, duplicate, and nonfinite records", async () => {
    const cases = [
      ["duplicate-qrels.txt", "q 0 d 1\nq 0 d 1\n", loadQrels],
      ["bad-qrels.txt", "q 0 d NaN\n", loadQrels],
      ["short-run.txt", "q Q0 d 1 1\n", loadRun],
      ["duplicate-run.txt", "q Q0 d 1 1 tag\nq Q0 d 2 1 tag\n", loadRun],
      ["bad-run.txt", "q Q0 d 1 Infinity tag\n", loadRun],
    ] as const;

    for (const [name, contents, loader] of cases) {
      await expect(loader(await fixture(name, contents))).rejects.toThrow();
    }
  });
});
