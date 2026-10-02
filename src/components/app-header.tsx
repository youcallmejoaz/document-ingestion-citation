import Link from "next/link";
import type { Profile } from "@/lib/types";
import { Badge, Logo } from "./ui";

export function AppHeader({ profile, active }: { profile: Profile; active: "chat" | "admin" }) {
  const isAdmin = profile.roles.includes("admin");
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      className={
        on
          ? "rounded-md bg-surface-2 px-3 py-1.5 text-sm font-medium text-ink"
          : "rounded-md px-3 py-1.5 text-sm text-ink-2 hover:text-ink"
      }
      aria-current={on ? "page" : undefined}
    >
      {label}
    </Link>
  );

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <Link href="/chat" aria-label="Knowledge Hub home">
        <Logo />
      </Link>
      <nav className="flex items-center gap-1">
        {tab("/chat", "Ask", active === "chat")}
        {isAdmin && tab("/admin/documents", "Admin", active === "admin")}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <div className="hidden items-center gap-1.5 sm:flex" title="Your access roles">
          {profile.roles.map((r) => (
            <Badge key={r} tone={r === "admin" ? "accent" : "neutral"}>
              {r}
            </Badge>
          ))}
        </div>
        <span className="hidden text-sm text-ink-2 md:inline">{profile.full_name || profile.email}</span>
        <form action="/auth/signout" method="post">
          <button className="text-sm text-ink-2 hover:text-ink" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
