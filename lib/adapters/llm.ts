// LLM adapter: the ONLY file that knows which AI provider we use.
// LLM_PROVIDER=mock (default) | qwen | anthropic | gateway. See .env.example and blueprint §19.
// Every call returns Zod-validated JSON. On failure: retry once, then fall back to the
// cached golden-path answer so the demo never dead-ends on stage.
import "server-only";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getDb, nowIso } from "@/lib/db";

export type LlmProvider = "mock" | "qwen" | "anthropic" | "gateway";
export const provider = (process.env.LLM_PROVIDER ?? "mock") as LlmProvider;
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 8000);

/** Pipeline step → model, from env (MODEL_INTENT, MODEL_EXTRACT, …), so the bake-off result is config, not code. */
export type LlmStep = "intent" | "extract" | "analyze" | "draft" | "assistant" | "asr";
const DEFAULT_MODEL: Record<LlmStep, string> = {
  intent: "claude-haiku-5-5",
  extract: "claude-opus-5-5",
  analyze: "claude-opus-5-5",
  draft: "claude-opus-5-5",
  assistant: "claude-opus-5-5",
  asr: "scribe_v2",
};
export function modelFor(step: LlmStep): string {
  if (step === "asr") return process.env.MODEL_ASR ?? DEFAULT_MODEL.asr; // speech-to-text is ElevenLabs, never ANTHROPIC_MODEL
  return process.env[`MODEL_${step.toUpperCase()}`] ?? (step === "intent" ? DEFAULT_MODEL.intent : process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL[step]);
}
type Effort = "low" | "medium" | "high";
const effortFor = (step: LlmStep): Effort =>
  (process.env[`EFFORT_${step.toUpperCase()}`] ?? process.env.ANTHROPIC_EFFORT ?? "low") as Effort;

export type CallArgs<T> = {
  step: LlmStep;
  system: string;
  text: string;
  imageDataUrls?: string[]; // data:image/jpeg;base64,...
  pdfBase64?: string; // whole PDF, sent as a document block (Claude); Qwen gets text only
  schema: z.ZodType<T>;
  fallback: () => T; // cached golden answer, also used in mock mode
  timeoutMs?: number;
};

export type CallResult<T> = { data: T; source: LlmProvider | "fallback"; ms: number; error?: string };

export async function callJSON<T>(args: CallArgs<T>): Promise<CallResult<T>> {
  const t0 = Date.now();
  if (provider === "mock") {
    await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? 300))); // feel like a real call
    logCall({ step: args.step, model: "mock", source: "mock", ms: Date.now() - t0 });
    return { data: args.fallback(), source: "mock", ms: Date.now() - t0 };
  }
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = attempt === 0 ? args.text : `${args.text}\n\nYour previous answer was invalid: ${lastErr}\nReturn only valid JSON.`;
      const data = await withTimeout(
        provider === "qwen" ? callQwen({ ...args, text }) : openAIStyleGateway ? callOpenAICompatGateway({ ...args, text }) : callAnthropic({ ...args, text }),
        args.timeoutMs ?? TIMEOUT_MS,
      );
      return { data, source: provider, ms: Date.now() - t0 };
    } catch (e) {
      lastErr = describeError(e);
      if (lastErr.startsWith("timeout")) break; // don't wait twice on stage
    }
  }
  console.error(`[llm] ${provider}/${args.step} failed, using fallback: ${lastErr}`);
  logCall({ step: args.step, model: modelFor(args.step), source: "fallback", ms: Date.now() - t0 });
  return { data: args.fallback(), source: "fallback", ms: Date.now() - t0, error: lastErr };
}

export function describeError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  // Network errors hide the real reason (DNS, refused, TLS) in .cause; walk the chain.
  let c: unknown = e instanceof Error ? e.cause : undefined;
  for (let depth = 0; c && depth < 4; depth++) {
    const ce = c as { code?: string; message?: string; cause?: unknown };
    msg += ` ← ${[ce.code, ce.message].filter(Boolean).join(" ")}`;
    c = ce.cause;
  }
  return msg;
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms))]);
}

function parseLenient<T>(raw: string, schema: z.ZodType<T>): T {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON object in response");
  const r = schema.safeParse(JSON.parse(m[0]));
  if (!r.success) throw new Error(z.prettifyError(r.error).slice(0, 800));
  return r.data;
}

// ── Cost tracking (blueprint §19.5) ──
const PRICES: Record<string, [number, number]> = {
  // $ per 1M tokens (input, output) — first-party list prices; the gateway may differ
  "claude-fable-5-2": [8, 40],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
type LogArgs = { step: LlmStep; model: string; source: string; ms: number; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null } };
export function logCall({ step, model, source, ms, usage }: LogArgs) {
  try {
    const [pin, pout] = PRICES[model] ?? [0, 0];
    const inTok = usage?.input_tokens ?? 0, outTok = usage?.output_tokens ?? 0, cacheTok = usage?.cache_read_input_tokens ?? 0;
    const cost = (inTok * pin + outTok * pout + cacheTok * pin * 0.1) / 1e6;
    getDb()
      .prepare(`INSERT INTO llm_calls (step, model, input_tokens, output_tokens, cache_read_tokens, est_cost_usd, ms, source, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(step, model, inTok, outTok, cacheTok, cost, ms, source, nowIso());
  } catch {
    /* logging must never break a call */
  }
}

/** §19.6: if the hackathon gateway only speaks the OpenAI API, set GATEWAY_API_STYLE=openai (same model names per step). */
export const openAIStyleGateway = provider === "gateway" && (process.env.GATEWAY_API_STYLE ?? "anthropic") === "openai";

async function callOpenAICompatGateway<T>({ step, system, text, imageDataUrls, pdfBase64, schema }: CallArgs<T>): Promise<T> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.GATEWAY_API_KEY, baseURL: process.env.GATEWAY_BASE_URL });
  if (pdfBase64) throw new Error("PDF input needs an Anthropic-style gateway (send page images instead)");
  const model = modelFor(step);
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
  for (const url of imageDataUrls ?? []) content.push({ type: "image_url", image_url: { url } });
  content.push({ type: "text", text });
  const t0 = Date.now();
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: `${system}\n\nReturn ONLY one JSON object matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}` },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
  });
  logCall({ step, model, source: "live", ms: Date.now() - t0, usage: { input_tokens: res.usage?.prompt_tokens, output_tokens: res.usage?.completion_tokens } });
  return parseLenient(res.choices[0]?.message?.content ?? "", schema);
}

// ── Qwen-VL via Alibaba DashScope (OpenAI-compatible endpoint; reachable in mainland China) ──
async function callQwen<T>({ system, text, imageDataUrls, schema }: CallArgs<T>): Promise<T> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
  });
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
  for (const url of imageDataUrls ?? []) content.push({ type: "image_url", image_url: { url } });
  content.push({ type: "text", text });
  const hasImages = !!imageDataUrls?.length;
  const res = await client.chat.completions.create({
    model: hasImages ? (process.env.QWEN_VL_MODEL ?? "qwen-vl-max") : (process.env.QWEN_TEXT_MODEL ?? "qwen-plus"),
    messages: [
      { role: "system", content: `${system}\n\nReturn ONLY one JSON object matching this JSON Schema:\n${jsonSchema}` },
      { role: "user", content },
    ],
    ...(hasImages ? {} : { response_format: { type: "json_object" as const } }),
  });
  return parseLenient(res.choices[0]?.message?.content ?? "", schema);
}

// ── Claude via the Anthropic SDK (direct, or through the hackathon API gateway) ──
let _client: Anthropic | null = null;
export async function anthropicClient(): Promise<Anthropic> {
  if (_client) return _client;
  const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
  _client =
    provider === "gateway"
      ? new AnthropicSdk({ apiKey: process.env.GATEWAY_API_KEY, baseURL: process.env.GATEWAY_BASE_URL })
      : new AnthropicSdk();
  return _client;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export function userContent(text: string, imageDataUrls?: string[], pdfBase64?: string): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [];
  if (pdfBase64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } });
  for (const url of imageDataUrls ?? []) {
    const m = url.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!m || !IMAGE_TYPES.includes(m[1] as ImageType)) throw new Error("unsupported image data URL");
    content.push({ type: "image", source: { type: "base64", media_type: m[1] as ImageType, data: m[2] } });
  }
  content.push({ type: "text", text });
  return content;
}

/** The hackathon gateway drops output_config.format (verified 2026-11-21: it returns prose), so through the gateway the
 *  schema goes into the system prompt and the reply is parsed and Zod-validated. GATEWAY_STRUCTURED_OUTPUTS=1 restores
 *  native structured outputs for a gateway that forwards them. */
const schemaInPrompt = provider === "gateway" && process.env.GATEWAY_STRUCTURED_OUTPUTS !== "1";

async function callAnthropic<T>(args: CallArgs<T>): Promise<T> {
  return schemaInPrompt ? callAnthropicSchemaInPrompt(args) : callAnthropicStructured(args);
}

async function callAnthropicSchemaInPrompt<T>({ step, system, text, imageDataUrls, pdfBase64, schema }: CallArgs<T>): Promise<T> {
  const client = await anthropicClient();
  const model = modelFor(step);
  const t0 = Date.now();
  const res = await client.messages.create({
    model,
    max_tokens: step === "intent" ? 1024 : 16000,
    // schema is fixed per step, so the whole system prompt stays cacheable
    system: [{
      type: "text",
      text: `${system}\n\nReply with ONLY one JSON object (no prose, no Markdown fences) that matches this JSON Schema exactly, using these field names and allowed values:\n${JSON.stringify(z.toJSONSchema(schema))}`,
      cache_control: { type: "ephemeral" },
    }],
    output_config: { effort: effortFor(step) },
    messages: [{ role: "user", content: userContent(text, imageDataUrls, pdfBase64) }],
  });
  logCall({ step, model, source: "live", ms: Date.now() - t0, usage: res.usage });
  if (res.stop_reason === "refusal") throw new Error("model refused");
  if (res.stop_reason === "max_tokens") throw new Error("output truncated (max_tokens)");
  return parseLenient(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""), schema);
}

async function callAnthropicStructured<T>({ step, system, text, imageDataUrls, pdfBase64, schema }: CallArgs<T>): Promise<T> {
  const client = await anthropicClient();
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const model = modelFor(step);
  const t0 = Date.now();
  const res = await client.messages.parse({
    model,
    max_tokens: step === "intent" ? 1024 : 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], // static prompt → cacheable
    output_config: { effort: effortFor(step), format: zodOutputFormat(schema as z.ZodType<T> & z.ZodObject) },
    messages: [{ role: "user", content: userContent(text, imageDataUrls, pdfBase64) }],
  });
  logCall({ step, model, source: "live", ms: Date.now() - t0, usage: res.usage });
  if (res.stop_reason === "refusal") throw new Error("model refused");
  if (res.stop_reason === "max_tokens") throw new Error("output truncated (max_tokens)");
  if (res.parsed_output == null) throw new Error("no parsed output");
  return res.parsed_output as T;
}
