import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { validateDocument, type Document } from "../engine/document.ts";
import { args, lines } from "./io.ts";
import {
  asDocument,
  documentChecksum,
  htmlToText,
  parseXmlRow,
  requiredAttribute,
  stackExchangeLicense,
  STACK_LICENSE_URL,
  type ImportManifest,
} from "./corpus.ts";

export type ImportFormat = "msmarco" | "beir" | "stackexchange";

export interface ImportOptions {
  format: ImportFormat;
  input: string;
  out: string;
  source?: string;
  links?: string;
  limit?: number | string;
}

export interface ImportResult {
  outputPath: string;
  manifestPath: string;
  labelsPath?: string;
  documentCount: number;
  manifest: ImportManifest;
}

class TempWriter {
  readonly path: string;
  private readonly handlePromise: ReturnType<typeof open>;
  private readonly digest = createHash("sha256");
  private closed = false;

  constructor(path: string) {
    this.path = path;
    this.handlePromise = open(path, "wx");
  }

  async write(value: string): Promise<void> {
    if (this.closed) throw new Error("Cannot write a closed temporary file");
    const handle = await this.handlePromise;
    this.digest.update(value, "utf8");
    await handle.write(value, undefined, "utf8");
  }

  async close(): Promise<string> {
    if (this.closed) return this.digest.digest("hex");
    this.closed = true;
    const handle = await this.handlePromise;
    await handle.sync();
    await handle.close();
    return this.digest.digest("hex");
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      const handle = await this.handlePromise;
      await handle.close();
    } catch {
      // The open itself may have failed; there is no handle left to close.
    }
  }
}

function tempPath(path: string): string {
  return `${path}.${randomUUID()}.tmp`;
}

async function removeIfPresent(path: string | undefined): Promise<void> {
  if (!path) return;
  await rm(path, { force: true }).catch(() => undefined);
}

async function requireReadableFile(path: string, label: string): Promise<void> {
  try {
    const details = await stat(path);
    if (!details.isFile()) throw new Error(`${label} is not a file: ${path}`);
    const handle = await open(path, "r");
    await handle.close();
  } catch (error) {
    throw new Error(`Cannot read ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function parseLimit(value: ImportOptions["limit"]): number | undefined {
  if (value === undefined) return undefined;
  const limit = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("--limit must be a non-negative integer");
  return limit;
}

function outputConfig(options: ImportOptions, limit: number | undefined): Record<string, string | number | null> {
  return {
    source: options.source ?? null,
    links: options.links ?? null,
    limit: limit ?? null,
  };
}

function sourceLicense(format: ImportFormat) {
  if (format === "stackexchange") {
    return { name: "CC BY-SA 2.5, CC BY-SA 3.0, or CC BY-SA 4.0 by creation date", url: STACK_LICENSE_URL };
  }
  if (format === "msmarco") {
    return { name: "MS MARCO dataset terms", url: "https://microsoft.github.io/msmarco/" };
  }
  return { name: "BEIR source-dataset terms", url: "https://github.com/beir-cellar/beir" };
}

function sourceHost(source: string): string {
  const site = source.toLowerCase();
  return site === "stackoverflow" ? "stackoverflow.com" : `${site}.stackexchange.com`;
}

function stackDocument(
  attributes: Record<string, string>,
  source: string,
  lineNumber: number,
): { document: Document; sourceId: string; question: boolean } {
  const sourceId = requiredAttribute(attributes, "Id", lineNumber);
  const type = requiredAttribute(attributes, "PostTypeId", lineNumber);
  if (type !== "1" && type !== "2") throw new Error(`Unsupported post type ${type} at line ${lineNumber}`);
  const creationDate = requiredAttribute(attributes, "CreationDate", lineNumber);
  if (!Number.isFinite(Date.parse(creationDate))) throw new Error(`Invalid CreationDate at line ${lineNumber}`);
  const rawBody = requiredAttribute(attributes, "Body", lineNumber);
  const title = attributes.Title ?? "";
  const body = htmlToText(rawBody);
  const host = sourceHost(source);
  const question = type === "1";
  const authorId = attributes.OwnerUserId;
  const author = attributes.OwnerDisplayName ?? (authorId ? `user:${authorId}` : "unknown");

  const document = asDocument({
    doc_id: `${source}:${sourceId}`,
    uri: `https://${host}/${question ? "questions" : "a"}/${sourceId}`,
    title: question ? title : "",
    body,
    source,
    content_type: question ? "question" : "answer",
    published_at: creationDate,
    attribution: {
      author,
      author_uri: authorId ? `https://${host}/users/${authorId}` : null,
      license: stackExchangeLicense(creationDate, attributes.ContentLicense),
    },
    checksum: documentChecksum(title, body),
  });
  validateDocument(document);
  return { document, sourceId, question };
}

async function importMsmarco(
  input: string,
  add: (document: Document, sourceId: string, question: boolean) => Promise<boolean>,
): Promise<void> {
  let lineNumber = 0;
  for await (const line of lines(input)) {
    lineNumber++;
    const separator = line.indexOf("\t");
    if (separator <= 0) throw new Error(`Malformed MS MARCO TSV at line ${lineNumber}`);
    const id = line.slice(0, separator);
    if (!/^\d+$/.test(id)) throw new Error(`MS MARCO ID must be numeric at line ${lineNumber}`);
    const body = line.slice(separator + 1);
    const document = asDocument({
      doc_id: id,
      uri: "",
      title: "",
      body,
      source: "msmarco",
      content_type: "passage",
      published_at: null,
      checksum: documentChecksum("", body),
    });
    validateDocument(document);
    await add(document, id, false);
  }
}

async function importBeir(
  input: string,
  source: string,
  add: (document: Document, sourceId: string, question: boolean) => Promise<boolean>,
): Promise<void> {
  let lineNumber = 0;
  for await (const line of lines(input)) {
    lineNumber++;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`Malformed BEIR JSON at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!value || typeof value !== "object") throw new Error(`Malformed BEIR record at line ${lineNumber}`);
    const record = value as { _id?: unknown; title?: unknown; text?: unknown };
    if ((typeof record._id !== "string" && typeof record._id !== "number") ||
        (typeof record._id === "string" && record._id.length === 0) ||
        (typeof record._id === "number" && !Number.isFinite(record._id))) {
      throw new Error(`BEIR _id must be a string or number at line ${lineNumber}`);
    }
    if (typeof record.title !== "string" || typeof record.text !== "string") {
      throw new Error(`BEIR title and text must be strings at line ${lineNumber}`);
    }
    const id = String(record._id);
    const document = asDocument({
      doc_id: id,
      uri: "",
      title: record.title,
      body: record.text,
      source,
      content_type: "document",
      published_at: null,
      checksum: documentChecksum(record.title, record.text),
    });
    validateDocument(document);
    await add(document, id, false);
  }
}

async function importStackExchange(
  input: string,
  source: string,
  limit: number | undefined,
  add: (document: Document, sourceId: string, question: boolean) => Promise<boolean>,
): Promise<void> {
  let lineNumber = 0;
  let imported = 0;
  for await (const line of lines(input)) {
    lineNumber++;
    if (limit !== undefined && imported >= limit) break;
    const trimmed = line.replace(/^\uFEFF/, "").trim();
    if (/^<\?xml\b[\s\S]*\?>$/i.test(trimmed) || /^<posts(?:\s[^>]*)?>$/i.test(trimmed) || /^<\/posts>$/i.test(trimmed)) continue;
    const row = parseXmlRow(line, lineNumber).attributes;
    const type = requiredAttribute(row, "PostTypeId", lineNumber);
    if (type !== "1" && type !== "2") continue;
    const parsed = stackDocument(row, source, lineNumber);
    if (await add(parsed.document, parsed.sourceId, parsed.question)) imported++;
  }
}

async function importLinks(
  path: string,
  writer: TempWriter,
  sourceIds: Map<string, string>,
  questionIds: Set<string>,
): Promise<number> {
  let lineNumber = 0;
  let rowCount = 0;
  const written = new Set<string>();
  for await (const line of lines(path)) {
    lineNumber++;
    const trimmed = line.replace(/^\uFEFF/, "").trim();
    if (/^<\?xml\b[\s\S]*\?>$/i.test(trimmed) || /^<postlinks(?:\s[^>]*)?>$/i.test(trimmed) || /^<\/postlinks>$/i.test(trimmed)) continue;
    const row = parseXmlRow(line, lineNumber).attributes;
    const type = requiredAttribute(row, "LinkTypeId", lineNumber);
    if (type !== "3") continue;
    const postId = requiredAttribute(row, "PostId", lineNumber);
    const relatedId = requiredAttribute(row, "RelatedPostId", lineNumber);
    if (!questionIds.has(postId) || !questionIds.has(relatedId)) continue;
    const left = sourceIds.get(postId);
    const right = sourceIds.get(relatedId);
    if (!left || !right || left === right) continue;
    const key = `${left}\t${right}`;
    if (written.has(key)) continue;
    written.add(key);
    await writer.write(`${left}\t0\t${right}\t1\n`);
    rowCount++;
  }
  return rowCount;
}

export async function importCorpus(options: ImportOptions): Promise<ImportResult> {
  if (!options || !["msmarco", "beir", "stackexchange"].includes(options.format)) {
    throw new Error("format must be msmarco, beir, or stackexchange");
  }
  const format = options.format;
  if (!options.input || !options.out) throw new Error("input and out are required");
  if (format !== "msmarco" && !options.source) throw new Error(`source is required for ${format}`);
  if (format !== "stackexchange" && options.links) throw new Error("links is only supported for stackexchange");
  if (format === "stackexchange" && options.source && !/^[a-z0-9-]+$/i.test(options.source)) {
    throw new Error("stackexchange source must be a Stack Exchange site name");
  }
  const limit = parseLimit(options.limit);
  const inputPath = resolve(options.input);
  const outputPath = resolve(options.out);
  const manifestPath = `${outputPath}.manifest.json`;
  const labelsPath = options.links ? `${outputPath}.qrels.tsv` : undefined;
  if (inputPath === outputPath || inputPath === resolve(manifestPath) || (options.links && resolve(options.links) === outputPath)) {
    throw new Error("input and output paths must be different");
  }
  await requireReadableFile(inputPath, "input");
  if (options.links) await requireReadableFile(resolve(options.links), "links input");

  const parent = dirname(outputPath);
  try {
    const details = await stat(parent);
    if (!details.isDirectory()) throw new Error(`${parent} is not a directory`);
  } catch (error) {
    throw new Error(`Cannot use output directory ${parent}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const outputTemp = tempPath(outputPath);
  const manifestTemp = tempPath(manifestPath);
  const labelsTemp = labelsPath ? tempPath(labelsPath) : undefined;
  const outputWriter = new TempWriter(outputTemp);
  const labelsWriter = labelsTemp ? new TempWriter(labelsTemp) : undefined;
  const documentIds = new Set<string>();
  const sourceIds = labelsWriter ? new Map<string, string>() : undefined;
  const questionIds = labelsWriter ? new Set<string>() : undefined;
  let labelCount = 0;
  let manifestWriter: TempWriter | undefined;

  try {
    const add = async (document: Document, sourceId: string, question: boolean): Promise<boolean> => {
      if (documentIds.has(document.doc_id)) return false;
      validateDocument(document);
      documentIds.add(document.doc_id);
      sourceIds?.set(sourceId, document.doc_id);
      if (question) questionIds?.add(sourceId);
      await outputWriter.write(`${JSON.stringify(document)}\n`);
      return true;
    };

    if (format === "msmarco") await importMsmarco(inputPath, add);
    else if (format === "beir") await importBeir(inputPath, options.source!, add);
    else await importStackExchange(inputPath, options.source!, limit, add);
    const outputHash = await outputWriter.close();

    let labelsHash: string | undefined;
    if (labelsWriter) {
      labelCount = await importLinks(resolve(options.links!), labelsWriter, sourceIds!, questionIds!);
      labelsHash = await labelsWriter.close();
    }

    const sourceHash = await hashFile(inputPath);
    const manifest: ImportManifest = {
      version: 1,
      format,
      config: outputConfig(options, limit),
      source: { path: inputPath, sha256: sourceHash, license: sourceLicense(format) },
      output: { path: outputPath, sha256: outputHash },
      document_count: documentIds.size,
    };
    if (labelsPath && labelsHash) {
      manifest.links = { path: labelsPath, sha256: labelsHash, relation: "duplicate", row_count: labelCount };
    }

    manifestWriter = new TempWriter(manifestTemp);
    await manifestWriter.write(`${JSON.stringify(manifest, null, 2)}\n`);
    await manifestWriter.close();

    // Parsing and hashing are complete before either destination is replaced.
    await rename(outputTemp, outputPath);
    if (labelsTemp && labelsPath) await rename(labelsTemp, labelsPath);
    await rename(manifestTemp, manifestPath);
    return {
      outputPath,
      manifestPath,
      ...(labelsPath ? { labelsPath } : {}),
      documentCount: documentIds.size,
      manifest,
    };
  } catch (error) {
    await Promise.all([outputWriter.abort(), labelsWriter?.abort(), manifestWriter?.abort()]);
    await removeIfPresent(outputTemp);
    await removeIfPresent(labelsTemp);
    await removeIfPresent(manifestTemp);
    throw error;
  }
}

function cliOptions(): ImportOptions {
  const values = args(["format", "input", "out"], ["format", "input", "out", "source", "links", "limit"]);
  if (values.format !== "msmarco" && values.format !== "beir" && values.format !== "stackexchange") {
    throw new Error("--format must be msmarco, beir, or stackexchange");
  }
  return {
    format: values.format,
    input: values.input!,
    out: values.out!,
    source: values.source,
    links: values.links,
    limit: values.limit,
  };
}

if (import.meta.main) {
  try {
    const result = await importCorpus(cliOptions());
    console.log(JSON.stringify({
      output: result.outputPath,
      manifest: result.manifestPath,
      labels: result.labelsPath ?? null,
      document_count: result.documentCount,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
