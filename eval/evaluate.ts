import { readFile, writeFile } from "node:fs/promises";
import { args } from "./io.ts";
import { evaluate, loadQrels, loadRun } from "./metrics.ts";

export { evaluate, loadQrels, loadRun } from "./metrics.ts";
export type { Evaluation, MetricValues, Qrels, Run } from "./metrics.ts";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const options = args(["qrels", "run", "out"], ["qrels", "run", "out", "reference", "tolerance"]);
  const result = evaluate(await loadQrels(options.qrels!), await loadRun(options.run!));
  await writeFile(options.out!, `${JSON.stringify(result, null, 2)}\n`);

  if (!options.reference) return;
  const parsed: unknown = JSON.parse(await readFile(options.reference, "utf8"));
  const expected = record(parsed) && record(parsed.aggregate) ? parsed.aggregate : parsed;
  if (!record(expected)) throw new Error("Reference JSON must contain aggregate metrics");
  const tolerance = options.tolerance === undefined ? 1e-12 : Number(options.tolerance);
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("Tolerance must be a finite nonnegative number");

  for (const metric of Object.keys(result.aggregate) as (keyof typeof result.aggregate)[]) {
    const expectedValue = expected[metric];
    if (typeof expectedValue !== "number" || !Number.isFinite(expectedValue)) {
      throw new Error(`Reference is missing finite ${metric}`);
    }
    const delta = Math.abs(result.aggregate[metric] - expectedValue);
    if (delta > tolerance) throw new Error(`${metric} differs by ${delta}, exceeding tolerance ${tolerance}`);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
