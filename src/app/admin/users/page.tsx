import { UsersManager } from "@/components/admin/users-manager";
import { requireAdminPage } from "@/lib/auth";
import type { Profile } from "@/lib/types";

export default async function UsersPage() {
  const { supabase, profile } = await requireAdminPage();
  const { data } = await supabase.from("profiles").select("*").order("email");
  return <UsersManager profiles={(data ?? []) as Profile[]} currentUserId={profile.id} />;
}
