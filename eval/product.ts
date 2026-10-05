import { mkdir, rename, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { importCorpus } from "./import.ts";
import { decodeXmlEntities } from "./corpus.ts";
import { args } from "./io.ts";
import { hashFile } from "../bench/environment.ts";

/** Convert a public API snapshot through the existing Stack Exchange importer. */
export function apiPostsXML(response: unknown): string {
  const items = (response as { items?: unknown })?.items;
  if (!Array.isArray(items)) throw new Error("Stack Exchange response requires an items array");
  const escape = (value: string) => value.replace(/[&<>"'\n\r\t]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;", "\n": "&#10;", "\r": "&#13;", "\t": "&#9;" })[character]!);
  const rows = items.map(item => {
    if (!item || !Number.isSafeInteger(item.question_id) || item.question_id < 1 ||
      !Number.isSafeInteger(item.creation_date) || typeof item.title !== "string" || typeof item.body !== "string") {
      throw new Error("API question requires an ID, creation date, title, and body");
    }
    const attributes: Record<string, string> = {
      Id: String(item.question_id), PostTypeId: "1", CreationDate: new Date(item.creation_date * 1000).toISOString(),
      Title: decodeXmlEntities(item.title, false), Body: item.body,
    };
    if (typeof item.content_license === "string") attributes.ContentLicense = item.content_license;
    if (Number.isSafeInteger(item.owner?.user_id)) attributes.OwnerUserId = String(item.owner.user_id);
    if (typeof item.owner?.display_name === "string") attributes.OwnerDisplayName = decodeXmlEntities(item.owner.display_name, false);
    return `<row ${Object.entries(attributes).map(([key, value]) => `${key}="${escape(value)}"`).join(" ")} />`;
  });
  return `<posts>\n${rows.join("\n")}\n</posts>\n`;
}

async function main() {
  const config = args(["posts", "links", "stackoverflow", "out"]);
  const out = resolve(config.out!), parent = dirname(out);
  await mkdir(parent, { recursive: true });
  const cs = await importCorpus({ format: "stackexchange", input: config.posts!, links: config.links!, source: "cs", out: `${out}.cs.jsonl` });
  const xml = `${out}.stackoverflow.xml`;
  await Bun.write(xml, apiPostsXML(await Bun.file(config.stackoverflow!).json()));
  const stack = await importCorpus({ format: "stackexchange", input: xml, source: "stackoverflow", out: `${out}.stackoverflow.jsonl` });
  const temporary = `${out}.${process.pid}.part`, writer = Bun.file(temporary).writer();
  try {
    for (const path of [cs.outputPath, stack.outputPath]) for await (const chunk of createReadStream(path)) writer.write(chunk);
    await writer.end();
    await rename(temporary, out);
  } catch (error) { await writer.end(); await rm(temporary, { force: true }); throw error; }
  await Bun.write(`${out}.manifest.json`, JSON.stringify({
    document_count: cs.documentCount + stack.documentCount,
    output: { path: out, sha256: await hashFile(out) },
    sources: [cs.manifest, stack.manifest],
    api_snapshot: { path: config.stackoverflow, sha256: await hashFile(config.stackoverflow!) },
    duplicate_qrels: cs.labelsPath,
  }, null, 2) + "\n");
  console.log(`Imported ${cs.documentCount + stack.documentCount} product documents`);
}

if (import.meta.main) main().catch(error => { console.error(error); process.exitCode = 1; });
