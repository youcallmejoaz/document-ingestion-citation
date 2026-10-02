// Central place for configuration so defaults live in one file.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  mockAi: process.env.MOCK_AI === "1",
  llmProvider: (process.env.LLM_PROVIDER ?? "gemini") as "gemini" | "anthropic",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-flash-latest",
  geminiEmbedModel: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",

  // The mock embedder produces much lower similarities than Gemini, so it gets
  // its own default threshold. An explicit MIN_SIMILARITY always wins.
  minSimilarity: num("MIN_SIMILARITY", process.env.MOCK_AI === "1" ? 0.12 : 0.6),
  matchCount: num("MATCH_COUNT", 8),
};

export const EMBEDDING_DIMENSIONS = 768;
