import { z } from "zod";
import { errorResponse, requireApiUser } from "@/lib/auth";
import { RolesSchema } from "@/lib/documents";

const Body = z.object({ roles: RolesSchema });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireApiUser({ admin: true });
    const { id } = await params;
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Pick at least one valid role." }, { status: 400 });
    const roles = [...new Set(parsed.data.roles)];
    if (id === user.id && !roles.includes("admin")) {
      return Response.json({ error: "You can't remove your own admin role." }, { status: 400 });
    }
    const { data, error } = await supabase.from("profiles").update({ roles }).eq("id", id).select().single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ profile: data });
  } catch (err) {
    return errorResponse(err);
  }
}
