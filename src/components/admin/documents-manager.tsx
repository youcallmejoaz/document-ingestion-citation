"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import type { DocumentRow, DocumentStatus, Role } from "@/lib/types";
import { ROLE_LABELS, RolePicker } from "./role-picker";

const ACCEPT = ".pdf,.docx,.md,.markdown,.txt";

const STATUS: Record<DocumentStatus, { tone: "good" | "neutral" | "critical" | "warn"; label: string }> = {
  active: { tone: "good", label: "Active" },
  processing: { tone: "warn", label: "Indexing" },
  retired: { tone: "neutral", label: "Retired" },
  failed: { tone: "critical", label: "Failed" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function fileKind(mime: string) {
  if (mime === "application/pdf") return "PDF";
  if (mime.includes("wordprocessingml")) return "DOCX";
  if (mime === "text/markdown") return "MD";
  return "TXT";
}

async function readError(res: Response) {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error ?? `Request failed (${res.status})`;
}

export function DocumentsManager({ documents }: { documents: DocumentRow[] }) {
  const router = useRouter();
  const [showUpload, setShowUpload] = useState(documents.length === 0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; roles: Role[] } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const versionTarget = useRef<DocumentRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter(
      (d) =>
        (statusFilter === "all" || d.status === statusFilter) &&
        (!q || [d.title, d.department, d.source_filename].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [documents, query, statusFilter]);

  const counts = useMemo(() => {
    const c = { active: 0, retired: 0, failed: 0, processing: 0 } as Record<DocumentStatus, number>;
    for (const d of documents) c[d.status]++;
    return c;
  }, [documents]);

  async function run(id: string, action: () => Promise<Response>, success: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await action();
      if (!res.ok) throw new Error(await readError(res));
      setNotice({ tone: "ok", text: success });
      router.refresh();
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  const patch = (d: DocumentRow, body: object, success: string) =>
    run(
      d.id,
      () =>
        fetch(`/api/admin/documents/${d.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      success,
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Documents</h1>
          <p className="text-sm text-ink-2">
            {counts.active} active · {counts.retired} retired
            {counts.failed ? ` · ${counts.failed} failed` : ""}. Retired documents stop appearing in answers immediately.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowUpload((s) => !s)} aria-expanded={showUpload}>
          {showUpload ? "Close" : "Upload document"}
        </Button>
      </div>

      {showUpload && (
        <UploadForm
          onDone={(title) => {
            setShowUpload(false);
            setNotice({ tone: "ok", text: `“${title}” was indexed and is now searchable.` });
            router.refresh();
          }}
        />
      )}

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            "rounded-lg px-3 py-2 text-sm " +
            (notice.tone === "error" ? "bg-critical-soft text-critical" : "bg-accent-soft text-accent-ink")
          }
        >
          {notice.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search title, department or file"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search documents"
        />
        <select
          className="h-10 rounded-lg border border-line bg-surface px-3 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DocumentStatus | "all")}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="retired">Retired</option>
          <option value="failed">Failed</option>
          <option value="processing">Indexing</option>
        </select>
      </div>

      <input
        ref={versionInput}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const doc = versionTarget.current;
          e.target.value = "";
          if (!file || !doc) return;
          const form = new FormData();
          form.append("file", file);
          run(
            doc.id,
            () => fetch(`/api/admin/documents/${doc.id}/version`, { method: "POST", body: form }),
            `Uploaded version ${doc.version + 1} of “${doc.title}”. Answers now use the new version.`,
          );
        }}
      />

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-2">
              <th className="px-4 py-2.5 font-medium">Document</th>
              <th className="px-4 py-2.5 font-medium">Visible to</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Chunks</th>
              <th className="px-4 py-2.5 font-medium">Version</th>
              <th className="px-4 py-2.5 font-medium">Updated</th>
              <th className="px-4 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-2">
                  {documents.length === 0 ? "No documents yet. Upload your first SOP to get started." : "No documents match."}
                </td>
              </tr>
            )}
            {filtered.map((d) => {
              const busy = busyId === d.id;
              const isEditing = editing?.id === d.id;
              return (
                <Fragment key={d.id}>
                  <tr className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{d.title}</p>
                      <p className="mt-0.5 text-xs text-ink-2">
                        <span className="font-medium">{fileKind(d.mime_type)}</span> · {d.source_filename}
                        {d.department ? ` · ${d.department}` : ""}
                      </p>
                      {d.error && <p className="mt-1 text-xs text-critical">{d.error}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {d.allowed_roles.map((r) => (
                          <Badge key={r} tone={r === "hr" || r === "manager" ? "accent" : "neutral"}>
                            {ROLE_LABELS[r]}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS[d.status].tone}>
                        <span aria-hidden="true">●</span> {STATUS[d.status].label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{d.chunk_count}</td>
                    <td className="px-4 py-3 tabular-nums">v{d.version}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-2">{formatDate(d.updated_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(isEditing ? null : { id: d.id, roles: d.allowed_roles })}>
                          Access
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            versionTarget.current = d;
                            versionInput.current?.click();
                          }}
                        >
                          New version
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(d.id, () => fetch(`/api/admin/documents/${d.id}/reindex`, { method: "POST" }), `Re-indexed “${d.title}”.`)
                          }
                        >
                          Re-index
                        </Button>
                        {d.status === "retired" ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(d, { status: "active" }, `Restored “${d.title}”.`)}>
                            Restore
                          </Button>
                        ) : (
                          d.status === "active" && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(d, { status: "retired" }, `Retired “${d.title}”.`)}>
                              Retire
                            </Button>
                          )
                        )}
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`Delete “${d.title}” and its stored file? This can't be undone. Retire it instead to keep a record.`)) {
                              run(d.id, () => fetch(`/api/admin/documents/${d.id}`, { method: "DELETE" }), `Deleted “${d.title}”.`);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                      {busy && <p className="mt-1 text-right text-xs text-ink-2">Working…</p>}
                    </td>
                  </tr>
                  {isEditing && (
                    <tr className="border-b border-line bg-page">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-sm font-medium">Who can see this document?</span>
                          <RolePicker value={editing.roles} onChange={(roles) => setEditing({ id: d.id, roles })} />
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={editing.roles.length === 0 || busy}
                            onClick={async () => {
                              await patch(d, { allowedRoles: editing.roles }, `Updated access for “${d.title}”. No re-indexing needed.`);
                              setEditing(null);
                            }}
                          >
                            Save access
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function UploadForm({ onDone }: { onDone: (title: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [description, setDescription] = useState("");
  const [roles, setRoles] = useState<Role[]>(["staff", "manager", "hr", "admin"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    form.append("department", department);
    form.append("description", description);
    for (const r of roles) form.append("allowedRoles", r);
    const res = await fetch("/api/admin/documents", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      setError(await readError(res));
      return;
    }
    onDone(title || file.name);
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="file">File</Label>
          <input
            id="file"
            type="file"
            accept={ACCEPT}
            required
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
            }}
            className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
          />
          <p className="mt-1 text-xs text-ink-3">
            PDF, Word (.docx), Markdown or text, up to 20 MB. For Google Docs, use File › Download › Microsoft Word.
          </p>
        </div>
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Refund & Returns Policy" />
        </div>
        <div>
          <Label htmlFor="department">Department</Label>
          <Input id="department" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Customer Service" />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </div>
        <div className="md:col-span-2">
          <span className="mb-1.5 block text-sm font-medium">Visible to</span>
          <RolePicker value={roles} onChange={setRoles} />
          <p className="mt-1 text-xs text-ink-3">Staff only get answers from documents shared with one of their roles.</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-critical md:col-span-2">
            {error}
          </p>
        )}
        <div className="md:col-span-2">
          <Button variant="primary" type="submit" disabled={busy || !file || roles.length === 0}>
            {busy ? "Uploading and indexing…" : "Upload and index"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
