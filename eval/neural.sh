#!/usr/bin/env bash
set -euo pipefail
p4=artifacts/phase4
p5=artifacts/phase5
q="--queries data/reference/topics.msmarco-passage.dev-subset.tsv --qrels data/reference/qrels.msmarco-passage.dev-subset.txt"
for site in android english gaming gis mathematica physics programmers stats tex unix webmasters wordpress; do
  v=data/dense/cqadupstack-$site
  [ -f $v/hnsw.usearch ] || bun engine/dense.ts --vectors $v
  bun eval/dense.ts --dataset cqadupstack-$site --vectors $v --queries data/raw/cqadupstack/$site/queries.jsonl --qrels data/raw/cqadupstack/$site/qrels.txt \
    --bm25 artifacts/cqadupstack-$site.run.trec --out $p4/cqadupstack-$site
done
[ -f data/dense/msmarco/hnsw.usearch ] || bun engine/dense.ts --vectors data/dense/msmarco
bun eval/dense.ts --dataset msmarco --vectors data/dense/msmarco $q --bm25 artifacts/msmarco.run.trec --out $p4/msmarco
bun eval/rerank.ts --dataset msmarco --corpus data/normalized/msmarco.jsonl $q --run $p4/msmarco.hybrid.run.trec --out $p5/msmarco
bun eval/rerank.ts --dataset cqadupstack-android --corpus data/normalized/cqadupstack-android.jsonl --queries data/raw/cqadupstack/android/queries.jsonl \
  --qrels data/raw/cqadupstack/android/qrels.txt --run $p4/cqadupstack-android.hybrid.run.trec --out $p5/cqadupstack-android
