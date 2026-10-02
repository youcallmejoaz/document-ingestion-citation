import { z } from "zod";
import { errorResponse, requireApiUser } from "@/lib/auth";
import { RolesSchema } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentRow } from "@/lib/types";

const Patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  department: z.string().max(100).nullable().optional(),
  allowedRoles: RolesSchema.optional(),
  status: z.enum(["active", "retired"]).optional(),
});

type Params = { params: Promise<{ id: string }> };

/** Edit metadata, change who can see a document, or retire / restore it. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    // Admin writes go through the user's client so RLS double-checks the role.
    const { supabase } = await requireApiUser({ admin: true });
    const { id } = await params;
    const parsed = Patch.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid update" }, { status: 400 });
    const { title, description, department, allowedRoles, status } = parsed.data;

    const { data: current } = await supabase.from("documents").select().eq("id", id).maybeSingle<DocumentRow>();
    if (!current) return Response.json({ error: "Not found" }, { status: 404 });

    const update: Record<string, unknown> = {};
    if (title !== undefined) update.title = title;
    if (description !== undefined) update.description = description;
    if (department !== undefined) update.department = department;
    if (allowedRoles) update.allowed_roles = allowedRoles;
    if (status === "retired") {
      update.status = "retired";
      update.retired_at = new Date().toISOString();
    } else if (status === "active") {
      if (current.chunk_count === 0) {
        return Response.json({ error: "This document has no indexed content. Re-index it first." }, { status: 400 });
      }
      update.status = "active";
      update.retired_at = null;
    }

    const { data, error } = await supabase.from("documents").update(update).eq("id", id).select().single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ document: data });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase } = await requireApiUser({ admin: true });
    const { id } = await params;
    const { data: doc } = await supabase.from("documents").select("id").eq("id", id).maybeSingle();
    if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

    const admin = createAdminClient();
    const { data: files } = await admin.storage.from("documents").list(id, { limit: 100 });
    const paths: string[] = [];
    for (const folder of files ?? []) {
      const { data: inner } = await admin.storage.from("documents").list(`${id}/${folder.name}`);
      for (const f of inner ?? []) paths.push(`${id}/${folder.name}/${f.name}`);
    }
    if (paths.length) await admin.storage.from("documents").remove(paths);

    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
