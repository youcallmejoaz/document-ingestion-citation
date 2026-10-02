import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedder } from "@/lib/ai/provider";
import type { MatchedChunk } from "@/lib/types";

/** Lower-cased, punctuation-free form used to group repeated questions in analytics. */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FOLLOW_UP = /^(and|but|what about|how about|also|then|so|it|that|this|they|those|these|what if|why|when|where|who)\b/i;

/**
 * Short follow-ups ("what about over $500?") don't retrieve well on their own,
 * so they are searched together with the previous question. This avoids an
 * extra LLM call to rewrite the question, which matters on a free-tier quota.
 */
export function buildRetrievalQuery(question: string, previousQuestion?: string): string {
  if (!previousQuestion) return question;
  const words = question.trim().split(/\s+/).length;
  return words <= 6 || FOLLOW_UP.test(question.trim()) ? `${previousQuestion}\n${question}` : question;
}

export interface ContextSelection {
  answerable: boolean;
  topSimilarity: number;
  context: MatchedChunk[];
}

/**
 * Decides whether retrieval found anything worth answering from. If even the
 * best chunk is below the threshold the model is never called, so it can't be
 * tempted to answer from general knowledge. Weak chunks that rode in on the
 * keyword side of the hybrid search are dropped from the context.
 */
export function selectContext(
  chunks: MatchedChunk[],
  minSimilarity: number,
  { floorDelta = 0.15, max = 8 } = {},
): ContextSelection {
  const topSimilarity = chunks.reduce((m, c) => Math.max(m, c.similarity), 0);
  if (chunks.length === 0 || topSimilarity < minSimilarity) {
    return { answerable: false, topSimilarity, context: [] };
  }
  const floor = minSimilarity - floorDelta;
  return {
    answerable: true,
    topSimilarity,
    context: chunks.filter((c) => c.similarity >= floor).slice(0, max),
  };
}

/**
 * Runs hybrid search with the caller's Supabase client. Because match_chunks
 * is SECURITY INVOKER, row-level security limits results to documents the
 * signed-in user is allowed to see.
 */
export async function retrieve(
  supabase: SupabaseClient,
  query: string,
  matchCount: number,
): Promise<MatchedChunk[]> {
  const embedder = await getEmbedder();
  const [embedding] = await embedder.embed([query], "query");
  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: JSON.stringify(embedding),
    query_text: query,
    match_count: matchCount,
  });
  if (error) throw new Error(`Retrieval failed: ${error.message}`);
  return (data ?? []) as MatchedChunk[];
}
