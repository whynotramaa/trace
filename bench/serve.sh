#!/usr/bin/env bash
set -euo pipefail
out=artifacts/phase3
queries=data/reference/topics.msmarco-passage.dev-subset.tsv
cores=$(nproc)
for workers in 1 "$cores"; do
  bun server/index.ts --index data/index/msmarco --mode "${MODE:-maxscore}" --workers "$workers" --trace off --port 3100 &
  server=$!
  until curl -sf http://127.0.0.1:3100/metadata > /dev/null; do sleep 1; done
  sleep 2
  bun bench/load.ts --url http://127.0.0.1:3100 --queries "$queries" --concurrency 64 --seconds 30 --label "workers=$workers" --out "$out/serve-workers$workers.json"
  kill "$server"
  wait "$server" || true
done
