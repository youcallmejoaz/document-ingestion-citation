"use client";

import { ROLES, type Role } from "@/lib/types";

export const ROLE_LABELS: Record<Role, string> = {
  staff: "All staff",
  manager: "Managers",
  hr: "HR",
  admin: "Admins",
};

export function RolePicker({
  value,
  onChange,
  name,
}: {
  value: Role[];
  onChange: (roles: Role[]) => void;
  name?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ROLES.map((r) => {
        const on = value.includes(r);
        return (
          <label
            key={r}
            className={
              "cursor-pointer rounded-full border px-3 py-1 text-xs select-none " +
              (on ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-2 hover:border-ink-3")
            }
          >
            <input
              type="checkbox"
              className="sr-only"
              name={name}
              value={r}
              checked={on}
              onChange={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            />
            {ROLE_LABELS[r]}
          </label>
        );
      })}
    </div>
  );
}
