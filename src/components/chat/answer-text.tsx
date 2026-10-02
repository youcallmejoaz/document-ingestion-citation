import { Fragment, type ReactNode } from "react";
import type { Citation } from "@/lib/types";

/**
 * Renders the small Markdown subset answers use (paragraphs, numbered and
 * bulleted lists, bold) and turns [n] markers into citation chips. Builds
 * React nodes rather than HTML, so model output can't inject markup.
 */
export function AnswerText({
  text,
  citations,
  onCite,
  activeIndex,
}: {
  text: string;
  citations: Citation[];
  onCite?: (index: number) => void;
  activeIndex?: number | null;
}) {
  const known = new Set(citations.map((c) => c.index));

  const inline = (line: string, key: string): ReactNode[] =>
    line.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
      const cite = /^\[(\d+)\]$/.exec(part);
      if (cite) {
        const n = Number(cite[1]);
        const title = citations.find((c) => c.index === n)?.documentTitle;
        return (
          <button
            key={`${key}-${i}`}
            type="button"
            onClick={() => onCite?.(n)}
            disabled={!known.has(n)}
            title={title ? `Source ${n}: ${title}` : `Source ${n}`}
            aria-label={title ? `Source ${n}: ${title}` : `Source ${n}`}
            className={
              "mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded px-1 align-middle text-[11px] font-semibold tabular-nums transition-colors " +
              (activeIndex === n
                ? "bg-accent text-white"
                : known.has(n)
                  ? "bg-accent-soft text-accent-ink hover:bg-accent hover:text-white"
                  : "bg-surface-2 text-ink-3")
            }
          >
            {n}
          </button>
        );
      }
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
      return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
    });

  type Block = { kind: "p"; lines: string[] } | { kind: "ol" | "ul"; items: string[] };
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (!line) {
      blocks.push({ kind: "p", lines: [] });
    } else if (ol) {
      if (last?.kind === "ol") last.items.push(ol[1]);
      else blocks.push({ kind: "ol", items: [ol[1]] });
    } else if (ul) {
      if (last?.kind === "ul") last.items.push(ul[1]);
      else blocks.push({ kind: "ul", items: [ul[1]] });
    } else if (last?.kind === "p") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }

  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((b, i) => {
        if (b.kind === "p") return b.lines.length ? <p key={i}>{inline(b.lines.join(" "), `p${i}`)}</p> : null;
        const items = b.items.map((it, j) => (
          <li key={j} className="pl-1">
            {inline(it, `l${i}-${j}`)}
          </li>
        ));
        return b.kind === "ol" ? (
          <ol key={i} className="list-decimal space-y-1.5 pl-5 marker:text-ink-3">
            {items}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-ink-3">
            {items}
          </ul>
        );
      })}
    </div>
  );
}
