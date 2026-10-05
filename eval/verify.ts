import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { args } from "./io.ts";
import { evaluate, loadQrels, loadRun, type MetricValues } from "./metrics.ts";

// Python is used only to check the TS evaluator against the specified external evaluator.
// Metrics, corpus ingestion, and experiment execution remain TypeScript.
const reference = `
import json, sys, pytrec_eval
data=json.load(open(sys.argv[1]))
qrels=data['qrels']; run=data['run']
full=pytrec_eval.RelevanceEvaluator(qrels, {'ndcg_cut_10','recall_100','recall_1000'}).evaluate(run)
top10={q:dict(sorted(d.items(), key=lambda x:(x[1],x[0]), reverse=True)[:10]) for q,d in run.items()}
rr=pytrec_eval.RelevanceEvaluator(qrels, {'recip_rank'}).evaluate(top10)
metrics={}
for q in qrels:
    metrics[q]={'mrr_10':rr.get(q,{}).get('recip_rank',0),**{k:full.get(q,{}).get(k,0) for k in ['ndcg_cut_10','recall_100','recall_1000']}}
aggregate={k:sum(m[k] for m in metrics.values())/len(qrels) for k in ['mrr_10','ndcg_cut_10','recall_100','recall_1000']}
print(json.dumps({'query_count':len(qrels),'aggregate':aggregate,'per_query':metrics}))
`;

async function main() {
  const options = args(["qrels", "run", "out"], ["qrels", "run", "out", "python"]);
  const qrels = await loadQrels(options.qrels!);
  const run = await loadRun(options.run!);
  if (!qrels.size || !run.size) throw new Error("Parity needs nonempty qrels and a nonempty published run");
  await mkdir(dirname(options.out!), { recursive: true });
  const input = `${options.out!}.input.json`;
  const object = (map: Map<string, Map<string, number>>) => Object.fromEntries([...map].map(([key, values]) => [key, Object.fromEntries(values)]));
  await Bun.write(input, JSON.stringify({ qrels: object(qrels), run: object(run) }));
  const process = Bun.spawn([options.python ?? ".venv/bin/python", "-c", reference, input], { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new Error(`pytrec_eval exited ${code}: ${error}`);
  const expected = JSON.parse(output) as ReturnType<typeof evaluate>;
  const actual = evaluate(qrels, run);
  let maxDelta = 0;
  for (const query of qrels.keys()) {
    for (const key of Object.keys(actual.aggregate) as (keyof MetricValues)[]) {
      const delta = Math.abs(actual.per_query[query]![key] - expected.per_query[query]![key]);
      maxDelta = Math.max(maxDelta, delta);
      if (delta > 1e-12) throw new Error(`${query} ${key} differs from pytrec_eval by ${delta}`);
    }
  }
  for (const key of Object.keys(actual.aggregate) as (keyof MetricValues)[]) {
    const delta = Math.abs(actual.aggregate[key] - expected.aggregate[key]);
    maxDelta = Math.max(maxDelta, delta);
    if (delta > 1e-12) throw new Error(`Aggregate ${key} differs from pytrec_eval by ${delta}`);
  }
  const hashes = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
  const report = {
    phase: 0, passed: true, tolerance: 1e-12, maximum_absolute_delta: maxDelta,
    checked_at: new Date().toISOString(), bun: Bun.version,
    qrels: { path: options.qrels, sha256: await hashes(options.qrels!) },
    run: { path: options.run, sha256: await hashes(options.run!) },
    reference: expected, trace: actual,
  };
  await Bun.write(options.out!, JSON.stringify(report, null, 2));
  await Bun.file(input).delete();
  console.log(JSON.stringify({ passed: true, query_count: actual.query_count, maximum_absolute_delta: maxDelta, aggregate: actual.aggregate }));
}

if (import.meta.main) await main();
