import clsx from "clsx";
import type { Citation } from "@/lib/types";

export function pageLabel(c: Pick<Citation, "pageStart" | "pageEnd">) {
  if (c.pageStart == null) return null;
  return c.pageEnd && c.pageEnd !== c.pageStart ? `pp. ${c.pageStart}–${c.pageEnd}` : `p. ${c.pageStart}`;
}

export function SourceCard({ citation, active, compact }: { citation: Citation; active?: boolean; compact?: boolean }) {
  const page = pageLabel(citation);
  return (
    <div
      data-source={citation.chunkId}
      className={clsx(
        "rounded-lg border bg-surface p-3 transition-colors",
        active ? "border-accent ring-1 ring-accent" : "border-line",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-accent-soft px-1 text-xs font-semibold text-accent-ink">
          {citation.index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{citation.documentTitle}</p>
          {(citation.headingPath || page) && (
            <p className="mt-0.5 text-xs text-ink-2">
              {citation.headingPath}
              {citation.headingPath && page ? " · " : ""}
              {page}
            </p>
          )}
        </div>
      </div>
      {!compact && <blockquote className="mt-2 border-l-2 border-line pl-2.5 text-xs leading-relaxed text-ink-2">{citation.snippet}</blockquote>}
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline"
      >
        Open original{page ? ` at ${page}` : ""}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
      </a>
    </div>
  );
}
