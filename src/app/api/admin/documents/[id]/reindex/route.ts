import { errorResponse, requireApiUser } from "@/lib/auth";
import { UploadError, reindexDocument } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireApiUser({ admin: true });
    const { id } = await params;
    const { data: doc } = await supabase.from("documents").select().eq("id", id).maybeSingle<DocumentRow>();
    if (!doc) return Response.json({ error: "Not found" }, { status: 404 });
    const chunks = await reindexDocument(createAdminClient(), doc);
    return Response.json({ chunks });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}
