import { DocumentsManager } from "@/components/admin/documents-manager";
import { requireAdminPage } from "@/lib/auth";
import type { DocumentRow } from "@/lib/types";

export default async function DocumentsPage() {
  const { supabase } = await requireAdminPage();
  const { data } = await supabase.from("documents").select("*").order("updated_at", { ascending: false });
  return <DocumentsManager documents={(data ?? []) as DocumentRow[]} />;
}
