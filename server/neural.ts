import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ort from "onnxruntime-node";

export const EMBEDDER = "bge-small-en-v1.5";
export const RERANKER = "ms-marco-MiniLM-L6-v2";
export const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
export const PAIR_TOKENS = 256;
const BATCH = 32;
const PUNCTUATION = /[\p{P}!-\/:-@\[-`{-~]/u;
const CJK = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B820}-\u{2CEAF}\u{2F800}-\u{2FA1F}]/gu;

export class WordPiece {
  private readonly vocab = new Map<string, number>();
  readonly cls: number; readonly sep: number; readonly unk: number;

  constructor(path: string) {
    readFileSync(path, "utf8").split("\n").forEach((token, id) => { if (token) this.vocab.set(token, id); });
    this.cls = this.vocab.get("[CLS]")!; this.sep = this.vocab.get("[SEP]")!; this.unk = this.vocab.get("[UNK]")!;
  }

  encode(text: string): number[] {
    const normalized = text
      .replace(/[\t\n\r]/g, " ").replace(/[\0�\p{C}]/gu, "").replace(CJK, " $& ")
      .normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
    const ids: number[] = [];
    for (const word of normalized.split(/\s+/)) {
      for (const piece of word.split(new RegExp(`(${PUNCTUATION.source})`, "u"))) if (piece) this.word(piece, ids);
    }
    return ids;
  }

  private word(word: string, ids: number[]) {
    const chars = Array.from(word);
    if (chars.length > 100) { ids.push(this.unk); return; }
    const pieces: number[] = [];
    for (let start = 0; start < chars.length;) {
      let end = chars.length, id: number | undefined;
      for (; end > start; end--) if ((id = this.vocab.get((start ? "##" : "") + chars.slice(start, end).join(""))) !== undefined) break;
      if (id === undefined) { ids.push(this.unk); return; }
      pieces.push(id);
      start = end;
    }
    ids.push(...pieces);
  }
}

function tensors(sequences: { ids: number[]; second: number }[], inputs: readonly string[]): Record<string, ort.Tensor> {
  const length = Math.max(...sequences.map(sequence => sequence.ids.length));
  const ids = new BigInt64Array(sequences.length * length), mask = new BigInt64Array(ids.length), types = new BigInt64Array(ids.length);
  sequences.forEach(({ ids: sequence, second }, row) => sequence.forEach((id, i) => {
    ids[row * length + i] = BigInt(id); mask[row * length + i] = 1n; if (i >= second) types[row * length + i] = 1n;
  }));
  const dims = [sequences.length, length];
  const all: Record<string, ort.Tensor> = {
    input_ids: new ort.Tensor("int64", ids, dims), attention_mask: new ort.Tensor("int64", mask, dims), token_type_ids: new ort.Tensor("int64", types, dims),
  };
  return Object.fromEntries(inputs.map(name => [name, all[name]!]));
}

async function session(path: string, threads: number) {
  return ort.InferenceSession.create(path, threads ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : {});
}

export class Embedder {
  private constructor(private readonly session: ort.InferenceSession, private readonly tokenizer: WordPiece, readonly dimensions: number) {}

  static async open(directory: string, threads = 0): Promise<Embedder> {
    const model = await session(join(directory, EMBEDDER, "model.onnx"), threads);
    return new Embedder(model, new WordPiece(join(directory, EMBEDDER, "vocab.txt")), 384);
  }

  async query(text: string): Promise<Float32Array> {
    const ids = [this.tokenizer.cls, ...this.tokenizer.encode(QUERY_PREFIX + text).slice(0, 510), this.tokenizer.sep];
    const output = (await this.session.run(tensors([{ ids, second: Infinity }], this.session.inputNames)))[this.session.outputNames[0]!]!;
    const vector = Float32Array.from((output.data as Float32Array).subarray(0, this.dimensions));
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm;
    return vector;
  }
}

export class Reranker {
  private constructor(private readonly session: ort.InferenceSession, private readonly tokenizer: WordPiece) {}

  static async open(directory: string, threads = 0): Promise<Reranker> {
    const model = await session(join(directory, RERANKER, "model.onnx"), threads);
    return new Reranker(model, new WordPiece(join(directory, RERANKER, "vocab.txt")));
  }

  async score(query: string, passages: string[]): Promise<Float32Array> {
    const scores = new Float32Array(passages.length);
    const question = this.tokenizer.encode(query).slice(0, 64);
    for (let start = 0; start < passages.length; start += BATCH) {
      const pairs = passages.slice(start, start + BATCH).map(passage => {
        const room = PAIR_TOKENS - question.length - 3;
        return { ids: [this.tokenizer.cls, ...question, this.tokenizer.sep, ...this.tokenizer.encode(passage).slice(0, room), this.tokenizer.sep], second: question.length + 2 };
      });
      const output = (await this.session.run(tensors(pairs, this.session.inputNames)))[this.session.outputNames[0]!]!;
      scores.set(output.data as Float32Array, start);
    }
    return scores;
  }
}
