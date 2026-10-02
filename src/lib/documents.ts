import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ingestDocument, prepareChunks, sha256, storeChunks } from "@/lib/ingest/pipeline";
import { mimeTypeFor } from "@/lib/ingest/parse";
import { ROLES, type DocumentRow } from "@/lib/types";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const RolesSchema = z.array(z.enum(ROLES)).min(1);

export function storagePath(documentId: string, version: number, filename: string) {
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(-120);
  return `${documentId}/v${version}/${safe}`;
}

export async function readUpload(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UploadError("Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("Files must be 20 MB or smaller.");
  let mimeType: string;
  try {
    mimeType = mimeTypeFor(file.name, file.type);
  } catch (err) {
    throw new UploadError((err as Error).message);
  }
  const data = new Uint8Array(await file.arrayBuffer());
  return { file, data, mimeType, checksum: sha256(data) };
}

export class UploadError extends Error {}

/** Creates the document row, stores the original and indexes it. */
export async function createDocument(
  admin: SupabaseClient,
  input: {
    title: string;
    description?: string | null;
    department?: string | null;
    allowedRoles: string[];
    filename: string;
    mimeType: string;
    data: Uint8Array;
    checksum: string;
    uploadedBy: string | null;
  },
): Promise<DocumentRow> {
  const { data: doc, error } = await admin
    .from("documents")
    .insert({
      title: input.title,
      description: input.description || null,
      department: input.department || null,
      allowed_roles: input.allowedRoles,
      source_filename: input.filename,
      mime_type: input.mimeType,
      checksum: input.checksum,
      uploaded_by: input.uploadedBy,
      status: "processing",
    })
    .select()
    .single<DocumentRow>();
  if (error) throw error;

  const path = storagePath(doc.id, 1, input.filename);
  const upload = await admin.storage
    .from("documents")
    .upload(path, input.data, { contentType: input.mimeType, upsert: true });
  if (upload.error) {
    await admin.from("documents").update({ status: "failed", error: upload.error.message }).eq("id", doc.id);
    throw upload.error;
  }
  await admin.from("documents").update({ storage_path: path }).eq("id", doc.id);

  await ingestDocument(admin, doc, input.data);
  const { data: fresh } = await admin.from("documents").select().eq("id", doc.id).single<DocumentRow>();
  return fresh!;
}

/**
 * Replaces a document with a new version. The new file is parsed and embedded
 * before anything changes, so the old version keeps answering questions until
 * the new chunks are swapped in atomically.
 */
export async function replaceDocumentVersion(
  admin: SupabaseClient,
  doc: DocumentRow,
  input: { filename: string; mimeType: string; data: Uint8Array; checksum: string },
): Promise<DocumentRow> {
  if (doc.checksum === input.checksum) throw new UploadError("This file is identical to the current version.");

  const prepared = await prepareChunks(input.data, input.mimeType, doc.title);
  const version = doc.version + 1;
  const path = storagePath(doc.id, version, input.filename);
  const upload = await admin.storage
    .from("documents")
    .upload(path, input.data, { contentType: input.mimeType, upsert: true });
  if (upload.error) throw upload.error;

  await storeChunks(admin, doc.id, prepared, doc.status === "retired" ? "retired" : "active");
  const { data, error } = await admin
    .from("documents")
    .update({
      version,
      storage_path: path,
      source_filename: input.filename,
      mime_type: input.mimeType,
      checksum: input.checksum,
    })
    .eq("id", doc.id)
    .select()
    .single<DocumentRow>();
  if (error) throw error;
  return data;
}

export async function reindexDocument(admin: SupabaseClient, doc: DocumentRow) {
  if (!doc.storage_path) throw new UploadError("This document has no stored file to re-index.");
  const { data: blob, error } = await admin.storage.from("documents").download(doc.storage_path);
  if (error || !blob) throw error ?? new Error("Download failed");
  return ingestDocument(admin, doc, new Uint8Array(await blob.arrayBuffer()));
}
