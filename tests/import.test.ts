import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { importCorpus } from "../eval/import.ts";
import { apiPostsXML } from "../eval/product.ts";

async function inTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "trace-import-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function fileHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("Phase 0 importers", () => {
  test("imports the public API snapshot through the dump parser with attribution and entity decoding", async () => {
    await inTempDir(async directory => {
      const input = join(directory, "api.xml"), out = join(directory, "api.jsonl");
      await writeFile(input, apiPostsXML({ items: [{ question_id: 42, creation_date: 1609459200,
        title: "A &amp; B", body: "<p>Use <code>x &lt; y</code></p>\n<pre>line one\n\tline two</pre>", content_license: "CC BY-SA 4.0",
        owner: { user_id: 5, display_name: "A &amp; Author" } }] }));
      await importCorpus({ format: "stackexchange", input, out, source: "stackoverflow" });
      const doc = JSON.parse(await readFile(out, "utf8"));
      expect(doc.doc_id).toBe("stackoverflow:42");
      expect(doc.title).toBe("A & B");
      expect(doc.body).toContain("Use x < y");
      expect(doc.body).toContain("line one\n\tline two");
      expect(doc.attribution).toEqual({ author: "A & Author", author_uri: "https://stackoverflow.com/users/5", license: "CC BY-SA 4.0" });
      expect(() => apiPostsXML({ items: [{ question_id: 42 }] })).toThrow();
    });
  });
  test("streams MS MARCO TSV, preserves numeric IDs as strings, and records hashes", async () => {
    await inTempDir(async (directory) => {
      const input = join(directory, "collection.tsv");
      const output = join(directory, "docs.jsonl");
      const source = "007\tfirst passage\n007\trepeated source id\n42\tsecond passage\n";
      await writeFile(input, source);

      const result = await importCorpus({ format: "msmarco", input, out: output });
      const records = (await readFile(output, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const manifest = JSON.parse(await readFile(`${output}.manifest.json`, "utf8"));

      expect(records).toHaveLength(2);
      expect(records[0].doc_id).toBe("007");
      expect(records[0].uri).toBe("");
      expect(records[0].title).toBe("");
      expect(typeof records[0].doc_id).toBe("string");
      expect(manifest.document_count).toBe(2);
      expect(manifest.source.sha256).toBe(fileHash(source));
      expect(manifest.output.sha256).toBe(fileHash(await readFile(output, "utf8")));
      expect(result.documentCount).toBe(2);
    });
  });

  test("imports BEIR records with the source and original qids", async () => {
    await inTempDir(async (directory) => {
      const input = join(directory, "corpus.jsonl");
      const output = join(directory, "beir.jsonl");
      await writeFile(input, `${JSON.stringify({ _id: 17, title: "A title", text: "A body" })}\n`);

      await importCorpus({ format: "beir", input, out: output, source: "cqadupstack-android" });
      const record = JSON.parse(await readFile(output, "utf8"));
      expect(record.doc_id).toBe("17");
      expect(record.source).toBe("cqadupstack-android");
      expect(record.title).toBe("A title");
      expect(record.uri).toBe("");
    });
  });

  test("decodes Stack Exchange HTML, preserves code text, deduplicates stable IDs, and writes filtered qrels", async () => {
    await inTempDir(async (directory) => {
      const input = join(directory, "Posts.xml");
      const links = join(directory, "PostLinks.xml");
      const output = join(directory, "stack.jsonl");
      const questionBody = "&lt;p&gt;Use &lt;code&gt;x &amp;amp;&amp;amp; y&lt;/code&gt;&lt;/p&gt;&lt;pre&gt;  a&amp;#10;  b&lt;/pre&gt;";
      await writeFile(input, [
        "<posts>",
        `<row Id="10" PostTypeId="1" CreationDate="2017-01-01T00:00:00.000Z" OwnerUserId="5" OwnerDisplayName="Old &amp; Author" Title="&quot;Entities&quot;" Body="${questionBody}" />`,
        `<row Id="10" PostTypeId="1" CreationDate="2017-01-01T00:00:00.000Z" OwnerUserId="5" OwnerDisplayName="Old &amp; Author" Title="&quot;Entities&quot;" Body="${questionBody}" />`,
        `<row Id="11" PostTypeId="1" CreationDate="2018-05-02T00:00:00.000Z" OwnerUserId="6" Title="New" Body="&lt;p&gt;Question&lt;/p&gt;" />`,
        `<row Id="12" PostTypeId="2" CreationDate="2020-01-01T00:00:00.000Z" OwnerUserId="7" Body="&lt;pre&gt;  answer&lt;/pre&gt;" />`,
        "</posts>",
      ].join("\n"));
      await writeFile(links, [
        "<postlinks>",
        `<row PostId="10" RelatedPostId="11" LinkTypeId="3" />`,
        `<row PostId="10" RelatedPostId="11" LinkTypeId="3" />`,
        `<row PostId="10" RelatedPostId="12" LinkTypeId="3" />`,
        `<row PostId="10" RelatedPostId="11" LinkTypeId="1" />`,
        "</postlinks>",
      ].join("\n"));

      const result = await importCorpus({ format: "stackexchange", input, out: output, source: "stackoverflow", links });
      const records = (await readFile(output, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const old = records.find((record) => record.uri.endsWith("/questions/10"));
      const answer = records.find((record) => record.uri.endsWith("/a/12"));
      const qrels = await readFile(result.labelsPath!, "utf8");

      expect(records).toHaveLength(3);
      expect(old.body).toContain("x && y");
      expect(old.body).toContain("  a\n  b");
      expect(old.title).toBe('"Entities"');
      expect(old.uri).toBe("https://stackoverflow.com/questions/10");
      expect(old.attribution.license).toBe("CC BY-SA 3.0");
      expect(answer.uri).toBe("https://stackoverflow.com/a/12");
      expect(answer.title).toBe("");
      expect(old.doc_id).toBe("stackoverflow:10");
      expect(old.checksum).toBe(fileHash(`${old.title.trim()}\n${old.body.trim()}`));
      expect(qrels.split("\n").filter(Boolean)).toHaveLength(1);
      expect(qrels).toContain("\t0\t");
      expect(JSON.parse(await readFile(`${output}.manifest.json`, "utf8")).links.row_count).toBe(1);
    });
  });

  test("rejects malformed rows without replacing an existing output", async () => {
    await inTempDir(async (directory) => {
      const input = join(directory, "bad.xml");
      const output = join(directory, "existing.jsonl");
      await writeFile(input, "<posts>\n<row Id=\"1\" nope\n</posts>\n");
      await writeFile(output, "keep this output\n");

      await expect(importCorpus({ format: "stackexchange", input, out: output, source: "stackoverflow" })).rejects.toThrow(
        "Malformed XML",
      );
      expect(await readFile(output, "utf8")).toBe("keep this output\n");
    });
  });
});
