import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import type { AnswerProvider, ChatTurn } from "./provider";

/**
 * Optional answer provider (LLM_PROVIDER=anthropic). Embeddings still come
 * from Gemini, so switching providers needs no re-indexing.
 */
export class AnthropicAnswerProvider implements AnswerProvider {
  readonly name = `anthropic:${env.anthropicModel}`;
  private client = new Anthropic();

  async *streamAnswer({ system, messages }: { system: string; messages: ChatTurn[] }) {
    const stream = this.client.beta.messages.stream({
      model: env.anthropicModel,
      max_tokens: 16000,
      system,
      messages,
      // Grounded Q&A over a handful of passages doesn't need deep reasoning.
      output_config: { effort: "low" },
      // If a safety classifier declines, the API re-runs the request on a
      // fallback model inside the same call instead of returning nothing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      yield "\n\nI can't help with that request.";
    }
  }
}
