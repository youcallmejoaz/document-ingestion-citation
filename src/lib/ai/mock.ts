import { EMBEDDING_DIMENSIONS } from "@/lib/env";
import { NOT_FOUND } from "@/lib/rag/prompt";
import type { AnswerProvider, ChatTurn, EmbedKind, Embedder } from "./provider";

/*
 * Offline stand-ins used when MOCK_AI=1: tests, CI and demos without API keys.
 * The embedder is a hashed bag of words, so lexically similar text really does
 * land close together and retrieval behaves sensibly on the sample documents.
 */

const STOP = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its me my of on or our should so that the their them then there these they this to was we what when where which who why will with you your".split(
    " ",
  ),
);

function stem(word: string): string {
  return word.replace(/(ing|ed|es|s)$/, "") || word;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map(stem);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const add = (feature: string, weight: number) => {
    const h = fnv1a(feature);
    v[h % EMBEDDING_DIMENSIONS] += h & 0x80000000 ? -weight : weight;
  };
  const tokens = tokenize(text);
  tokens.forEach((t, i) => {
    add(t, 1);
    if (i > 0) add(`${tokens[i - 1]} ${t}`, 0.5);
  });
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export class MockEmbedder implements Embedder {
  readonly name = "mock:hash-bow";
  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    void kind;
    return texts.map(hashEmbed);
  }
}

/** Builds an extractive answer from the top sources, citing them. */
export function mockAnswer(prompt: string): string {
  const sources = [...prompt.matchAll(/<source id="(\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map((m) => ({
    id: Number(m[1]),
    text: m[2],
  }));
  if (sources.length === 0) return NOT_FOUND;

  const parts = sources.slice(0, 2).map(({ id, text }) => {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const steps = lines.filter((l) => /^(\d+[.)]|[-*•])\s/.test(l));
    if (steps.length >= 2) {
      return steps
        .slice(0, 6)
        .map((s, i) => `${i + 1}. ${s.replace(/^(\d+[.)]|[-*•])\s+/, "")} [${id}]`)
        .join("\n");
    }
    const sentences = lines.join(" ").match(/[^.!?]+[.!?]+/g) ?? [lines.join(" ")];
    return `${sentences.slice(0, 2).join(" ").trim()} [${id}]`;
  });
  return `Here's what the documents say:\n\n${parts.join("\n\n")}`;
}

export class MockAnswerProvider implements AnswerProvider {
  readonly name = "mock:extractive";

  async *streamAnswer({ messages }: { system: string; messages: ChatTurn[] }) {
    const answer = mockAnswer(messages[messages.length - 1]?.content ?? "");
    for (const piece of answer.match(/\S+\s*/g) ?? []) {
      await new Promise((r) => setTimeout(r, 12));
      yield piece;
    }
  }
}
