export interface Document {
  doc_id: string;
  uri: string;
  title: string;
  body: string;
  source: string;
  content_type: string;
  published_at: string | null;
  checksum: string;
  attribution?: { author: string; author_uri: string | null; license: string };
}

export function validateDocument(value: unknown): Document {
  if (!value || typeof value !== "object") throw new Error("Document must be an object");
  const doc = value as Document;
  for (const key of ["doc_id", "uri", "title", "body", "source", "content_type", "checksum"] as const) {
    if (typeof doc[key] !== "string") throw new Error(`Document ${key} must be a string`);
  }
  if (!doc.doc_id || !doc.source || !doc.content_type || !/^[a-f0-9]{64}$/.test(doc.checksum)) {
    throw new Error("Document requires a stable ID, source, content type, and SHA-256 checksum");
  }
  if (doc.published_at !== null && (typeof doc.published_at !== "string" || !Number.isFinite(Date.parse(doc.published_at)))) {
    throw new Error("published_at must be a valid date or null");
  }
  if (doc.uri && !/^https?:\/\//i.test(doc.uri)) throw new Error("uri must be HTTP(S) or empty for datasets without source URLs");
  return doc;
}
