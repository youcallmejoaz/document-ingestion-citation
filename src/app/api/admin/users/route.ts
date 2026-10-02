import { z } from "zod";
import { errorResponse, requireApiUser } from "@/lib/auth";
import { RolesSchema } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";

const Body = z.object({
  email: z.string().email(),
  fullName: z.string().trim().max(120).optional(),
  password: z.string().min(8).max(72),
  roles: RolesSchema,
});

/** Creates an account. Roles go in app_metadata, which users cannot edit. */
export async function POST(request: Request) {
  try {
    await requireApiUser({ admin: true });
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Enter a valid email, a password of 8+ characters and at least one role." }, { status: 400 });
    }
    const { email, fullName, password, roles } = parsed.data;
    const { data, error } = await createAdminClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { roles },
      user_metadata: fullName ? { full_name: fullName } : {},
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ id: data.user?.id }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
