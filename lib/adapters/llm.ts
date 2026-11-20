// LLM adapter: the ONLY file that knows which AI provider we use.
// LLM_PROVIDER=mock (default) | qwen | anthropic. See .env.example.
// Every call returns Zod-validated JSON. On failure: retry once, then fall back to the
// cached golden-path answer so the demo never dead-ends on stage.
import "server-only";
import { z } from "zod";

export type LlmProvider = "mock" | "qwen" | "anthropic";
export const provider = (process.env.LLM_PROVIDER ?? "mock") as LlmProvider;
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 8000);

export type CallArgs<T> = {
  system: string;
  text: string;
  imageDataUrl?: string; // data:image/jpeg;base64,...
  schema: z.ZodType<T>;
  fallback: () => T; // cached golden answer, also used in mock mode
};

export type CallResult<T> = { data: T; source: LlmProvider | "fallback"; ms: number; error?: string };

export async function callJSON<T>(args: CallArgs<T>): Promise<CallResult<T>> {
  const t0 = Date.now();
  if (provider === "mock") {
    await new Promise((r) => setTimeout(r, 600)); // feel like a real call
    return { data: args.fallback(), source: "mock", ms: Date.now() - t0 };
  }
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = attempt === 0 ? args.text : `${args.text}\n\nYour previous answer was invalid: ${lastErr}\nReturn only valid JSON.`;
      const data = await withTimeout(
        provider === "anthropic" ? callAnthropic({ ...args, text }) : callQwen({ ...args, text }),
        TIMEOUT_MS,
      );
      return { data, source: provider, ms: Date.now() - t0 };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      // Network errors hide the real reason (DNS, refused, TLS) in .cause; show it.
      // Walk the whole cause chain, e.g. "Connection error" → "fetch failed" → "getaddrinfo ENOTFOUND host".
      let c: unknown = e instanceof Error ? e.cause : undefined;
      for (let depth = 0; c && depth < 4; depth++) {
        const ce = c as { code?: string; message?: string; cause?: unknown };
        lastErr += ` ← ${[ce.code, ce.message].filter(Boolean).join(" ")}`;
        c = ce.cause;
      }
      if (lastErr.startsWith("timeout")) break; // don't wait twice on stage
    }
  }
  console.error(`[llm] ${provider} failed, using fallback: ${lastErr}`);
  return { data: args.fallback(), source: "fallback", ms: Date.now() - t0, error: lastErr };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms))]);
}

function parseLenient<T>(raw: string, schema: z.ZodType<T>): T {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON object in response");
  const r = schema.safeParse(JSON.parse(m[0]));
  if (!r.success) throw new Error(z.prettifyError(r.error).slice(0, 800));
  return r.data;
}

// ── Qwen-VL via Alibaba DashScope (OpenAI-compatible endpoint; reachable in mainland China) ──
async function callQwen<T>({ system, text, imageDataUrl, schema }: CallArgs<T>): Promise<T> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
  });
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
  if (imageDataUrl) content.push({ type: "image_url", image_url: { url: imageDataUrl } });
  content.push({ type: "text", text });
  const res = await client.chat.completions.create({
    model: imageDataUrl ? (process.env.QWEN_VL_MODEL ?? "qwen-vl-max") : (process.env.QWEN_TEXT_MODEL ?? "qwen-plus"),
    messages: [
      { role: "system", content: `${system}\n\nReturn ONLY one JSON object matching this JSON Schema:\n${jsonSchema}` },
      { role: "user", content },
    ],
    ...(imageDataUrl ? {} : { response_format: { type: "json_object" as const } }),
  });
  return parseLenient(res.choices[0]?.message?.content ?? "", schema);
}

// ── Claude via the Anthropic SDK (structured outputs) ──
async function callAnthropic<T>({ system, text, imageDataUrl, schema }: CallArgs<T>): Promise<T> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const client = new Anthropic();
  type Block =
    | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp"; data: string } }
    | { type: "text"; text: string };
  const content: Block[] = [];
  if (imageDataUrl) {
    const m = imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) throw new Error("unsupported image data URL");
    content.push({ type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } });
  }
  content.push({ type: "text", text });
  const res = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    max_tokens: 16000,
    system,
    output_config: { effort: (process.env.ANTHROPIC_EFFORT ?? "low") as "low", format: zodOutputFormat(schema as z.ZodType<T> & z.ZodObject) },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error("model refused");
  if (res.parsed_output == null) throw new Error("no parsed output");
  return res.parsed_output as T;
}
