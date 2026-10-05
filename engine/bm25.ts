// Lucene's SmallFloat.intToByte4/byte4ToInt length policy, reimplemented in TS.
// Reference: Apache Lucene, Apache-2.0, lucene/core/.../util/SmallFloat.java.
function int4(value: number): number {
  const bits = value === 0 ? 0 : 32 - Math.clz32(value);
  if (bits < 4) return value;
  const shift = bits - 4;
  return ((value >>> shift) & 7) | ((shift + 1) << 3);
}
const free = 255 - int4(0x7fffffff);

export function lengthByte(length: number): number {
  if (!Number.isInteger(length) || length < 0 || length > 0x7fffffff) throw new Error("Invalid field length");
  return length < free ? length : free + int4(length - free);
}

export function byteLength(byte: number): number {
  if (byte < free) return byte;
  const encoded = byte - free;
  const shift = (encoded >>> 3) - 1;
  return free + (shift === -1 ? encoded & 7 : ((encoded & 7) | 8) * 2 ** shift);
}

export function luceneLength(length: number): number { return byteLength(lengthByte(length)); }

export interface Parameters { k1: number; b: number }
export const defaults: Parameters = { k1: 0.9, b: 0.4 };
export function validateParameters(parameters: Parameters): Parameters {
  if (!Number.isFinite(parameters.k1) || parameters.k1 <= 0 || !Number.isFinite(parameters.b) || parameters.b < 0 || parameters.b > 1) {
    throw new Error("BM25 needs finite k1 > 0 and 0 <= b <= 1");
  }
  return parameters;
}

export function idf(n: number, df: number): number { return Math.fround(Math.log(1 + (n - df + 0.5) / (df + 0.5))); }

export function lengthNorm(length: number, avgdl: number, parameters: Parameters, parity: boolean): number {
  if (!parity) return parameters.k1 * (1 - parameters.b + parameters.b * length / avgdl);
  const f = Math.fround;
  const k1 = f(parameters.k1), b = f(parameters.b);
  return f(k1 * f(f(1 - b) + f(f(b * luceneLength(length)) / f(avgdl))));
}

/** Lucene omits the query-independent (k1 + 1) factor. Scores use that convention. */
export function contribution(tf: number, weight: number, norm: number, parity: boolean): number {
  if (!parity) return weight * tf / (tf + norm);
  return fromSaturation(saturation(tf, norm), weight);
}

export function saturation(tf: number, norm: number): number { return Math.fround(tf * Math.fround(1 / norm)); }

export function fromSaturation(x: number, weight: number): number {
  const f = Math.fround;
  return f(weight - f(weight / f(1 + x)));
}
