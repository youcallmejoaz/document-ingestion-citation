import { z } from "zod";
import { errorResponse, requireApiUser } from "@/lib/auth";

const Body = z.object({
  messageId: z.string().uuid(),
  rating: z.enum(["up", "down"]),
  reason: z.enum(["wrong", "missing", "outdated", "unclear", "other"]).nullish(),
  comment: z.string().max(2000).nullish(),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireApiUser();
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid feedback" }, { status: 400 });
    const { messageId, rating, reason, comment } = parsed.data;

    // RLS only accepts feedback on messages in the user's own conversations.
    const { error } = await supabase.from("feedback").upsert(
      {
        message_id: messageId,
        user_id: user.id,
        rating,
        reason: rating === "down" ? (reason ?? null) : null,
        comment: comment?.trim() || null,
      },
      { onConflict: "message_id,user_id" },
    );
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
