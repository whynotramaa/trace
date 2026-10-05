import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

/** Stream large inputs rather than retaining the complete file in memory. */
export async function* lines(path: string): AsyncGenerator<string> {
  const source = createReadStream(path);
  const stream = path.endsWith(".gz") ? source.pipe(createGunzip()) : source;
  // pipe() does not forward input errors to the downstream stream.
  if (stream !== source) source.on("error", (error) => stream.destroy(error));
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) if (line.trim()) yield line;
  } finally {
    reader.close();
    stream.destroy();
    source.destroy();
  }
}

export function args(required: string[], allowed: string[] = required): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, "");
    const value = process.argv[i + 1];
    if (!key || !allowed.includes(key) || !value || value.startsWith("--") || result[key]) {
      throw new Error(`Expected --${allowed.join(", --")} with values; unexpected argument ${process.argv[i]}`);
    }
    result[key] = value;
  }
  for (const key of required) if (!result[key]) throw new Error(`Missing --${key}`);
  return result;
}
