import Link from "next/link";
import { BarList, CsvButton, DailyQuestionsChart, type DailyPoint } from "@/components/admin/charts";
import { Badge, Card } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth";

interface Analytics {
  totals: { questions: number; answered: number; unanswered: number; users: number };
  feedback: { up: number; down: number; by_reason: Record<string, number> };
  daily: DailyPoint[];
  top_questions: { question: string; example: string; count: number; answer_rate: number; last_asked: string }[];
  gaps: { question: string; example: string; count: number; best_similarity: number | null; last_asked: string }[];
  negative_feedback: { id: string; reason: string | null; comment: string | null; created_at: string; answer: string; question: string | null }[];
  top_documents: { document_id: string; title: string; citations: number }[];
}

const RANGES = [7, 30, 90];
const REASON_LABELS: Record<string, string> = {
  wrong: "Wrong",
  missing: "Missing info",
  outdated: "Outdated",
  unclear: "Unclear",
  other: "Other",
  unspecified: "No reason given",
};

function fillDays(daily: DailyPoint[], days: number): DailyPoint[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out: DailyPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, answered: 0, unanswered: 0 });
  }
  return out;
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-3">{note}</p>}
    </Card>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = RANGES.includes(Number(raw)) ? Number(raw) : 30;
  const { supabase } = await requireAdminPage();
  const { data, error } = await supabase.rpc("admin_analytics", { p_days: days });
  if (error) throw new Error(error.message);
  const a = data as Analytics;
  const answerRate = a.totals.questions ? a.totals.answered / a.totals.questions : 0;
  const rated = a.feedback.up + a.feedback.down;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Usage &amp; knowledge gaps</h1>
          <p className="text-sm text-ink-2">What staff ask, what the documents can&apos;t answer yet, and where answers fall short.</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/admin/analytics?days=${r}`}
              aria-current={r === days ? "true" : undefined}
              className={
                "rounded-md px-3 py-1.5 text-sm " + (r === days ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink")
              }
            >
              {r} days
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Questions asked" value={a.totals.questions.toLocaleString()} note={`by ${a.totals.users} people`} />
        <Tile label="Answered from documents" value={pct(answerRate)} note={`${a.totals.answered.toLocaleString()} questions`} />
        <Tile label="Not covered by documents" value={a.totals.unanswered.toLocaleString()} note="logged as knowledge gaps" />
        <Tile
          label="Rated not helpful"
          value={a.feedback.down.toLocaleString()}
          note={rated ? `${pct(a.feedback.down / rated)} of ${rated} rated answers` : "no ratings yet"}
        />
      </div>

      <Card className="p-5">
        <h2 className="mb-1 font-semibold">Questions per day</h2>
        <p className="mb-4 text-xs text-ink-2">Last {days} days</p>
        <DailyQuestionsChart data={fillDays(a.daily, days)} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Most cited documents</h2>
          <p className="mb-4 text-xs text-ink-2">Times a document was cited in an answer</p>
          <BarList items={a.top_documents.map((d) => ({ label: d.title, value: d.citations }))} empty="No citations yet." />
        </Card>
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Why answers were rated not helpful</h2>
          <p className="mb-4 text-xs text-ink-2">Thumbs-down by reason</p>
          <BarList
            items={Object.entries(a.feedback.by_reason)
              .sort((x, y) => y[1] - x[1])
              .map(([k, v]) => ({ label: REASON_LABELS[k] ?? k, value: v }))}
            empty="No negative feedback in this period."
          />
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold">Knowledge gaps</h2>
            <p className="text-xs text-ink-2">Questions the documents couldn&apos;t answer. Each one is a candidate for a new or updated SOP.</p>
          </div>
          {a.gaps.length > 0 && (
            <CsvButton
              filename={`knowledge-gaps-${days}d.csv`}
              rows={[
                ["question", "times_asked", "best_match", "last_asked"],
                ...a.gaps.map((g) => [g.example, g.count, g.best_similarity?.toFixed(2) ?? "", g.last_asked]),
              ]}
            />
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <th className="px-5 py-2 font-medium">Question</th>
                <th className="px-5 py-2 text-right font-medium">Times asked</th>
                <th className="px-5 py-2 text-right font-medium">Closest match</th>
                <th className="px-5 py-2 font-medium">Last asked</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {a.gaps.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-ink-3">
                    No unanswered questions in this period.
                  </td>
                </tr>
              )}
              {a.gaps.map((g) => (
                <tr key={g.question} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5">{g.example}</td>
                  <td className="px-5 py-2.5 text-right">{g.count}</td>
                  <td className="px-5 py-2.5 text-right text-ink-2">{g.best_similarity != null ? pct(g.best_similarity) : "–"}</td>
                  <td className="px-5 py-2.5 text-ink-2">{new Date(g.last_asked).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold">Top questions</h2>
            <p className="text-xs text-ink-2">Grouped by wording</p>
          </div>
          <ul className="divide-y divide-line">
            {a.top_questions.length === 0 && <li className="px-5 py-6 text-center text-sm text-ink-3">No questions yet.</li>}
            {a.top_questions.map((q) => (
              <li key={q.question} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 flex-1">{q.example}</span>
                {q.answer_rate < 1 && (
                  <Badge tone={q.answer_rate === 0 ? "warn" : "neutral"}>{pct(q.answer_rate)} answered</Badge>
                )}
                <span className="w-8 text-right text-ink-2 tabular-nums">{q.count}×</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold">Recent negative feedback</h2>
            <p className="text-xs text-ink-2">Review the answer, then fix or update the source document</p>
          </div>
          <ul className="divide-y divide-line">
            {a.negative_feedback.length === 0 && <li className="px-5 py-6 text-center text-sm text-ink-3">Nothing flagged.</li>}
            {a.negative_feedback.map((f) => (
              <li key={f.id} className="space-y-1.5 px-5 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone="critical">{REASON_LABELS[f.reason ?? "unspecified"]}</Badge>
                  <span className="text-xs text-ink-3">{new Date(f.created_at).toLocaleDateString()}</span>
                </div>
                {f.question && <p className="font-medium">{f.question}</p>}
                <p className="line-clamp-2 text-xs text-ink-2">{f.answer}</p>
                {f.comment && <p className="text-xs text-ink">“{f.comment}”</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
