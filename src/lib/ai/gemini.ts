import { GoogleGenAI } from "@google/genai";
import { env, EMBEDDING_DIMENSIONS } from "@/lib/env";
import type { AnswerProvider, ChatTurn, EmbedKind, Embedder } from "./provider";
import { withRetry } from "./retry";

const EMBED_BATCH = 100;

function client() {
  if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY is not set (or set MOCK_AI=1)");
  return new GoogleGenAI({ apiKey: env.geminiApiKey });
}

export class GeminiEmbedder implements Embedder {
  readonly name = `gemini:${env.geminiEmbedModel}`;
  private ai = client();

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const res = await withRetry(() =>
        this.ai.models.embedContent({
          model: env.geminiEmbedModel,
          contents: batch,
          config: {
            taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
            outputDimensionality: EMBEDDING_DIMENSIONS,
          },
        }),
      );
      const vectors = res.embeddings?.map((e) => e.values ?? []) ?? [];
      if (vectors.length !== batch.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        throw new Error(`Gemini returned ${vectors.length} embeddings for ${batch.length} inputs`);
      }
      out.push(...vectors);
    }
    return out;
  }
}

export class GeminiAnswerProvider implements AnswerProvider {
  readonly name = `gemini:${env.geminiModel}`;
  private ai = client();

  async *streamAnswer({ system, messages }: { system: string; messages: ChatTurn[] }) {
    const stream = await withRetry(() =>
      this.ai.models.generateContentStream({
        model: env.geminiModel,
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        config: {
          systemInstruction: system,
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    );
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
    }
  }
}
