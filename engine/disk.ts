import { openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "./analyzer.ts";
import { byteLength, contribution, defaults, fromSaturation, idf, lengthNorm, validateParameters, type Parameters } from "./bm25.ts";
import { unpack } from "./codec.ts";
import { validateDocument, type Document } from "./document.ts";
import type { Hit } from "./heap.ts";
import type { TermEvidence } from "./index.ts";

export type Mode = "flat" | "vbyte" | "block" | "maxscore" | "bmw";
export const MODES: Mode[] = ["flat", "vbyte", "block", "maxscore", "bmw"];
const END = 0xffffffff;
const SLACK = 1 + 1e-12;
const below = (bound: number, threshold: number) => Math.fround(bound * SLACK) < threshold;

export interface TermStats { term: string; df: number; blocks: number; bytes: number; blocks_decoded: number; blocks_skipped: number }

function map(path: string): Uint8Array {
  return Bun.file(path).size ? Bun.mmap(path, { shared: true }) : new Uint8Array(0);
}

class RankHeap {
  readonly scores: Float64Array; readonly docs: Uint32Array; readonly ranks: Uint32Array;
  size = 0;
  constructor(readonly k: number, private readonly rank: Uint32Array) {
    if (!Number.isInteger(k) || k < 1) throw new Error("k must be a positive integer");
    this.scores = new Float64Array(k); this.docs = new Uint32Array(k); this.ranks = new Uint32Array(k);
  }
  get threshold(): number { return this.size < this.k ? -Infinity : this.scores[0]!; }
  private less(i: number, j: number) { return this.scores[i]! < this.scores[j]! || (this.scores[i] === this.scores[j] && this.ranks[i]! < this.ranks[j]!); }
  private swap(i: number, j: number) {
    const s = this.scores[i]!, d = this.docs[i]!, r = this.ranks[i]!;
    this.scores[i] = this.scores[j]!; this.docs[i] = this.docs[j]!; this.ranks[i] = this.ranks[j]!;
    this.scores[j] = s; this.docs[j] = d; this.ranks[j] = r;
  }
  add(score: number, doc: number): boolean {
    const rank = this.rank[doc]!;
    if (this.size < this.k) {
      let i = this.size++;
      this.scores[i] = score; this.docs[i] = doc; this.ranks[i] = rank;
      while (i > 0) {
        const parent = (i - 1) >>> 1;
        if (!this.less(i, parent)) break;
        this.swap(i, parent);
        i = parent;
      }
      return true;
    }
    if (score < this.scores[0]! || (score === this.scores[0] && rank < this.ranks[0]!)) return false;
    this.scores[0] = score; this.docs[0] = doc; this.ranks[0] = rank;
    for (let i = 0; ;) {
      const left = i * 2 + 1, right = left + 1;
      if (left >= this.size) break;
      const smaller = right < this.size && this.less(right, left) ? right : left;
      if (!this.less(smaller, i)) break;
      this.swap(i, smaller);
      i = smaller;
    }
    return true;
  }
}

interface Cursor { doc: number; tf: number; next(): void }

class FlatCursor implements Cursor {
  doc = END; tf = 0;
  constructor(private readonly docs: Uint32Array, private readonly tfs: Uint16Array, private at: number, private readonly end: number) { this.load(); }
  private load() {
    if (this.at < this.end) { this.doc = this.docs[this.at]!; this.tf = this.tfs[this.at]!; } else this.doc = END;
  }
  next() { this.at++; this.load(); }
}

class VByteCursor implements Cursor {
  doc = 0; tf = 0;
  constructor(private readonly bytes: Uint8Array, private at: number, private readonly end: number) { this.next(); }
  private read(): number {
    let value = 0, shift = 0, byte: number;
    do { byte = this.bytes[this.at++]!; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  }
  next() {
    if (this.at >= this.end) { this.doc = END; return; }
    this.doc += this.read();
    this.tf = this.read();
  }
}

class BlockCursor implements Cursor {
  doc = END; tf = 0;
  readonly docs = new Int32Array(128); readonly tfs = new Int32Array(128);
  private block: number; private pos = 0; private size = 0; private shallowBlock: number;
  decoded = 0; skipped = 0;
  constructor(private readonly index: DiskIndex, private readonly first: number, private readonly end: number, private readonly df: number, readonly weight: number) {
    this.block = first; this.shallowBlock = first;
    if (first < end) this.decode(); else this.block = end;
  }
  private decode() {
    const index = this.index, b = this.block, at = index.blockOffset[b]!;
    const gapWidth = index.blockWidth[b * 2]!, tfWidth = index.blockWidth[b * 2 + 1]!;
    const size = this.size = b + 1 < this.end ? 128 : this.df - (b - this.first) * 128;
    unpack(index.words, at, size, gapWidth, this.docs);
    unpack(index.words, at + Math.ceil(size * gapWidth / 32), size, tfWidth, this.tfs);
    let doc = b === this.first ? 0 : index.blockLast[b - 1]!;
    for (let i = 0; i < size; i++) { doc += this.docs[i]!; this.docs[i] = doc; this.tfs[i]!++; }
    this.pos = 0;
    this.doc = this.docs[0]!; this.tf = this.tfs[0]!;
    this.decoded++;
  }
  next() {
    if (++this.pos < this.size) { this.doc = this.docs[this.pos]!; this.tf = this.tfs[this.pos]!; return; }
    if (++this.block < this.end) this.decode(); else this.doc = END;
  }
  advance(target: number) {
    if (this.doc >= target) return;
    const last = this.index.blockLast;
    if (last[this.block]! < target) {
      const from = this.block;
      while (++this.block < this.end && last[this.block]! < target);
      this.skipped += this.block - from - 1;
      if (this.block === this.end) { this.doc = END; return; }
      this.decode();
    }
    while (this.docs[this.pos]! < target) this.pos++;
    this.doc = this.docs[this.pos]!; this.tf = this.tfs[this.pos]!;
  }
  shallow(target: number): number {
    const last = this.index.blockLast;
    if (this.shallowBlock < this.block) this.shallowBlock = this.block;
    while (this.shallowBlock < this.end && last[this.shallowBlock]! < target) this.shallowBlock++;
    return this.shallowBlock < this.end ? fromSaturation(this.index.blockMax[this.shallowBlock]!, this.weight) : 0;
  }
  get shallowLast(): number { return this.shallowBlock < this.end ? this.index.blockLast[this.shallowBlock]! : END; }
}

export class DiskIndex {
  readonly meta: {
    format: number; analyzer: "anserini"; block_size: number; parameters: Parameters; documents: number; indexed_documents: number;
    tokens: number; avgdl: number; terms: number; postings: number; blocks: number; sources?: { name: string; documents: number }[]; corpus: { path: string; sha256: string; bytes: number };
    sizes: Record<string, number>;
  };
  readonly analyzer = "anserini" as const;
  readonly lexicon: Uint8Array; readonly lexiconOffsets: Uint32Array; readonly df: Uint32Array;
  readonly lengths: Uint32Array; readonly norms: Uint8Array;
  readonly docids: Uint8Array; readonly docidOffsets: Uint32Array; readonly rank: Uint32Array; readonly byRank: Uint32Array;
  readonly store: Float64Array; private readonly corpus: number;
  readonly flatDocs: Uint32Array; readonly flatTfs: Uint16Array; readonly flatOffsets: Float64Array;
  readonly vbyte: Uint8Array; readonly vbyteOffsets: Float64Array;
  readonly words: Uint32Array; readonly termBlock: Uint32Array; readonly blockLast: Uint32Array; readonly blockOffset: Uint32Array;
  readonly blockWidth: Uint8Array; readonly blockMax: Float32Array; readonly termMax: Float32Array;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private normCache = { key: "", table: new Float64Array(256) };

  constructor(readonly directory: string) {
    this.meta = JSON.parse(readFileSync(join(directory, "meta.json"), "utf8"));
    if (this.meta.format !== 1 || this.meta.block_size !== 128) throw new Error("Unsupported index format");
    const bytes = (name: string) => map(join(directory, name));
    const view = <T>(Type: new (buffer: ArrayBufferLike, offset: number, length: number) => T, size: number, name: string): T => {
      const data = bytes(name);
      return new Type(data.buffer, data.byteOffset, data.byteLength / size);
    };
    this.lexicon = bytes("lexicon.bin"); this.lexiconOffsets = view(Uint32Array, 4, "lexicon.u32"); this.df = view(Uint32Array, 4, "df.u32");
    this.lengths = view(Uint32Array, 4, "lengths.u32"); this.norms = bytes("norms.u8");
    this.docids = bytes("docids.bin"); this.docidOffsets = view(Uint32Array, 4, "docids.u32");
    this.rank = view(Uint32Array, 4, "rank.u32"); this.byRank = view(Uint32Array, 4, "byrank.u32");
    this.store = view(Float64Array, 8, "store.f64");
    this.flatDocs = view(Uint32Array, 4, "flat.doc.u32"); this.flatTfs = view(Uint16Array, 2, "flat.tf.u16"); this.flatOffsets = view(Float64Array, 8, "flat.off.f64");
    this.vbyte = bytes("vbyte.bin"); this.vbyteOffsets = view(Float64Array, 8, "vbyte.off.f64");
    this.words = view(Uint32Array, 4, "block.words.u32"); this.termBlock = view(Uint32Array, 4, "block.term.u32");
    this.blockLast = view(Uint32Array, 4, "block.last.u32"); this.blockOffset = view(Uint32Array, 4, "block.off.u32");
    this.blockWidth = bytes("block.width.u8"); this.blockMax = view(Float32Array, 4, "block.max.f32"); this.termMax = view(Float32Array, 4, "term.max.f32");
    if (Bun.file(this.meta.corpus.path).size !== this.meta.corpus.bytes) throw new Error("Corpus file does not match the index");
    this.corpus = openSync(this.meta.corpus.path, "r");
  }

  get documentCount(): number { return this.meta.documents; }
  get indexedDocuments(): number { return this.meta.indexed_documents; }
  get avgdl(): number { return this.meta.avgdl; }

  lookup(term: string): number {
    const key = this.encoder.encode(term);
    let lo = 0, hi = this.meta.terms;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1, start = this.lexiconOffsets[mid]!, end = this.lexiconOffsets[mid + 1]!;
      let cmp = 0;
      for (let i = 0; !cmp && i < key.length && start + i < end; i++) cmp = this.lexicon[start + i]! - key[i]!;
      if (!cmp) cmp = (end - start) - key.length;
      if (!cmp) return mid;
      if (cmp < 0) lo = mid + 1; else hi = mid;
    }
    return -1;
  }

  docId(doc: number): string { return this.decoder.decode(this.docids.subarray(this.docidOffsets[doc]!, this.docidOffsets[doc + 1]!)); }

  findDoc(id: string): number {
    let lo = 0, hi = this.meta.documents;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1, value = this.docId(this.byRank[mid]!);
      if (value === id) return this.byRank[mid]!;
      if (value < id) lo = mid + 1; else hi = mid;
    }
    return -1;
  }

  document(doc: number): Document {
    const start = this.store[doc * 2]!, line = Buffer.allocUnsafe(this.store[doc * 2 + 1]! - start);
    readSync(this.corpus, line, 0, line.length, start);
    return validateDocument(JSON.parse(this.decoder.decode(line)));
  }

  private normTable(parameters: Parameters): Float64Array {
    const key = `${parameters.k1}:${parameters.b}`;
    if (this.normCache.key !== key) {
      const table = new Float64Array(256);
      for (let b = 0; b < 256; b++) table[b] = lengthNorm(byteLength(b), this.meta.avgdl, parameters, true);
      this.normCache = { key, table };
    }
    return this.normCache.table;
  }

  search(query: string, options: { k?: number; mode?: Mode; parameters?: Parameters; exclude?: string } = {}) {
    const started = performance.now();
    const mode = options.mode ?? "bmw";
    if (!MODES.includes(mode)) throw new Error("Unsupported mode");
    const parameters = validateParameters(options.parameters ?? this.meta.parameters ?? defaults);
    const pruned = mode === "maxscore" || mode === "bmw";
    if (pruned && (parameters.k1 !== this.meta.parameters.k1 || parameters.b !== this.meta.parameters.b)) {
      throw new Error(`Block-max bounds were built for k1=${this.meta.parameters.k1}, b=${this.meta.parameters.b}`);
    }
    const tokens = analyze(query, "anserini");
    const tokenizeMs = performance.now() - started;
    const queryTF = new Map<string, number>();
    for (const token of tokens) queryTF.set(token, (queryTF.get(token) ?? 0) + 1);
    const n = this.meta.indexed_documents;
    const terms = [...queryTF].map(([term, count]) => ({ term, count, id: this.lookup(term) })).filter(term => term.id >= 0);
    const weights = terms.map(({ id, count }) => Math.fround(idf(n, this.df[id]!) * count));
    const cursors: Cursor[] = terms.map(({ id }, i) => {
      if (mode === "flat") return new FlatCursor(this.flatDocs, this.flatTfs, this.flatOffsets[id]!, this.flatOffsets[id + 1]!);
      if (mode === "vbyte") return new VByteCursor(this.vbyte, this.vbyteOffsets[id]!, this.vbyteOffsets[id + 1]!);
      return new BlockCursor(this, this.termBlock[id]!, this.termBlock[id + 1]!, this.df[id]!, weights[i]!);
    });
    const exclude = options.exclude === undefined ? -1 : this.findDoc(options.exclude);
    const heap = new RankHeap(options.k ?? 10, this.rank);
    const norms = this.normTable(parameters);
    const counters = { visited: 0, scored: 0 };
    const retrieveStarted = performance.now();
    if (!pruned) this.exhaustive(cursors, weights, norms, heap, exclude, counters);
    else {
      const bounds = terms.map(({ id }, i) => fromSaturation(this.termMax[id]!, weights[i]!));
      if (mode === "maxscore") this.maxscore(cursors as BlockCursor[], weights, bounds, norms, heap, exclude, counters);
      else this.bmw(cursors as BlockCursor[], weights, bounds, norms, heap, exclude, counters);
    }
    const retrieveMs = performance.now() - retrieveStarted;
    const order = Array.from({ length: heap.size }, (_, i) => i)
      .sort((a, b) => heap.scores[b]! - heap.scores[a]! || heap.ranks[b]! - heap.ranks[a]!);
    const hits: Hit[] = order.map(i => ({ doc_id: this.docId(heap.docs[i]!), index_id: heap.docs[i]!, score: heap.scores[i]! }));
    const termStats: TermStats[] = terms.map(({ term, id }, i) => {
      const cursor = cursors[i];
      const blocks = this.termBlock[id + 1]! - this.termBlock[id]!;
      const bytes = mode === "flat" ? (this.flatOffsets[id + 1]! - this.flatOffsets[id]!) * 6
        : mode === "vbyte" ? this.vbyteOffsets[id + 1]! - this.vbyteOffsets[id]!
        : (this.blockOffset[this.termBlock[id + 1]!]! - this.blockOffset[this.termBlock[id]!]!) * 4;
      return { term, df: this.df[id]!, blocks, bytes, blocks_decoded: cursor instanceof BlockCursor ? cursor.decoded : 0, blocks_skipped: cursor instanceof BlockCursor ? cursor.skipped : 0 };
    });
    return {
      hits, tokens, mode, parameters, candidate_count: counters.scored, postings_visited: counters.visited, terms: termStats,
      timings: { tokenize_ms: tokenizeMs, retrieve_ms: retrieveMs, total_ms: performance.now() - started },
    };
  }

  private exhaustive(cursors: Cursor[], weights: number[], norms: Float64Array, heap: RankHeap, exclude: number, counters: { visited: number; scored: number }) {
    const m = cursors.length;
    while (true) {
      let doc = END;
      for (let i = 0; i < m; i++) if (cursors[i]!.doc < doc) doc = cursors[i]!.doc;
      if (doc === END) break;
      const norm = norms[this.norms[doc]!]!;
      let score = 0;
      for (let i = 0; i < m; i++) {
        const cursor = cursors[i]!;
        if (cursor.doc !== doc) continue;
        counters.visited++;
        score += contribution(cursor.tf, weights[i]!, norm, true);
        cursor.next();
      }
      if (doc === exclude) continue;
      counters.scored++;
      heap.add(Math.fround(score), doc);
    }
  }

  private maxscore(cursors: BlockCursor[], weights: number[], bound: number[], norms: Float64Array, heap: RankHeap, exclude: number, counters: { visited: number; scored: number }) {
    const m = cursors.length;
    const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => bound[a]! - bound[b]!);
    const prefix = new Float64Array(m);
    order.forEach((term, i) => { prefix[i] = (i ? prefix[i - 1]! : 0) + bound[term]!; });
    const contributions = new Float64Array(m), matched = new Uint8Array(m);
    let essential = 0, threshold = heap.threshold;
    while (essential < m && below(prefix[essential]!, threshold)) essential++;
    while (essential < m) {
      let doc = END;
      for (let i = essential; i < m; i++) { const d = cursors[order[i]!]!.doc; if (d < doc) doc = d; }
      if (doc === END) break;
      const norm = norms[this.norms[doc]!]!;
      let partial = 0, abandoned = false;
      for (let i = essential; i < m; i++) {
        const term = order[i]!, cursor = cursors[term]!;
        if (cursor.doc !== doc) continue;
        counters.visited++;
        partial += contributions[term] = contribution(cursor.tf, weights[term]!, norm, true);
        matched[term] = 1;
        cursor.next();
      }
      for (let i = essential - 1; i >= 0; i--) {
        if (below(partial + prefix[i]!, threshold)) { abandoned = true; break; }
        const term = order[i]!, cursor = cursors[term]!;
        cursor.advance(doc);
        if (cursor.doc !== doc) continue;
        counters.visited++;
        partial += contributions[term] = contribution(cursor.tf, weights[term]!, norm, true);
        matched[term] = 1;
      }
      if (!abandoned && doc !== exclude) {
        let score = 0;
        for (let term = 0; term < m; term++) if (matched[term]) score += contributions[term]!;
        counters.scored++;
        if (heap.add(Math.fround(score), doc) && heap.threshold !== threshold) {
          threshold = heap.threshold;
          while (essential < m && below(prefix[essential]!, threshold)) essential++;
        }
      }
      matched.fill(0);
    }
  }

  private bmw(cursors: BlockCursor[], weights: number[], bound: number[], norms: Float64Array, heap: RankHeap, exclude: number, counters: { visited: number; scored: number }) {
    const m = cursors.length;
    const order = Array.from({ length: m }, (_, i) => i);
    const contributions = new Float64Array(m), matched = new Uint8Array(m);
    while (true) {
      for (let i = 1; i < m; i++) {
        const term = order[i]!;
        let j = i;
        while (j > 0 && cursors[order[j - 1]!]!.doc > cursors[term]!.doc) { order[j] = order[j - 1]!; j--; }
        order[j] = term;
      }
      const threshold = heap.threshold;
      let pivot = -1, sum = 0;
      for (let i = 0; i < m; i++) {
        if (cursors[order[i]!]!.doc === END) break;
        sum += bound[order[i]!]!;
        if (!below(sum, threshold)) { pivot = i; break; }
      }
      if (pivot < 0) break;
      const pivotDoc = cursors[order[pivot]!]!.doc;
      while (pivot + 1 < m && cursors[order[pivot + 1]!]!.doc === pivotDoc) pivot++;
      let blockSum = 0;
      for (let i = 0; i <= pivot; i++) blockSum += cursors[order[i]!]!.shallow(pivotDoc);
      if (!below(blockSum, threshold)) {
        if (cursors[order[0]!]!.doc === pivotDoc) {
          const norm = norms[this.norms[pivotDoc]!]!;
          for (let i = 0; i <= pivot; i++) {
            const term = order[i]!, cursor = cursors[term]!;
            counters.visited++;
            contributions[term] = contribution(cursor.tf, weights[term]!, norm, true);
            matched[term] = 1;
            cursor.next();
          }
          if (pivotDoc !== exclude) {
            let score = 0;
            for (let term = 0; term < m; term++) if (matched[term]) score += contributions[term]!;
            counters.scored++;
            heap.add(Math.fround(score), pivotDoc);
          }
          matched.fill(0);
        } else {
          let best = -1;
          for (let i = 0; i < pivot; i++) {
            const term = order[i]!;
            if (cursors[term]!.doc < pivotDoc && (best < 0 || bound[term]! > bound[best]!)) best = term;
          }
          cursors[best]!.advance(pivotDoc);
        }
      } else {
        let target = pivot + 1 < m ? cursors[order[pivot + 1]!]!.doc : END;
        for (let i = 0; i <= pivot; i++) {
          const last = cursors[order[i]!]!.shallowLast;
          if (last !== END && last + 1 < target) target = last + 1;
        }
        if (target <= pivotDoc) target = pivotDoc + 1;
        let best = order[0]!;
        for (let i = 1; i <= pivot; i++) if (bound[order[i]!]! > bound[best]!) best = order[i]!;
        cursors[best]!.advance(target);
      }
    }
  }

  explain(hit: Hit, tokens: string[], parameters: Parameters = this.meta.parameters): TermEvidence[] {
    const qtf = new Map<string, number>();
    for (const term of tokens) qtf.set(term, (qtf.get(term) ?? 0) + 1);
    const norm = this.normTable(parameters)[this.norms[hit.index_id]!]!;
    return [...qtf].map(([term, queryTF]) => {
      const id = this.lookup(term);
      if (id < 0) return { term, query_tf: queryTF, tf: 0, df: 0, idf: 0, length_norm: norm, contribution: 0 };
      let lo = this.flatOffsets[id]!, hi = this.flatOffsets[id + 1]!;
      while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (this.flatDocs[mid]! < hit.index_id) lo = mid + 1; else hi = mid; }
      const tf = lo < this.flatOffsets[id + 1]! && this.flatDocs[lo] === hit.index_id ? this.flatTfs[lo]! : 0;
      const df = this.df[id]!, termIDF = idf(this.meta.indexed_documents, df);
      return { term, query_tf: queryTF, tf, df, idf: termIDF, length_norm: norm, contribution: tf ? contribution(tf, Math.fround(termIDF * queryTF), norm, true) : 0 };
    });
  }
}
