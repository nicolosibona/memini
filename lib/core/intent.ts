// Forwarded supplier content, or a question for the assistant? (blueprint §6.5)
import { callJSON, provider } from "@/lib/adapters/llm";
import { IntentSchema } from "./schemas";
import { isChinese } from "./normalize";

export type Intent = "content" | "question" | "command";
export type IntentResult = { intent: Intent; confidence: number; via: "rule" | "llm" };

const SUPPLIER_TONE = /报价|交期|亲|老板|您好|样品|起订|定金|美金|美元|工厂|出货|发货|货期|包装|模具|单价|价格|FOB|EXW|CIF/i;
const ASK_BOT_ZH = /^(帮我|请帮|你能|能不能帮)|吗[？?]?$|[？?]$/;
const QUESTION_EN = /\?\s*$|^(how|what|which|who|when|where|why|is|are|any|did|does|do|can|could|should|would|write|draft|compare|show|list|tell|give|summari[sz]e|translate|remind)\b/i;
const SUPPLIER_EN = /\b(dear (sir|friend|customer)|our (factory|company|price)|we can (offer|do|make)|best price|moq is|lead time is|pls|kindly)\b/i;

export function commandOf(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (t.startsWith("/")) return t.split(/\s+/)[0];
  if (["agreed", "agree", "同意", "确认", "ok agreed"].includes(t)) return "agreed";
  return null;
}

/** Rule-based first (fast, free); only low-confidence text goes to the small model (MODEL_INTENT). */
export async function classifyIntent(text: string, kinds: string[]): Promise<IntentResult> {
  if (kinds.some((k) => k !== "text" && k !== "voice")) return { intent: "content", confidence: 1, via: "rule" };
  if (commandOf(text)) return { intent: "command", confidence: 1, via: "rule" };
  const rule = ruleIntent(text);
  if (rule.confidence >= 0.75 || provider === "mock") return rule;
  const r = await callJSON({
    step: "intent",
    system:
      "A foreign buyer uses a sourcing assistant on WeChat. They either FORWARD content written by a Chinese supplier (content), ask the assistant a question / give it a request (question), or type a command starting with / (command). Classify the message.",
    text,
    schema: IntentSchema,
    fallback: () => ({ intent: rule.intent, confidence: rule.confidence }),
    timeoutMs: 4000,
  });
  return { ...r.data, via: r.source === "fallback" ? "rule" : "llm" };
}

export function ruleIntent(text: string): IntentResult {
  const t = text.trim();
  if (isChinese(t)) {
    if (ASK_BOT_ZH.test(t) && !SUPPLIER_TONE.test(t)) return { intent: "question", confidence: 0.6, via: "rule" };
    return { intent: "content", confidence: SUPPLIER_TONE.test(t) ? 0.95 : 0.8, via: "rule" };
  }
  if (SUPPLIER_EN.test(t)) return { intent: "content", confidence: 0.8, via: "rule" };
  if (QUESTION_EN.test(t)) return { intent: "question", confidence: 0.9, via: "rule" };
  return { intent: "question", confidence: 0.5, via: "rule" };
}
