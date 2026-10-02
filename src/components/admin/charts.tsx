"use client";

import { useEffect, useRef, useState } from "react";
import { niceMax } from "@/lib/chart-scale";

export interface DailyPoint {
  day: string; // YYYY-MM-DD
  answered: number;
  unanswered: number;
}

function shortDate(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Column path with a 4px rounded top and a square base. */
function columnPath(x: number, y: number, w: number, h: number, round: boolean) {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Daily questions, stacked answered / not answered. Two series, so there is a
 * legend; every column has a hover tooltip and the data is also in a table.
 */
export function DailyQuestionsChart({ data }: { data: DailyPoint[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 220;
  const pad = { top: 8, right: 8, bottom: 24, left: 32 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.answered + d.unanswered)));
  const band = data.length ? innerW / data.length : innerW;
  const barW = Math.max(2, Math.min(24, band * 0.7));
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64))));
  const GAP = 2;

  const h = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-ink-2" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-series-1" /> Answered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-series-2" /> Not in the documents
        </span>
      </div>
      <div ref={wrap} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label="Questions per day, answered versus not answered">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-3)" className="tabular-nums">
                {t.toLocaleString()}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            const x = cx - barW / 2;
            const aH = (d.answered / max) * innerH;
            const uH = (d.unanswered / max) * innerH;
            const base = pad.top + innerH;
            const hasTop = d.unanswered > 0;
            return (
              <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.45}>
                {d.answered > 0 && (
                  <path d={columnPath(x, base - aH, barW, aH, !hasTop)} fill="var(--series-1)" />
                )}
                {hasTop && (
                  <path
                    d={columnPath(x, base - aH - uH - (d.answered > 0 ? GAP : 0), barW, uH, true)}
                    fill="var(--series-2)"
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
                    {shortDate(d.day)}
                  </text>
                )}
                {/* Hit target: the whole band, not just the bar. */}
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={0}
                  aria-label={`${shortDate(d.day)}: ${d.answered} answered, ${d.unanswered} not answered`}
                />
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border border-line bg-surface p-2.5 text-xs shadow-lg"
            style={{
              left: Math.min(Math.max(0, pad.left + band * hover + band / 2 - 88), Math.max(0, width - 176)),
            }}
          >
            <p className="mb-1.5 font-medium text-ink">{shortDate(h.day)}</p>
            <p className="flex items-center justify-between gap-2 text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-series-1" /> Answered
              </span>
              <span className="tabular-nums text-ink">{h.answered}</span>
            </p>
            <p className="flex items-center justify-between gap-2 text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-series-2" /> Not answered
              </span>
              <span className="tabular-nums text-ink">{h.unanswered}</span>
            </p>
          </div>
        )}
      </div>
      <details className="mt-2 text-xs text-ink-2">
        <summary className="cursor-pointer select-none">Show as table</summary>
        <table className="mt-2 w-full max-w-sm">
          <thead>
            <tr className="text-left">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Answered</th>
              <th className="py-1 text-right font-medium">Not answered</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="py-1">{shortDate(d.day)}</td>
                <td className="py-1 text-right">{d.answered}</td>
                <td className="py-1 text-right">{d.unanswered}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** Single-series horizontal bars with the value at the tip. */
export function BarList({ items, empty }: { items: { label: string; value: number; hint?: string }[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="text-sm text-ink-3">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} title={item.hint}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">{item.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2.5 flex-1">
              <div
                className="h-full rounded-r-[4px] bg-series-1"
                style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-xs text-ink-2 tabular-nums">{item.value}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CsvButton({ rows, filename }: { rows: (string | number | null)[][]; filename: string }) {
  return (
    <button
      type="button"
      className="text-xs font-medium text-accent-ink hover:underline"
      onClick={() => {
        const csv = rows
          .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
          .join("\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      Export CSV
    </button>
  );
}
