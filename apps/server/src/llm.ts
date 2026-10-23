/**
 * Клиент chat completions для любого OpenAI-совместимого API (Groq, OpenRouter, Ollama, OpenAI).
 * Бесплатный Groq ограничивает токены в минуту: на 429 ждём, сколько просит API, и повторяем.
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface Tool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LLM {
  chat(messages: ChatMessage[], tools?: Tool[]): Promise<{ content: string | null; tool_calls?: ToolCall[] }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Сколько ждать перед повтором: заголовок retry-after или «try again in 7.5s / 112ms» в тексте ошибки. */
export function retryDelayMs(headers: Headers, body: string, attempt: number): number {
  const header = Number(headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const m = body.match(/try again in ((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/i);
  if (m) {
    let ms = 0;
    for (const [, n, unit] of m[1]!.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
      ms += Number(n) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit as "ms" | "s" | "m" | "h"];
    }
    return Math.max(ms, 200);
  }
  return 1000 * 2 ** attempt;
}

export class OpenAICompatibleLLM implements LLM {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private retrySeconds = 25,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async chat(messages: ChatMessage[], tools?: Tool[]) {
    const body = JSON.stringify({
      model: this.model,
      messages,
      temperature: 0.4,
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
    });
    const deadline = Date.now() + this.retrySeconds * 1000;
    for (let attempt = 0; ; attempt++) {
      const r = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      const text = await r.text();
      if (r.ok) return JSON.parse(text).choices[0].message;
      const delay = retryDelayMs(r.headers, text, attempt) + 300;
      if ((r.status !== 429 && r.status < 500) || Date.now() + delay > deadline) {
        throw new Error(`LLM API ${r.status}: ${text.slice(0, 300)}`);
      }
      await sleep(delay);
    }
  }
}
