"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Input, Label } from "@/components/ui";
import type { Profile, Role } from "@/lib/types";
import { RolePicker } from "./role-picker";

export function UsersManager({ profiles, currentUserId }: { profiles: Profile[]; currentUserId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, Role[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  async function save(p: Profile) {
    setBusy(p.id);
    setNotice(null);
    const res = await fetch(`/api/admin/users/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: draft[p.id] }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setNotice({ tone: "error", text: body.error ?? "Couldn't update roles." });
      return;
    }
    setDraft((d) => {
      const next = { ...d };
      delete next[p.id];
      return next;
    });
    setNotice({ tone: "ok", text: `Updated roles for ${p.email}. The change applies to their next question.` });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Users &amp; roles</h1>
          <p className="text-sm text-ink-2">Roles decide which documents each person can get answers from.</p>
        </div>
        <Button variant="primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          {adding ? "Close" : "Add user"}
        </Button>
      </div>

      {adding && (
        <AddUserForm
          onDone={(email) => {
            setAdding(false);
            setNotice({ tone: "ok", text: `Created an account for ${email}.` });
            router.refresh();
          }}
        />
      )}

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={"rounded-lg px-3 py-2 text-sm " + (notice.tone === "error" ? "bg-critical-soft text-critical" : "bg-accent-soft text-accent-ink")}
        >
          {notice.text}
        </p>
      )}

      <Card className="divide-y divide-line">
        {profiles.map((p) => {
          const roles = draft[p.id] ?? p.roles;
          const dirty = draft[p.id] !== undefined;
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-[220px] flex-1">
                <p className="text-sm font-medium">
                  {p.full_name || p.email}
                  {p.id === currentUserId && <span className="ml-1.5 text-xs font-normal text-ink-3">(you)</span>}
                </p>
                {p.full_name && <p className="text-xs text-ink-2">{p.email}</p>}
              </div>
              <RolePicker value={roles} onChange={(r) => setDraft((d) => ({ ...d, [p.id]: r }))} />
              <Button size="sm" variant="primary" disabled={!dirty || roles.length === 0 || busy === p.id} onClick={() => save(p)}>
                Save
              </Button>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function AddUserForm({ onDone }: { onDone: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<Role[]>(["staff"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card className="p-5">
      <form
        className="grid gap-4 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await fetch("/api/admin/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, fullName, password, roles }),
          });
          setBusy(false);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setError(body.error ?? "Couldn't create the user.");
            return;
          }
          onDone(email);
        }}
      >
        <div>
          <Label htmlFor="new-email">Email</Label>
          <Input id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="new-name">Full name</Label>
          <Input id="new-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="new-password">Temporary password</Label>
          <Input id="new-password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="md:col-span-3">
          <span className="mb-1.5 block text-sm font-medium">Roles</span>
          <RolePicker value={roles} onChange={setRoles} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-critical md:col-span-3">
            {error}
          </p>
        )}
        <div className="md:col-span-3">
          <Button variant="primary" type="submit" disabled={busy || roles.length === 0}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
