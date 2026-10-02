import { errorResponse, requireApiUser } from "@/lib/auth";
import { UploadError, readUpload, replaceDocumentVersion } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireApiUser({ admin: true });
    const { id } = await params;
    const { data: doc } = await supabase.from("documents").select().eq("id", id).maybeSingle<DocumentRow>();
    if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

    const { file, data, mimeType, checksum } = await readUpload(await request.formData());
    const updated = await replaceDocumentVersion(createAdminClient(), doc, {
      filename: file.name,
      mimeType,
      data,
      checksum,
    });
    return Response.json({ document: updated });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}
