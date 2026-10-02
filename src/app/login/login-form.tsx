"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Input, Label } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const DEMO_ACCOUNTS = [
  { email: "staff@demo.local", label: "Staff", note: "General SOPs only" },
  { email: "manager@demo.local", label: "Manager", note: "+ incident escalation" },
  { email: "hr@demo.local", label: "HR", note: "+ HR policies" },
  { email: "admin@demo.local", label: "Admin", note: "Everything + admin panel" },
];
const DEMO_PASSWORD = "demo-password";

export function LoginForm({ next, demo }: { next: string; demo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: string, p: string) {
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({ email: e, password: p });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            signIn(email, password);
          }}
        >
          <div>
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <Button variant="primary" className="w-full" disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>

      {demo && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium">Try a demo account</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                disabled={busy}
                onClick={() => signIn(a.email, DEMO_PASSWORD)}
                className="rounded-lg border border-line px-3 py-2 text-left hover:border-accent hover:bg-accent-soft disabled:opacity-50"
              >
                <span className="block text-sm font-medium">{a.label}</span>
                <span className="block text-xs text-ink-2">{a.note}</span>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
