import { errorResponse, requireApiUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Opens the original file behind a citation. The document is first read with
 * the user's client, so RLS decides access; only then is a short-lived signed
 * URL issued for the private storage object.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireApiUser();
    const { id } = await params;
    const { data: doc } = await supabase
      .from("documents")
      .select("storage_path, mime_type, source_filename")
      .eq("id", id)
      .maybeSingle();
    if (!doc?.storage_path) return Response.json({ error: "Document not found" }, { status: 404 });

    const isPdf = doc.mime_type === "application/pdf";
    const { data, error } = await createAdminClient()
      .storage.from("documents")
      .createSignedUrl(doc.storage_path, 120, isPdf ? undefined : { download: doc.source_filename });
    if (error || !data) throw error ?? new Error("Could not sign URL");

    const page = Number(new URL(request.url).searchParams.get("page"));
    const target = isPdf && page > 0 ? `${data.signedUrl}#page=${page}` : data.signedUrl;
    return Response.redirect(target, 302);
  } catch (err) {
    return errorResponse(err);
  }
}
