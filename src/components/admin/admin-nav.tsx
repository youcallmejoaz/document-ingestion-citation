"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/documents", label: "Documents" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/users", label: "Users & roles" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 border-b border-line" aria-label="Admin sections">
      {LINKS.map((l) => {
        const on = path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={on ? "page" : undefined}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm " +
              (on ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
