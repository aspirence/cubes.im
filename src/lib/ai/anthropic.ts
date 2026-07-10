import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-side Anthropic client for the AI feature routes (/api/ai/*).
 *
 * The zero-arg constructor resolves credentials from the environment
 * (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile),
 * so a missing key surfaces as an AuthenticationError at request time and is
 * mapped to a friendly 503 by `mapAiError` — the app builds and runs without
 * AI configured.
 */

export const AI_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/** Maps SDK errors to a route-handler-friendly status + user-facing message. */
export function mapAiError(err: unknown): { status: number; message: string } {
  // Missing key throws a plain AnthropicError at client construction (not an
  // AuthenticationError) — map it to the same friendly 503.
  if (
    err instanceof Error &&
    !(err instanceof Anthropic.APIError) &&
    err.message.includes("ANTHROPIC_API_KEY")
  ) {
    return {
      status: 503,
      message:
        "AI is not configured. Add ANTHROPIC_API_KEY to the server environment (.env.local) and restart.",
    };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return {
      status: 503,
      message:
        "AI is not configured. Add ANTHROPIC_API_KEY to the server environment (.env.local) and restart.",
    };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return {
      status: 429,
      message: "The AI service is rate-limited right now — try again shortly.",
    };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      status: 503,
      message: "Couldn't reach the AI service — check the server's network.",
    };
  }
  if (err instanceof Anthropic.APIError) {
    return {
      status: 502,
      message: `AI request failed (${err.status ?? "unknown"}): ${err.message}`,
    };
  }
  return {
    status: 500,
    message: err instanceof Error ? err.message : "AI request failed.",
  };
}

/**
 * Extracts the JSON payload from a structured-output response. With
 * `output_config.format` the text block is guaranteed to be valid JSON that
 * matches the schema — unless the model refused or ran out of tokens, which
 * we surface as errors.
 */
export function extractJson<T>(message: Anthropic.Message): T {
  if (message.stop_reason === "refusal") {
    throw new Error("The AI declined this request.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The AI response was cut off — try a shorter request.");
  }
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("The AI returned no usable output.");
  }
  return JSON.parse(text.text) as T;
}
