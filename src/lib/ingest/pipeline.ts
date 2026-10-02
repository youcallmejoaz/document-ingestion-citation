import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedder } from "@/lib/ai/provider";
import { chunkBlocks, contextualText, type Chunk } from "./chunk";
import { parseDocument } from "./parse";

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface PreparedChunks {
  chunks: Chunk[];
  embeddings: number[][];
}

/** Parse, chunk and embed. No database writes, so a failure changes nothing. */
export async function prepareChunks(
  data: Uint8Array,
  mimeType: string,
  documentTitle: string,
): Promise<PreparedChunks> {
  const blocks = await parseDocument(data, mimeType);
  const chunks = chunkBlocks(blocks);
  if (chunks.length === 0) {
    throw new Error("No text could be extracted. Scanned PDFs need OCR before upload.");
  }
  const embedder = await getEmbedder();
  const embeddings = await embedder.embed(
    chunks.map((c) => contextualText(documentTitle, c)),
    "document",
  );
  return { chunks, embeddings };
}

/**
 * Atomically replaces a document's chunks (see replace_document_chunks in the
 * migration). Requires the service-role client.
 */
export async function storeChunks(
  admin: SupabaseClient,
  documentId: string,
  { chunks, embeddings }: PreparedChunks,
  status: "active" | "retired" = "active",
) {
  const payload = chunks.map((c, i) => ({
    chunk_index: c.index,
    heading_path: c.headingPath,
    page_start: c.pageStart,
    page_end: c.pageEnd,
    content: c.content,
    token_count: c.tokenCount,
    embedding: JSON.stringify(embeddings[i]),
  }));
  const { error } = await admin.rpc("replace_document_chunks", {
    p_document_id: documentId,
    p_chunks: payload,
    p_status: status,
  });
  if (error) throw new Error(`Saving chunks failed: ${error.message}`);
}

/** Full ingestion for a document row whose file is already in storage. */
export async function ingestDocument(
  admin: SupabaseClient,
  doc: { id: string; title: string; mime_type: string; status?: string },
  data: Uint8Array,
) {
  try {
    const prepared = await prepareChunks(data, doc.mime_type, doc.title);
    await storeChunks(admin, doc.id, prepared, doc.status === "retired" ? "retired" : "active");
    return prepared.chunks.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Leave a document that was already live untouched; only mark new uploads failed.
    if (doc.status === "processing" || doc.status === "failed" || doc.status === undefined) {
      await admin.from("documents").update({ status: "failed", error: message }).eq("id", doc.id);
    }
    throw err;
  }
}
