#!/usr/bin/env bash
set -euo pipefail
out=artifacts/phase3
q="--queries data/reference/topics.msmarco-passage.dev-subset.tsv --qrels data/reference/qrels.msmarco-passage.dev-subset.txt --dataset msmarco"
for k in 10 1000; do
  for mode in flat vbyte block maxscore bmw; do
    bun bench/phase3.ts $q --index data/index/msmarco --mode $mode --k $k --repeats 3 --out $out/msmarco-$mode-k$k
  done
done
[ -f data/index/msmarco-1m/meta.json ] || bun engine/build.ts --corpus data/normalized/msmarco-1m.jsonl --out data/index/msmarco-1m --k1 0.82 --b 0.68 > $out/msmarco-1m-build.json
bun bench/phase3.ts $q --corpus data/normalized/msmarco-1m.jsonl --k1 0.82 --b 0.68 --mode heap --k 10 --repeats 3 --out $out/msmarco-1m-heap-k10
for mode in flat maxscore bmw; do
  bun bench/phase3.ts $q --index data/index/msmarco-1m --mode $mode --k 10 --repeats 3 --out $out/msmarco-1m-$mode-k10
done
a="--queries data/raw/cqadupstack/android/queries.jsonl --qrels data/raw/cqadupstack/android/qrels.txt --dataset cqadupstack-android"
bun bench/phase3.ts $a --corpus data/normalized/cqadupstack-android.jsonl --mode heap --k 10 --repeats 3 --out $out/android-heap-k10
for mode in flat maxscore bmw; do
  bun bench/phase3.ts $a --index data/index/android --mode $mode --k 10 --repeats 3 --out $out/android-$mode-k10
done
for library in minisearch orama; do
  bun bench/libraries.ts --library $library --corpus data/normalized/cqadupstack-android.jsonl $a --k 10 --out $out/android-$library-k10
  bun bench/libraries.ts --library $library --corpus data/normalized/msmarco-1m.jsonl $q --k 10 --out $out/msmarco-1m-$library-k10
done
