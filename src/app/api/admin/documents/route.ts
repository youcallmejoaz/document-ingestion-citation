import { errorResponse, requireApiUser } from "@/lib/auth";
import { RolesSchema, UploadError, createDocument, readUpload } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { user } = await requireApiUser({ admin: true });
    const form = await request.formData();
    const { file, data, mimeType, checksum } = await readUpload(form);

    const roles = RolesSchema.safeParse(form.getAll("allowedRoles"));
    if (!roles.success) return Response.json({ error: "Pick at least one role." }, { status: 400 });
    const title = String(form.get("title") ?? "").trim() || file.name.replace(/\.[^.]+$/, "");

    const doc = await createDocument(createAdminClient(), {
      title,
      description: String(form.get("description") ?? "").trim(),
      department: String(form.get("department") ?? "").trim(),
      allowedRoles: roles.data,
      filename: file.name,
      mimeType,
      data,
      checksum,
      uploadedBy: user.id,
    });
    return Response.json({ document: doc }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}
