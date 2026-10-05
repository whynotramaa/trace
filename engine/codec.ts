export function vbytePut(out: number[], value: number) {
  while (value >= 128) {
    out.push((value & 127) | 128);
    value >>>= 7;
  }
  out.push(value);
}

export function bitWidth(values: Uint32Array, n: number): number {
  let max = 0;
  for (let i = 0; i < n; i++) max |= values[i]!;
  return max ? 32 - Math.clz32(max) : 0;
}

export function pack(values: Uint32Array, n: number, width: number, out: Uint32Array, at: number): number {
  const words = Math.ceil(n * width / 32);
  out.fill(0, at, at + words);
  if (!width) return words;
  for (let i = 0, bit = 0; i < n; i++, bit += width) {
    const word = at + (bit >>> 5), shift = bit & 31, value = values[i]!;
    out[word]! |= value << shift;
    if (shift + width > 32) out[word + 1]! |= value >>> (32 - shift);
  }
  return words;
}

export function unpack(words: Uint32Array, at: number, n: number, width: number, out: Int32Array) {
  if (!width) { out.fill(0, 0, n); return; }
  const mask = width === 32 ? -1 : (1 << width) - 1;
  for (let i = 0, bit = 0; i < n; i++, bit += width) {
    const word = at + (bit >>> 5), shift = bit & 31;
    let value = words[word]! >>> shift;
    if (shift + width > 32) value |= words[word + 1]! << (32 - shift);
    out[i] = value & mask;
  }
}
