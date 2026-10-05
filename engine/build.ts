import { createReadStream, openSync, readSync, closeSync, readFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { analyze } from "./analyzer.ts";
import { validateDocument } from "./document.ts";
import { byteLength, lengthByte, lengthNorm, luceneLength, saturation, validateParameters, type Parameters } from "./bm25.ts";
import { bitWidth, pack, vbytePut } from "./codec.ts";
import { hashFile } from "../bench/environment.ts";
import { args } from "../eval/io.ts";

export const BLOCK = 128;
export const FORMAT = 1;
const SEGMENT_BYTES = 256 * 2 ** 20;

class Column {
  private chunks: Uint32Array[] = [];
  length = 0;
  push(value: number) {
    const chunk = this.length >>> 24;
    if (chunk === this.chunks.length) this.chunks.push(new Uint32Array(1 << 24));
    this.chunks[chunk]![this.length++ & 0xffffff] = value;
  }
  get(i: number): number { return this.chunks[i >>> 24]![i & 0xffffff]!; }
}

async function* rawLines(path: string, from: number, to: number): AsyncGenerator<{ line: string; start: number; end: number }> {
  const decoder = new TextDecoder();
  let pending = new Uint8Array(0), base = from;
  if (to <= from) return;
  for await (const chunk of createReadStream(path, { start: from, end: to - 1 }) as AsyncIterable<Buffer>) {
    const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    for (let i = bytes.indexOf(10); i >= 0; i = bytes.indexOf(10, start)) {
      const end = i > start && bytes[i - 1] === 13 ? i - 1 : i;
      const line = decoder.decode(bytes.subarray(start, end));
      if (line.trim()) yield { line, start: base + start, end: base + end };
      start = i + 1;
    }
    pending = bytes.slice(start);
    base += start;
  }
  const line = decoder.decode(pending);
  if (line.trim()) yield { line, start: base, end: base + pending.length };
}

function view<T>(Type: new (buffer: ArrayBufferLike, offset: number, length: number) => T, size: number, path: string): T {
  const data = Bun.file(path).size ? Bun.mmap(path) : new Uint8Array(0);
  return new Type(data.buffer, data.byteOffset, data.byteLength / size);
}

async function writeSegment(corpus: string, from: number, to: number, out: string) {
  const vocabulary = new Map<string, number>();
  const pairTerm = new Column(), pairTf = new Column(), pairEnd = new Column(), lengths = new Column();
  const store: number[] = [], ids: string[] = [], sources: Record<string, number> = {};
  let tokens = 0, indexed = 0;
  for await (const { line, start, end } of rawLines(corpus, from, to)) {
    const document = validateDocument(JSON.parse(line));
    sources[document.source] = (sources[document.source] ?? 0) + 1;
    const terms = analyze(`${document.title} ${document.body}`, "anserini");
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    for (const [term, tf] of frequencies) {
      let id = vocabulary.get(term);
      if (id === undefined) vocabulary.set(term, id = vocabulary.size);
      if (tf > 0xffff) throw new Error("Term frequency exceeds the 16-bit format");
      pairTerm.push(id);
      pairTf.push(tf);
    }
    pairEnd.push(pairTerm.length);
    lengths.push(terms.length);
    store.push(start, end);
    ids.push(document.doc_id);
    tokens += terms.length;
    if (terms.length) indexed++;
  }
  const n = ids.length, postings = pairTerm.length;
  const encoder = new TextEncoder();
  const byTerm = [...vocabulary].map(([term, id]) => ({ bytes: Buffer.from(encoder.encode(term)), id }));
  vocabulary.clear();
  byTerm.sort((a, b) => Buffer.compare(a.bytes, b.bytes));
  const t = byTerm.length, order = new Uint32Array(t), counts = new Uint32Array(t);
  for (let i = 0; i < postings; i++) counts[pairTerm.get(i)]!++;
  const lexiconOffsets = new Uint32Array(t + 1), offsets = new Float64Array(t + 1);
  byTerm.forEach(({ bytes, id }, sorted) => {
    order[id] = sorted;
    lexiconOffsets[sorted + 1] = lexiconOffsets[sorted]! + bytes.length;
    offsets[sorted + 1] = offsets[sorted]! + counts[id]!;
  });
  const docs = new Uint32Array(postings), tfs = new Uint16Array(postings), cursor = offsets.slice(0, t);
  for (let d = 0, i = 0; d < n; d++) {
    for (const end = pairEnd.get(d); i < end; i++) {
      const at = cursor[order[pairTerm.get(i)]!]!++;
      docs[at] = d;
      tfs[at] = pairTf.get(i);
    }
  }
  const docidBytes = ids.map(id => encoder.encode(id)), docidOffsets = new Uint32Array(n + 1);
  docidBytes.forEach((bytes, d) => { docidOffsets[d + 1] = docidOffsets[d]! + bytes.length; });
  await mkdir(out, { recursive: true });
  const files: Record<string, ArrayBufferView> = {
    "lexicon.bin": Buffer.concat(byTerm.map(term => term.bytes)), "lexicon.u32": lexiconOffsets, "flat.off.f64": offsets,
    "flat.doc.u32": docs, "flat.tf.u16": tfs, "docids.bin": Buffer.concat(docidBytes), "docids.u32": docidOffsets,
    "lengths.u32": Uint32Array.from({ length: n }, (_, d) => lengths.get(d)), "store.f64": Float64Array.from(store),
  };
  for (const [name, data] of Object.entries(files)) await Bun.write(join(out, name), data);
  await Bun.write(join(out, "segment.json"), JSON.stringify({ documents: n, indexed, tokens, terms: t, postings, sources, peak_rss_bytes: process.memoryUsage().rss }));
}

function splitPoints(corpus: string, segments: number): number[] {
  const size = Bun.file(corpus).size, points = [0], fd = openSync(corpus, "r"), buffer = Buffer.alloc(1 << 20);
  try {
    for (let i = 1; i < segments; i++) {
      let at = Math.max(points.at(-1)!, Math.floor(size * i / segments));
      for (;;) {
        const read = readSync(fd, buffer, 0, buffer.length, at);
        if (!read) { at = size; break; }
        const newline = buffer.subarray(0, read).indexOf(10);
        if (newline >= 0) { at += newline + 1; break; }
        at += read;
      }
      points.push(at);
    }
  } finally { closeSync(fd); }
  points.push(size);
  return points;
}

export async function buildDiskIndex(corpus: string, out: string, parameters: Parameters, options: { segments?: number; parallel?: number } = {}) {
  validateParameters(parameters);
  const started = performance.now();
  const bytes = Bun.file(corpus).size;
  const segments = options.segments ?? Math.max(1, Math.ceil(bytes / SEGMENT_BYTES));
  const parallel = options.parallel ?? 4;
  const temporary = `${out}.${process.pid}.part`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  const hashing = hashFile(corpus);
  const points = splitPoints(corpus, segments);
  const directories = points.slice(1).map((_, i) => join(temporary, `segment-${i}`));
  if (segments === 1) await writeSegment(corpus, 0, bytes, directories[0]!);
  else {
    let next = 0;
    const worker = async () => {
      while (next < segments) {
        const i = next++;
        const child = Bun.spawn([process.execPath, import.meta.path, "--corpus", corpus, "--out", directories[i]!, "--segment-start", String(points[i]), "--segment-end", String(points[i + 1])], { stdout: "inherit", stderr: "inherit" });
        if (await child.exited !== 0) throw new Error(`Segment ${i} failed`);
        console.error(`Segment ${i + 1}/${segments} written`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, segments) }, worker));
  }
  const segmentMs = performance.now() - started;
  const parts = directories.map(directory => {
    const meta = JSON.parse(readFileSync(join(directory, "segment.json"), "utf8"));
    const file = (name: string) => join(directory, name);
    return {
      meta, lexicon: view(Uint8Array, 1, file("lexicon.bin")), lexiconOffsets: view(Uint32Array, 4, file("lexicon.u32")),
      offsets: view(Float64Array, 8, file("flat.off.f64")), docs: view(Uint32Array, 4, file("flat.doc.u32")), tfs: view(Uint16Array, 2, file("flat.tf.u16")),
      docids: view(Uint8Array, 1, file("docids.bin")), docidOffsets: view(Uint32Array, 4, file("docids.u32")),
      lengths: view(Uint32Array, 4, file("lengths.u32")), store: view(Float64Array, 8, file("store.f64")), base: 0, term: 0,
    };
  });
  let n = 0, tokens = 0, indexed = 0, peak = 0;
  const sources = new Map<string, number>();
  for (const part of parts) {
    part.base = n;
    n += part.meta.documents; tokens += part.meta.tokens; indexed += part.meta.indexed;
    peak = Math.max(peak, part.meta.peak_rss_bytes);
    for (const [name, count] of Object.entries(part.meta.sources as Record<string, number>)) sources.set(name, (sources.get(name) ?? 0) + count);
  }
  if (!n) throw new Error("Cannot build an empty index");

  const decoder = new TextDecoder(), ids: string[] = [];
  const docidOffsets = new Uint32Array(n + 1), lengths = new Uint32Array(n), norms = new Uint8Array(n), store = new Float64Array(n * 2);
  for (const part of parts) {
    const byteBase = docidOffsets[part.base]!;
    for (let d = 0; d < part.meta.documents; d++) {
      const doc = part.base + d;
      ids.push(decoder.decode(part.docids.subarray(part.docidOffsets[d]!, part.docidOffsets[d + 1]!)));
      docidOffsets[doc + 1] = byteBase + part.docidOffsets[d + 1]!;
      norms[doc] = lengthByte(lengths[doc] = part.lengths[d]!);
      store[doc * 2] = part.store[d * 2]!;
      store[doc * 2 + 1] = part.store[d * 2 + 1]!;
    }
  }
  const byRank = Uint32Array.from({ length: n }, (_, d) => d).sort((a, b) => ids[a]! < ids[b]! ? -1 : ids[a]! > ids[b]! ? 1 : 0);
  const rank = new Uint32Array(n);
  byRank.forEach((d, r) => {
    rank[d] = r;
    if (r && ids[byRank[r - 1]!] === ids[d]) throw new Error(`Duplicate document ID ${ids[d]}`);
  });
  ids.length = 0;

  const avgdl = tokens / indexed, normTable = new Float64Array(256);
  for (let b = 0; b < 256; b++) {
    if (luceneLength(byteLength(b)) !== byteLength(b)) throw new Error("Length quantization is not idempotent");
    normTable[b] = lengthNorm(byteLength(b), avgdl, parameters, true);
  }

  const file = (name: string) => join(temporary, name);
  const writers = Object.fromEntries(["lexicon.bin", "flat.doc.u32", "flat.tf.u16", "vbyte.bin", "block.words.u32"].map(name => [name, Bun.file(file(name)).writer()]));
  const lexiconOffsets = [0], dfs: number[] = [], flatOffsets = [0], vbyteOffsets = [0], termBlock: number[] = [], termMax: number[] = [];
  const blockLast: number[] = [], blockOffset: number[] = [], blockWidth: number[] = [], blockMax: number[] = [];
  const gaps = new Uint32Array(BLOCK), freq = new Uint32Array(BLOCK), packed = new Uint32Array(BLOCK * 2);
  let docs = new Uint32Array(1024), tfs = new Uint16Array(1024), postings = 0, wordCount = 0;
  const head = (part: (typeof parts)[number]) => part.lexicon.subarray(part.lexiconOffsets[part.term]!, part.lexiconOffsets[part.term + 1]!);
  for (;;) {
    let term: Uint8Array | null = null;
    for (const part of parts) {
      if (part.term >= part.meta.terms) continue;
      const candidate = head(part);
      if (!term || Buffer.compare(candidate, term) < 0) term = candidate;
    }
    if (!term) break;
    const key = Buffer.from(term);
    let df = 0;
    for (const part of parts) {
      if (part.term >= part.meta.terms || Buffer.compare(head(part), key)) continue;
      const start = part.offsets[part.term]!, end = part.offsets[part.term + 1]!;
      if (df + end - start > docs.length) {
        const size = Math.max(docs.length * 2, df + end - start);
        const grownDocs = new Uint32Array(size), grownTfs = new Uint16Array(size);
        grownDocs.set(docs.subarray(0, df)); grownTfs.set(tfs.subarray(0, df));
        docs = grownDocs; tfs = grownTfs;
      }
      for (let i = start; i < end; i++, df++) { docs[df] = part.docs[i]! + part.base; tfs[df] = part.tfs[i]!; }
      part.term++;
    }
    writers["lexicon.bin"]!.write(key);
    lexiconOffsets.push(lexiconOffsets.at(-1)! + key.length);
    dfs.push(df);
    writers["flat.doc.u32"]!.write(docs.slice(0, df));
    writers["flat.tf.u16"]!.write(tfs.slice(0, df));
    postings += df;
    flatOffsets.push(postings);

    const bytes: number[] = [];
    for (let i = 0, previous = 0; i < df; i++) {
      vbytePut(bytes, docs[i]! - previous);
      vbytePut(bytes, tfs[i]!);
      previous = docs[i]!;
    }
    writers["vbyte.bin"]!.write(Uint8Array.from(bytes));
    vbyteOffsets.push(vbyteOffsets.at(-1)! + bytes.length);

    termBlock.push(blockLast.length);
    let best = 0;
    for (let first = 0; first < df; first += BLOCK) {
      const size = Math.min(BLOCK, df - first);
      let previous = first ? blockLast.at(-1)! : 0, max = 0;
      for (let i = 0; i < size; i++) {
        const doc = docs[first + i]!, tf = tfs[first + i]!;
        gaps[i] = doc - previous;
        freq[i] = tf - 1;
        previous = doc;
        max = Math.max(max, saturation(tf, normTable[norms[doc]!]!));
      }
      const gapWidth = bitWidth(gaps, size), tfWidth = bitWidth(freq, size);
      let used = pack(gaps, size, gapWidth, packed, 0);
      used += pack(freq, size, tfWidth, packed, used);
      writers["block.words.u32"]!.write(packed.slice(0, used));
      blockOffset.push(wordCount);
      blockLast.push(previous);
      blockWidth.push(gapWidth, tfWidth);
      blockMax.push(max);
      best = Math.max(best, max);
      wordCount += used;
    }
    termMax.push(best);
    if (dfs.length % 500_000 === 0) console.error(`Merged ${dfs.length} terms; RSS ${(process.memoryUsage().rss / 2 ** 30).toFixed(2)} GiB`);
  }
  termBlock.push(blockLast.length);
  blockOffset.push(wordCount);
  if (postings >= 2 ** 32 || wordCount >= 2 ** 32) throw new Error("Postings exceed the 32-bit format");
  for (const writer of Object.values(writers)) await writer.end();
  peak = Math.max(peak, process.memoryUsage().rss);

  const files: Record<string, ArrayBufferView> = {
    "lexicon.u32": Uint32Array.from(lexiconOffsets), "df.u32": Uint32Array.from(dfs),
    "lengths.u32": lengths, "norms.u8": norms,
    "docids.bin": Buffer.concat(parts.map(part => part.docids)), "docids.u32": docidOffsets, "rank.u32": rank, "byrank.u32": byRank,
    "store.f64": store, "flat.off.f64": Float64Array.from(flatOffsets), "vbyte.off.f64": Float64Array.from(vbyteOffsets),
    "block.term.u32": Uint32Array.from(termBlock), "block.last.u32": Uint32Array.from(blockLast), "block.off.u32": Uint32Array.from(blockOffset),
    "block.width.u8": Uint8Array.from(blockWidth), "block.max.f32": Float32Array.from(blockMax), "term.max.f32": Float32Array.from(termMax),
  };
  for (const [name, data] of Object.entries(files)) await Bun.write(file(name), data);
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  const sizes: Record<string, number> = {};
  for (const name of [...Object.keys(files), ...Object.keys(writers)].sort()) sizes[name] = Bun.file(file(name)).size;
  const meta = {
    format: FORMAT, analyzer: "anserini", block_size: BLOCK, parameters,
    documents: n, indexed_documents: indexed, tokens, avgdl, terms: dfs.length, postings, blocks: blockLast.length,
    sources: [...sources].map(([name, documents]) => ({ name, documents })),
    corpus: { path: resolve(corpus), sha256: await hashing, bytes },
    build: { segments, parallel, segment_ms: segmentMs, total_ms: performance.now() - started, peak_sampled_rss_bytes: peak },
    sizes,
  };
  await Bun.write(file("meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  await rm(out, { recursive: true, force: true });
  await rename(temporary, out);
  return meta;
}

if (import.meta.main) {
  const config = args(["corpus", "out"], ["corpus", "out", "k1", "b", "segments", "parallel", "segment-start", "segment-end"]);
  if (config["segment-start"]) await writeSegment(config.corpus!, Number(config["segment-start"]), Number(config["segment-end"]), config.out!);
  else {
    const meta = await buildDiskIndex(config.corpus!, config.out!, { k1: Number(config.k1 ?? 0.9), b: Number(config.b ?? 0.4) },
      { segments: config.segments ? Number(config.segments) : undefined, parallel: config.parallel ? Number(config.parallel) : undefined });
    console.log(JSON.stringify(meta, null, 2));
  }
}
