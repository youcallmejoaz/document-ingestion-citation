import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ChatApp, type UIMessage } from "@/components/chat/chat-app";
import { requireUser } from "@/lib/auth";
import type { ChatMessage, ChatSession } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ id?: string[] }> }) {
  const { id } = await params;
  const sessionId = id?.[0];
  const { supabase, profile } = await requireUser();

  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("id, title, updated_at")
    .eq("user_id", profile.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  let messages: UIMessage[] = [];
  if (sessionId) {
    if (!(sessions ?? []).some((s) => s.id === sessionId)) redirect("/chat");
    const { data } = await supabase
      .from("messages")
      .select("id, session_id, role, content, citations, answered, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as ChatMessage[];
    const { data: fb } = await supabase
      .from("feedback")
      .select("message_id, rating")
      .in(
        "message_id",
        rows.map((m) => m.id),
      );
    const ratings = new Map((fb ?? []).map((f) => [f.message_id as string, f.rating as "up" | "down"]));
    messages = rows.map((m) => ({ ...m, feedback: ratings.get(m.id) ?? null }));
  }

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader profile={profile} active="chat" />
      <ChatApp
        key={sessionId ?? "new"}
        initialSessions={(sessions ?? []) as ChatSession[]}
        initialSessionId={sessionId ?? null}
        initialMessages={messages}
      />
    </div>
  );
}
