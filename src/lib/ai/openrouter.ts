export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openrouter/auto";

class OpenRouterRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function readTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as { type?: string; text?: string };
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export async function createOpenRouterCompletion(input: {
  messages: OpenRouterMessage[];
  model?: string | null;
  temperature?: number;
}): Promise<{ model: string; content: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenRouterRequestError(
      503,
      "AI is not configured. Add OPENROUTER_API_KEY to the server environment (.env.local) and restart.",
    );
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "Cubes",
    },
    body: JSON.stringify({
      model: input.model ?? OPENROUTER_MODEL,
      temperature: input.temperature ?? 0.2,
      messages: input.messages,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: { message?: string };
        model?: string;
        choices?: Array<{ message?: { content?: unknown } }>;
      }
    | null;

  if (!response.ok) {
    throw new OpenRouterRequestError(
      response.status >= 400 && response.status < 600 ? response.status : 502,
      payload?.error?.message ?? "OpenRouter request failed.",
    );
  }

  const content = readTextContent(payload?.choices?.[0]?.message?.content);
  if (!content.trim()) {
    throw new OpenRouterRequestError(502, "The AI returned no usable output.");
  }

  return {
    model: payload?.model ?? input.model ?? OPENROUTER_MODEL,
    content,
  };
}

export function mapOpenRouterError(err: unknown): { status: number; message: string } {
  if (err instanceof OpenRouterRequestError) {
    return { status: err.status, message: err.message };
  }
  if (err instanceof TypeError) {
    return {
      status: 503,
      message: "Couldn't reach the AI service — check the server's network.",
    };
  }
  return {
    status: 500,
    message: err instanceof Error ? err.message : "AI request failed.",
  };
}
