"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { ChatMessage, ChatSession, ChatStreamEvent } from "@/lib/types";
import { AnswerText } from "./answer-text";
import { Feedback } from "./feedback";
import { SourceCard } from "./source-card";

export type UIMessage = Omit<ChatMessage, "session_id" | "created_at"> & {
  feedback?: "up" | "down" | null;
  pending?: boolean;
  error?: string;
};

const SUGGESTIONS = [
  "How do I process a refund over $500?",
  "How quickly do we need to reply to client emails?",
  "What should I do in my first week?",
  "Who do I call for a Sev 1 incident out of hours?",
];

export function ChatApp({
  initialSessions,
  initialSessionId,
  initialMessages,
}: {
  initialSessions: ChatSession[];
  initialSessionId: string | null;
  initialMessages: UIMessage[];
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ messageId: string; index: number | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // The sources panel follows the most recent answer unless the user picked one.
  const panelMessage = useMemo(() => {
    const answers = messages.filter((m) => m.role === "assistant" && m.citations.length > 0);
    return (selected && answers.find((m) => m.id === selected.messageId)) || answers.at(-1) || null;
  }, [messages, selected]);
  const activeIndex = selected && panelMessage && selected.messageId === panelMessage.id ? selected.index : null;

  function cite(messageId: string, index: number) {
    setSelected({ messageId, index });
    const m = messages.find((x) => x.id === messageId);
    const c = m?.citations.find((x) => x.index === index);
    if (c) {
      for (const el of document.querySelectorAll(`[data-source="${CSS.escape(c.chunkId)}"]`)) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput("");
    const tempUser = `tmp-user-${Date.now()}`;
    const tempAnswer = `tmp-answer-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: tempUser, role: "user", content: q, citations: [], answered: null },
      { id: tempAnswer, role: "assistant", content: "", citations: [], answered: null, pending: true },
    ]);
    const patch = (id: string, fn: (m: UIMessage) => UIMessage) =>
      setMessages((all) => all.map((m) => (m.id === id ? fn(m) : m)));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, sessionId: sessionId ?? undefined }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answerId = tempAnswer;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatStreamEvent;
          if (event.type === "start") {
            patch(tempUser, (m) => ({ ...m, id: event.userMessageId }));
            if (!sessionId) {
              setSessionId(event.sessionId);
              setSessions((s) => [{ id: event.sessionId, title: q.slice(0, 80), updated_at: new Date().toISOString() }, ...s]);
              window.history.replaceState(null, "", `/chat/${event.sessionId}`);
            }
          } else if (event.type === "delta") {
            patch(answerId, (m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "done") {
            patch(answerId, (m) => ({
              ...m,
              id: event.messageId,
              content: event.content,
              citations: event.citations,
              answered: event.answered,
              pending: false,
              feedback: null,
            }));
            answerId = event.messageId;
            setSelected(null);
          } else if (event.type === "error") {
            patch(answerId, (m) => ({ ...m, pending: false, error: event.message }));
          }
        }
      }
    } catch (err) {
      patch(tempAnswer, (m) => ({ ...m, pending: false, error: (err as Error).message }));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Conversation history */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="p-3">
          <Link
            href="/chat"
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line text-sm font-medium hover:bg-surface-2"
          >
            <span aria-hidden="true">+</span> New conversation
          </Link>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversations">
          {sessions.length === 0 && <p className="px-2 text-xs text-ink-3">Your conversations will appear here.</p>}
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/chat/${s.id}`}
              className={clsx(
                "block truncate rounded-md px-2 py-1.5 text-sm",
                s.id === sessionId ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2",
              )}
              aria-current={s.id === sessionId ? "page" : undefined}
            >
              {s.title}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Conversation */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.length === 0 ? (
              <div className="mt-[8vh] text-center">
                <h1 className="text-2xl font-semibold">What do you need to know?</h1>
                <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
                  Answers come only from the company documents you have access to, and every answer links to its
                  source. If the documents don&apos;t cover it, I&apos;ll say so.
                </p>
                <div className="mx-auto mt-6 grid max-w-xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm text-ink-2 hover:border-accent hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="space-y-6" aria-live="polite">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <li key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-white">
                        {m.content}
                      </div>
                    </li>
                  ) : (
                    <li key={m.id} className="text-[15px]" data-testid="answer">
                      {m.error ? (
                        <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
                          {m.error}
                        </p>
                      ) : m.pending && !m.content ? (
                        <p className="flex items-center gap-2 text-sm text-ink-3">
                          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                          Searching the documents…
                        </p>
                      ) : (
                        <>
                          {m.answered === false && (
                            <p className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-xs font-medium text-warn-ink">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M12 8v5M12 16h.01" />
                              </svg>
                              Not in the knowledge base
                            </p>
                          )}
                          <AnswerText
                            text={m.content}
                            citations={m.citations}
                            onCite={(n) => cite(m.id, n)}
                            activeIndex={panelMessage?.id === m.id ? activeIndex : null}
                          />
                          {/* Below the large breakpoint the sources sit under the answer. */}
                          {m.citations.length > 0 && (
                            <div className="mt-3 space-y-2 lg:hidden">
                              {m.citations.map((c) => (
                                <SourceCard key={c.index} citation={c} compact={!(selected?.messageId === m.id && selected.index === c.index)} />
                              ))}
                            </div>
                          )}
                          {!m.pending && !m.id.startsWith("tmp-") && <Feedback messageId={m.id} initial={m.feedback ?? null} />}
                        </>
                      )}
                    </li>
                  ),
                )}
              </ol>
            )}
          </div>
        </div>

        <form
          className="border-t border-line bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <label htmlFor="question" className="sr-only">
              Ask a question
            </label>
            <textarea
              id="question"
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              placeholder="Ask about a procedure, policy or template…"
              className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <Button variant="primary" type="submit" disabled={busy || !input.trim()}>
              {busy ? "Answering…" : "Ask"}
            </Button>
          </div>
          <p className="mx-auto mt-1.5 max-w-3xl text-xs text-ink-3">
            Answers are limited to documents your role can access. Check the source for anything critical.
          </p>
        </form>
      </main>

      {/* Sources panel */}
      <aside className="hidden w-80 shrink-0 flex-col border-l border-line bg-page lg:flex" aria-label="Sources">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Sources</h2>
          <p className="text-xs text-ink-2">
            {panelMessage ? "Passages the answer was built from." : "Cited passages will appear here."}
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {panelMessage?.citations.map((c) => (
            <SourceCard key={`${panelMessage.id}-${c.index}`} citation={c} active={activeIndex === c.index} />
          ))}
        </div>
      </aside>
    </div>
  );
}
