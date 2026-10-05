import { createHash } from "node:crypto";

import type { Document } from "../engine/document.ts";

export interface ManifestLicense {
  name: string;
  url: string;
}

export interface SourceManifest {
  path: string;
  sha256: string;
  license: ManifestLicense;
}

export interface ImportManifest {
  version: 1;
  format: "msmarco" | "beir" | "stackexchange";
  config: Record<string, string | number | null>;
  source: SourceManifest;
  output: { path: string; sha256: string };
  document_count: number;
  links?: { path: string; sha256: string; relation: "duplicate"; row_count: number };
}

export const STACK_LICENSE_URL = "https://stackoverflow.com/help/licensing";

/**
 * The current Stack Exchange licensing page says contributions before
 * 2011-04-08 are CC BY-SA 2.5, through 2018-05-02 are CC BY-SA 3.0, and
 * later contributions are CC BY-SA 4.0. See
 * https://stackoverflow.com/help/licensing. A dump-provided ContentLicense
 * takes precedence over this fallback timeline.
 */
export function stackExchangeLicense(creationDate: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const timestamp = Date.parse(creationDate);
  if (timestamp < Date.parse("2011-04-08T00:00:00.000Z")) return "CC BY-SA 2.5";
  if (timestamp < Date.parse("2018-05-02T00:00:00.000Z")) return "CC BY-SA 3.0";
  return "CC BY-SA 4.0";
}

export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Deterministic content hash used for checksums and content deduplication. */
export function stableDocumentId(title: string, body: string): string {
  return sha256(`${normalizeText(title)}\n${normalizeText(body)}`);
}

export function documentChecksum(title: string, body: string): string {
  return stableDocumentId(title, body);
}

export function asDocument(value: Omit<Document, "checksum"> & { checksum?: string }): Document {
  return {
    ...value,
    checksum: value.checksum ?? documentChecksum(value.title, value.body),
  };
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: "\u00a0",
  quot: '"',
};

const HTML_ENTITIES: Record<string, string> = {
  bull: "•",
  copy: "©",
  dagger: "†",
  Dagger: "‡",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsaquo: "‹",
  lsquo: "‘",
  mdash: "—",
  micro: "µ",
  middot: "·",
  minus: "−",
  ndash: "–",
  ne: "≠",
  para: "¶",
  plusmn: "±",
  pound: "£",
  raquo: "»",
  rdquo: "”",
  rsaquo: "›",
  rsquo: "’",
  sect: "§",
  times: "×",
  trade: "™",
  reg: "®",
};

export function decodeXmlEntities(value: string, strict = true): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        throw new Error(`Invalid XML character reference ${match}`);
      }
      return String.fromCodePoint(codePoint);
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        throw new Error(`Invalid XML character reference ${match}`);
      }
      return String.fromCodePoint(codePoint);
    }
    const decoded = XML_ENTITIES[lower] ?? HTML_ENTITIES[entity] ?? HTML_ENTITIES[lower];
    if (decoded === undefined) {
      if (!strict) return match;
      throw new Error(`Unknown XML entity ${match}`);
    }
    return decoded;
  });
}

/** Convert Stack Exchange's HTML body while retaining text and code whitespace. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/(?:p|pre|blockquote|li|div|section|article|h[1-6]|table|tr)\s*>/gi, "\n")
    .replace(/<\s*(?:p|pre|blockquote|li|div|section|article|h[1-6]|table|tr)(?:\s[^>]*)?>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return normalizeText(decodeXmlEntities(withBreaks, false).replace(/\u00a0/g, " "));
}

export interface XmlRow {
  attributes: Record<string, string>;
}

/** Parse the self-closing row form emitted by the Stack Exchange data dump. */
export function parseXmlRow(line: string, lineNumber: number): XmlRow {
  const input = line.trim();
  if (!/^<row\b/i.test(input) || !/\/\s*>$/.test(input)) {
    throw new Error(`Malformed XML row at line ${lineNumber}`);
  }

  let cursor = 4;
  const attributes: Record<string, string> = {};
  while (cursor < input.length) {
    while (/\s/.test(input[cursor] ?? "")) cursor++;
    if (input.slice(cursor).match(/^\/\s*>$/)) break;

    const name = /^[A-Za-z_][\w:.-]*/.exec(input.slice(cursor));
    if (!name) throw new Error(`Malformed XML attribute at line ${lineNumber}`);
    cursor += name[0].length;
    while (/\s/.test(input[cursor] ?? "")) cursor++;
    if (input[cursor] !== "=") throw new Error(`Malformed XML attribute at line ${lineNumber}`);
    cursor++;
    while (/\s/.test(input[cursor] ?? "")) cursor++;
    const quote = input[cursor];
    if (quote !== '"' && quote !== "'") throw new Error(`Malformed XML attribute at line ${lineNumber}`);
    cursor++;
    const end = input.indexOf(quote, cursor);
    if (end < 0) throw new Error(`Unterminated XML attribute at line ${lineNumber}`);
    if (attributes[name[0]] !== undefined) throw new Error(`Duplicate XML attribute ${name[0]} at line ${lineNumber}`);
    attributes[name[0]] = decodeXmlEntities(input.slice(cursor, end));
    cursor = end + 1;
  }

  while (/\s/.test(input[cursor] ?? "")) cursor++;
  if (!/^\/\s*>$/.test(input.slice(cursor))) throw new Error(`Malformed XML row at line ${lineNumber}`);
  return { attributes };
}

export function requiredAttribute(attributes: Record<string, string>, name: string, lineNumber: number): string {
  const value = attributes[name];
  if (value === undefined || value === "") throw new Error(`Missing ${name} at line ${lineNumber}`);
  return value;
}
