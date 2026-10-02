import { AppHeader } from "@/components/app-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdminPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireAdminPage();
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader profile={profile} active="admin" />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <AdminNav />
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
