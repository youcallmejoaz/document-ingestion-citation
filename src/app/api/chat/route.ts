import { z } from "zod";
import { getAnswerProvider, type ChatTurn } from "@/lib/ai/provider";
import { errorResponse, requireApiUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { cleanCitationMarkers, resolveCitations } from "@/lib/rag/citations";
import { NOT_FOUND, NOT_FOUND_MESSAGE, SYSTEM_PROMPT, buildMessages } from "@/lib/rag/prompt";
import { buildRetrievalQuery, normalizeQuestion, retrieve, selectContext } from "@/lib/rag/retrieve";
import type { ChatStreamEvent, Citation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  sessionId: z.string().uuid().optional(),
  question: z.string().trim().min(2).max(2000),
});

const HISTORY_TURNS = 6;

export async function POST(request: Request) {
  const started = Date.now();
  let ctx: Awaited<ReturnType<typeof requireApiUser>>;
  let body: z.infer<typeof Body>;
  try {
    ctx = await requireApiUser();
    body = Body.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) return Response.json({ error: "Invalid question" }, { status: 400 });
    return errorResponse(err);
  }
  const { supabase, user } = ctx;
  const { question } = body;

  // Session (RLS guarantees a user can only continue their own sessions).
  let sessionId = body.sessionId;
  if (sessionId) {
    const { data } = await supabase.from("chat_sessions").select("id").eq("id", sessionId).maybeSingle();
    if (!data) return Response.json({ error: "Conversation not found" }, { status: 404 });
  } else {
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: user.id, title: question.slice(0, 80) })
      .select("id")
      .single();
    if (error) return errorResponse(error);
    sessionId = data.id as string;
  }

  const { data: prior } = await supabase
    .from("messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_TURNS);
  const history: ChatTurn[] = ((prior ?? []) as ChatTurn[]).reverse();
  const previousQuestion = [...history].reverse().find((m) => m.role === "user")?.content;

  const { data: userMessage, error: userMsgError } = await supabase
    .from("messages")
    .insert({ session_id: sessionId, role: "user", content: question })
    .select("id")
    .single();
  if (userMsgError) return errorResponse(userMsgError);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      send({ type: "start", sessionId: sessionId!, userMessageId: userMessage.id });

      let answered = false;
      let content = NOT_FOUND_MESSAGE;
      let citations: Citation[] = [];
      let topSimilarity = 0;
      let chunkCount = 0;

      try {
        const chunks = await retrieve(supabase, buildRetrievalQuery(question, previousQuestion), env.matchCount);
        const selection = selectContext(chunks, env.minSimilarity);
        topSimilarity = selection.topSimilarity;
        chunkCount = selection.context.length;

        if (selection.answerable) {
          const provider = await getAnswerProvider();
          const messages = buildMessages(history, question, selection.context);
          let full = "";
          // Hold back the opening characters until we know the reply isn't the
          // NOT_FOUND sentinel, so the user never sees it flash up.
          let released = false;
          for await (const piece of provider.streamAnswer({ system: SYSTEM_PROMPT, messages })) {
            full += piece;
            if (!released) {
              const head = full.trimStart();
              if (head.length < NOT_FOUND.length + 2 && NOT_FOUND.startsWith(head.slice(0, NOT_FOUND.length))) continue;
              if (head.startsWith(NOT_FOUND)) continue;
              released = true;
              send({ type: "delta", text: full });
            } else {
              send({ type: "delta", text: piece });
            }
          }

          const trimmed = full.trim();
          if (trimmed && !trimmed.startsWith(NOT_FOUND)) {
            answered = true;
            content = cleanCitationMarkers(trimmed, selection.context.length);
            citations = resolveCitations(content, selection.context);
          }
        }
        if (!answered) send({ type: "delta", text: NOT_FOUND_MESSAGE });

        const { data: saved, error } = await supabase
          .from("messages")
          .insert({ session_id: sessionId, role: "assistant", content, citations, answered })
          .select("id")
          .single();
        if (error) throw error;

        await Promise.all([
          supabase.from("query_logs").insert({
            user_id: user.id,
            message_id: saved.id,
            question,
            normalized_question: normalizeQuestion(question),
            top_similarity: topSimilarity,
            chunk_count: chunkCount,
            answered,
            latency_ms: Date.now() - started,
          }),
          supabase.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId),
        ]);

        send({ type: "done", messageId: saved.id, content, citations, answered });
      } catch (err) {
        console.error("chat failed", err);
        const status = (err as { status?: number })?.status;
        send({
          type: "error",
          message:
            status === 429
              ? "The AI service is rate limited right now. Please try again in a minute."
              : "Something went wrong while answering. Please try again.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
