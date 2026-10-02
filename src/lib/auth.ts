import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, roles, created_at")
    .eq("id", user.id)
    .single<Profile>();

  return { supabase, user, profile };
}

/** For pages: redirects to /login when signed out. */
export async function requireUser() {
  const ctx = await getCurrentUser();
  if (!ctx.user || !ctx.profile) redirect("/login");
  return { ...ctx, user: ctx.user, profile: ctx.profile };
}

/** For admin pages: non-admins are sent back to the chat. */
export async function requireAdminPage() {
  const ctx = await requireUser();
  if (!ctx.profile.roles.includes("admin")) redirect("/chat");
  return ctx;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** For route handlers: throws HttpError(401/403) instead of redirecting. */
export async function requireApiUser({ admin = false } = {}) {
  const ctx = await getCurrentUser();
  if (!ctx.user || !ctx.profile) throw new HttpError(401, "Not signed in");
  if (admin && !ctx.profile.roles.includes("admin")) throw new HttpError(403, "Admins only");
  return { ...ctx, user: ctx.user, profile: ctx.profile };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  const message = err instanceof Error ? err.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}
