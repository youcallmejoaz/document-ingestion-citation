/**
 * Seeds demo users and the sample documents (through the real ingestion
 * pipeline). Safe to re-run: existing users and documents are skipped.
 *
 *   pnpm seed                    users + documents
 *   pnpm seed --reset            delete all documents first
 *   pnpm seed --demo-activity    also add 30 days of synthetic usage, clearly
 *                                fake, so the analytics page has something to show
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const DEMO_PASSWORD = "demo-password";
const USERS = [
  { email: "staff@demo.local", name: "Sam Staff", roles: ["staff"] },
  { email: "manager@demo.local", name: "Morgan Manager", roles: ["staff", "manager"] },
  { email: "hr@demo.local", name: "Harper HR", roles: ["staff", "hr"] },
  { email: "admin@demo.local", name: "Alex Admin", roles: ["staff", "admin"] },
];

async function main() {
  const args = new Set(process.argv.slice(2));
  // Imported after the env file is loaded, since env.ts reads process.env at import time.
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { createDocument } = await import("../src/lib/documents");
  const { mimeTypeFor } = await import("../src/lib/ingest/parse");
  const { sha256 } = await import("../src/lib/ingest/pipeline");
  const { env } = await import("../src/lib/env");
  const admin = createAdminClient();

  console.log(`AI: ${env.mockAi ? "mock (MOCK_AI=1)" : `Gemini ${env.geminiEmbedModel}`}`);

  // Users
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const existing = list.users.find((x) => x.email === u.email);
    if (existing) {
      ids[u.email] = existing.id;
      continue;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      app_metadata: { roles: u.roles },
      user_metadata: { full_name: u.name },
    });
    if (error) throw error;
    ids[u.email] = data.user.id;
    console.log(`created ${u.email} (${u.roles.join(", ")})`);
  }

  if (args.has("--reset")) {
    const { data: docs } = await admin.from("documents").select("id");
    for (const d of docs ?? []) {
      const { data: folders } = await admin.storage.from("documents").list(d.id);
      for (const f of folders ?? []) {
        const { data: files } = await admin.storage.from("documents").list(`${d.id}/${f.name}`);
        await admin.storage.from("documents").remove((files ?? []).map((x) => `${d.id}/${f.name}/${x.name}`));
      }
    }
    await admin.from("chat_sessions").delete().not("id", "is", null);
    await admin.from("query_logs").delete().not("id", "is", null);
    await admin.from("documents").delete().not("id", "is", null);
    console.log("removed existing documents and activity");
  }

  // Documents
  const manifest = JSON.parse(readFileSync("samples/manifest.json", "utf8")) as {
    file: string;
    title: string;
    department: string;
    description: string;
    allowedRoles: string[];
  }[];
  for (const item of manifest) {
    const { data: existing } = await admin.from("documents").select("id").eq("title", item.title).maybeSingle();
    if (existing) continue;
    const data = new Uint8Array(readFileSync(path.join("samples", item.file)));
    const doc = await createDocument(admin, {
      title: item.title,
      description: item.description,
      department: item.department,
      allowedRoles: item.allowedRoles,
      filename: item.file,
      mimeType: mimeTypeFor(item.file),
      data,
      checksum: sha256(data),
      uploadedBy: ids["admin@demo.local"],
    });
    console.log(`indexed ${item.title}: ${doc.chunk_count} chunks (${doc.status})`);
  }

  if (args.has("--demo-activity")) await seedActivity(admin, ids);
  console.log(`\nDone. Demo accounts use the password "${DEMO_PASSWORD}".`);
}

// ---------------------------------------------------------------------------
// Synthetic activity for the analytics page
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof import("../src/lib/supabase/admin").createAdminClient>;

const ANSWERED: { q: string; doc: string; section: string; w: number; comment?: string }[] = [
  { q: "How do I process a refund over $500?", doc: "Refund and Returns Policy", section: "How to process a refund", w: 9, comment: "Form RF-12 was replaced by an online approval in the billing system." },
  { q: "Who approves a $300 refund?", doc: "Refund and Returns Policy", section: "Approval limits", w: 7, comment: "The team lead limit went up to $750 last quarter." },
  { q: "How fast do we need to reply to emails?", doc: "Customer Service Standards", section: "Response times", w: 8, comment: "Doesn't say what counts as business hours on public holidays." },
  { q: "How do I handle a customer complaint?", doc: "Customer Service Standards", section: "Handling complaints", w: 6 },
  { q: "Which templates do I use for client onboarding?", doc: "Client Onboarding SOP", section: "Templates", w: 5 },
  { q: "When should the kickoff call happen?", doc: "Client Onboarding SOP", section: "Before the kickoff call", w: 5 },
  { q: "What do I need to do in my first week?", doc: "New Starter Guide", section: "Your first week", w: 6 },
  { q: "How long is probation?", doc: "New Starter Guide", section: "Probation", w: 3 },
  { q: "Can damaged items be refunded after 30 days?", doc: "Refund and Returns Policy", section: "Exceptions", w: 4 },
];
const GAPS = [
  { q: "What is the expenses policy for client travel?", w: 6 },
  { q: "How do I request a new laptop?", w: 4 },
  { q: "What's the policy on working from home?", w: 5 },
  { q: "Is there a dress code for client meetings?", w: 2 },
  { q: "Where do I park on my first day?", w: 2 },
];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

async function seedActivity(admin: Admin, ids: Record<string, string>) {
  const { normalizeQuestion } = await import("../src/lib/rag/retrieve");
  const { documentLink, snippetOf } = await import("../src/lib/rag/citations");

  const { count } = await admin.from("query_logs").select("id", { count: "exact", head: true });
  if (count) {
    console.log("activity already present; skipping (use --reset to start over)");
    return;
  }

  const { data: chunks } = await admin
    .from("document_chunks")
    .select("id, document_id, heading_path, page_start, page_end, content, documents!inner(title)");
  const findChunk = (title: string, section: string) =>
    (chunks ?? []).find(
      (c) => (c.documents as unknown as { title: string }).title === title && c.heading_path.includes(section),
    );

  const rand = rng(42);
  const pick = <T extends { w: number }>(items: T[]) => {
    const total = items.reduce((s, i) => s + i.w, 0);
    let r = rand() * total;
    return items.find((i) => (r -= i.w) < 0) ?? items[0];
  };
  const people = ["staff@demo.local", "manager@demo.local", "hr@demo.local"].map((e) => ids[e]);
  const reasons = ["outdated", "missing", "unclear", "wrong"];
  let questions = 0;

  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const day = new Date();
    day.setDate(day.getDate() - daysAgo);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    // Usage grows as the team adopts the tool.
    const n = Math.round((weekend ? 1 : 4 + (29 - daysAgo) / 4) * (0.6 + rand() * 0.8));
    for (let i = 0; i < n; i++) {
      const at = new Date(day);
      at.setHours(8 + Math.floor(rand() * 9), Math.floor(rand() * 60));
      const userId = people[Math.floor(rand() * people.length)];
      const gap = rand() < 0.22;
      const item = gap ? pick(GAPS) : pick(ANSWERED);
      const chunk = gap ? null : findChunk((item as (typeof ANSWERED)[number]).doc, (item as (typeof ANSWERED)[number]).section);
      const answered = !gap && !!chunk;
      const citations = chunk
        ? [
            {
              index: 1,
              chunkId: chunk.id,
              documentId: chunk.document_id,
              documentTitle: (chunk.documents as unknown as { title: string }).title,
              headingPath: chunk.heading_path,
              pageStart: chunk.page_start,
              pageEnd: chunk.page_end,
              snippet: snippetOf(chunk.content),
              url: documentLink(chunk.document_id, chunk.page_start),
            },
          ]
        : [];

      const { data: session } = await admin
        .from("chat_sessions")
        .insert({ user_id: userId, title: item.q, created_at: at.toISOString(), updated_at: at.toISOString() })
        .select("id")
        .single();
      const later = new Date(at.getTime() + 4000).toISOString();
      const { data: msgs, error: msgError } = await admin
        .from("messages")
        .insert([
          { session_id: session!.id, role: "user", content: item.q, citations: [], answered: null, created_at: at.toISOString() },
          {
            session_id: session!.id,
            role: "assistant",
            content: answered ? `${snippetOf(chunk!.content, 220)} [1]` : "I couldn't find this in the documents you have access to.",
            citations,
            answered,
            created_at: later,
          },
        ])
        .select("id, role");
      if (msgError) throw msgError;
      const answerId = msgs!.find((m) => m.role === "assistant")!.id;

      await admin.from("query_logs").insert({
        user_id: userId,
        message_id: answerId,
        question: item.q,
        normalized_question: normalizeQuestion(item.q),
        top_similarity: answered ? 0.7 + rand() * 0.2 : 0.3 + rand() * 0.2,
        chunk_count: answered ? 1 + Math.floor(rand() * 4) : 0,
        answered,
        latency_ms: 900 + Math.floor(rand() * 2500),
        created_at: at.toISOString(),
      });

      const r = rand();
      if (answered && r < 0.3) {
        const down = r < 0.06;
        await admin.from("feedback").insert({
          message_id: answerId,
          user_id: userId,
          rating: down ? "down" : "up",
          reason: down ? reasons[Math.floor(rand() * reasons.length)] : null,
          comment: down ? ((item as (typeof ANSWERED)[number]).comment ?? null) : null,
          created_at: later,
        });
      }
      questions++;
    }
  }
  console.log(`added ${questions} synthetic questions over 30 days`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
