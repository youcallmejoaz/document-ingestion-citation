import { env } from "@/lib/env";

export type EmbedKind = "document" | "query";

export interface Embedder {
  readonly name: string;
  /** Embeds texts in order. Implementations batch and retry internally. */
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AnswerProvider {
  readonly name: string;
  /** Streams the answer as text fragments. */
  streamAnswer(input: { system: string; messages: ChatTurn[] }): AsyncIterable<string>;
}

let embedder: Embedder | undefined;
let answerer: AnswerProvider | undefined;

export async function getEmbedder(): Promise<Embedder> {
  if (!embedder) {
    if (env.mockAi) {
      const { MockEmbedder } = await import("./mock");
      embedder = new MockEmbedder();
    } else {
      const { GeminiEmbedder } = await import("./gemini");
      embedder = new GeminiEmbedder();
    }
  }
  return embedder;
}

export async function getAnswerProvider(): Promise<AnswerProvider> {
  if (!answerer) {
    if (env.mockAi) {
      const { MockAnswerProvider } = await import("./mock");
      answerer = new MockAnswerProvider();
    } else if (env.llmProvider === "anthropic") {
      const { AnthropicAnswerProvider } = await import("./anthropic");
      answerer = new AnthropicAnswerProvider();
    } else {
      const { GeminiAnswerProvider } = await import("./gemini");
      answerer = new GeminiAnswerProvider();
    }
  }
  return answerer;
}
