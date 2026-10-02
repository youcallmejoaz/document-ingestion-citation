"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

const REASONS = [
  { value: "wrong", label: "Wrong" },
  { value: "missing", label: "Missing info" },
  { value: "outdated", label: "Outdated" },
  { value: "unclear", label: "Unclear" },
  { value: "other", label: "Other" },
] as const;

function Thumb({ down, filled }: { down?: boolean; filled?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
      style={down ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Zm0 0 4-7a2 2 0 0 1 3 1.7V9h5.2a2 2 0 0 1 2 2.3l-1.3 8A2 2 0 0 1 17 21H7" />
    </svg>
  );
}

export function Feedback({ messageId, initial }: { messageId: string; initial: "up" | "down" | null }) {
  const [rating, setRating] = useState(initial);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function send(r: "up" | "down", extra?: { reason: string | null; comment: string }) {
    setStatus("saving");
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, rating: r, ...extra }),
    });
    setStatus(res.ok ? "saved" : "error");
    if (res.ok) {
      setRating(r);
      setOpen(false);
    }
  }

  const iconBtn = (on: boolean) =>
    "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors " +
    (on ? "bg-surface-2 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink");

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1 text-xs text-ink-3">
        <span className="mr-1">Was this helpful?</span>
        <button type="button" className={iconBtn(rating === "up")} aria-pressed={rating === "up"} aria-label="Helpful" onClick={() => send("up")}>
          <Thumb filled={rating === "up"} />
        </button>
        <button
          type="button"
          className={iconBtn(rating === "down" || open)}
          aria-pressed={rating === "down"}
          aria-label="Not helpful"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Thumb down filled={rating === "down"} />
        </button>
        {status === "saved" && !open && (
          <span className="ml-1" role="status">
            {rating === "down" ? "Thanks. The documentation team will review this." : "Thanks for the feedback."}
          </span>
        )}
        {status === "error" && <span className="ml-1 text-critical">Couldn&apos;t save feedback.</span>}
      </div>

      {open && (
        <form
          className="mt-2 space-y-3 rounded-lg border border-line bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send("down", { reason, comment });
          }}
        >
          <fieldset>
            <legend className="mb-2 text-sm font-medium">What was the problem?</legend>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className={
                    "cursor-pointer rounded-full border px-3 py-1 text-xs " +
                    (reason === r.value ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-2 hover:border-ink-3")
                  }
                >
                  <input type="radio" name="reason" value={r.value} className="sr-only" checked={reason === r.value} onChange={() => setReason(r.value)} />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What should the answer have said? (optional)"
            rows={2}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" type="submit" disabled={status === "saving"}>
              Send feedback
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
