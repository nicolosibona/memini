// Assistant over memory (blueprint §8, generalized). Live: Claude tool loop (strict tools, max 6 rounds).
// Mock / failure: a deterministic router that picks a tool from keywords and answers from a template.
// Either way it only uses what the tools return, and cites sources.
import type Anthropic from "@anthropic-ai/sdk";
import type { DB } from "@/lib/db";
import { today } from "@/lib/db";
import { aiPaused, anthropicClient, describeError, logCall, modelFor, noteAiFailure, openAIStyleGateway, provider, withTimeout } from "@/lib/adapters/llm";
import { comparisons, compareGroup, entityProfile, findEntityRefs, matterView, searchMemory, termValue, timeline, COMPARE_KEYS } from "./memory";
import { formatValue, parseValue, sourceLabel, factLabel, fmtDay, type FactRow } from "./facts";
import { entityLabel, listEntities } from "./entities";
import { listMatters, comparableGroups } from "./matters";
import { listTasks } from "./tasks";
import { openAlerts } from "./audit";
import { templateDraftZh } from "./reply";
import { FACT_KEYS, MATTER_KINDS, type FactKey } from "./domain";
import { shareUrl } from "./links";

export type AssistantAnswer = { text: string; source: "live" | "mock" | "fallback"; tools: string[] };
type ToolFn = (db: DB, ws: string, input: Record<string, unknown>) => unknown;

const refEntity = (db: DB, ws: string, s: unknown) =>
  typeof s === "string" && s ? (listEntities(db, ws, { includeSelf: true }).find((e) => e.id === s)?.id ?? findEntityRefs(db, ws, s)[0]) : undefined;

const TOOL_FNS: Record<string, ToolFn> = {
  list_contacts: (db, ws, i) => listEntities(db, ws, { includeSelf: true }).filter((e) => !i.kind || e.kind === i.kind).map((e) => ({
    id: e.id, label: e.label, name: e.display_name, kind: e.kind, open_alerts: openAlerts(db, { entityId: e.id }).map((a) => `${a.severity}: ${a.title}`),
  })),
  get_contact: (db, ws, i) => {
    const id = refEntity(db, ws, i.contact);
    const p = id && entityProfile(db, id);
    if (!p) return { error: `No contact matches "${i.contact}". Call list_contacts.` };
    return {
      contact: { id: p.entity.id, label: p.entity.label, name: p.entity.display_name, kind: p.entity.kind, legal_name_zh: p.entity.legal_name_zh, credit_code: p.entity.credit_code, registry_status: p.entity.registry_status },
      company_facts: p.company.map((t) => ({ key: t.key, value: termValue(t), source: sourceLabel(t.current) })),
      matters: p.matters.map((m) => ({ id: m.id, title: m.title, kind: m.kind, status: m.status, terms: m.terms.map((t) => ({ key: t.key, value: termValue(t), source: sourceLabel(t.current), quote: t.current.quote_original, conflicting: t.conflicting.map((c) => `${formatValue(c.key, parseValue(c.value_json))} (${sourceLabel(c)})`) })) })),
      open_alerts: p.alerts.map((a) => ({ severity: a.severity, title: a.title })),
      tasks: p.tasks.filter((t) => t.status === "open").map((t) => ({ what: t.what, due: t.due_at, who: t.who })),
      link: shareUrl("e", p.entity.id),
    };
  },
  list_matters: (db, ws, i) => listMatters(db, ws, { status: i.status ? [String(i.status)] : undefined }).map((m) => ({ id: m.id, title: m.title, kind: m.kind, status: m.status, open_alerts: openAlerts(db, { matterId: m.id }).length })),
  get_matter: (db, ws, i) => {
    const m = listMatters(db, ws).find((x) => x.id === i.matter || x.title.toLowerCase().includes(String(i.matter).toLowerCase()));
    const v = m && matterView(db, m.id);
    if (!v) return { error: `No matter matches "${i.matter}". Call list_matters.` };
    return {
      matter: { id: v.matter.id, title: v.matter.title, kind: v.matter.kind, status: v.matter.status, counterparty: v.entity?.display_name },
      terms: v.terms.map((t) => ({ key: t.key, value: termValue(t), source: sourceLabel(t.current), quote: t.current.quote_original })),
      checklist: v.checklist.map((c) => ({ document: c.label, required: c.required, on_file: c.done })),
      alerts: v.alerts.map((a) => ({ severity: a.severity, title: a.title })), tasks: v.tasks.map((t) => ({ what: t.what, due: t.due_at, status: t.status })),
      link: shareUrl("m", v.matter.id),
    };
  },
  get_fact_history: (db, ws, i) => {
    const id = refEntity(db, ws, i.contact);
    if (!id) return { error: "unknown contact" };
    return (db.prepare(`SELECT * FROM facts WHERE entity_id = ? AND key = ? ORDER BY stated_at`).all(id, i.key) as FactRow[]).map((f) => ({ value: formatValue(f.key, parseValue(f.value_json)), status: f.status, source: sourceLabel(f), quote: f.quote_original }));
  },
  compare_quotes: (db, ws, i) => {
    const q = String(i.product ?? "").toLowerCase();
    return comparableGroups(db, ws)
      .filter((g) => (q ? g.subject.toLowerCase().includes(q) || q.includes(g.subject.toLowerCase()) : g.matters.length > 1))
      .map((g) => ({ product: g.subject, quotes: compareGroup(db, g.matters) }));
  },
  list_deadlines: (db, ws, i) => listTasks(db, ws, { status: "open", withinDays: Number(i.within_days || 60) }).map((t) => ({ what: t.what, due: t.due_at, who: t.who, kind: t.kind, contact: t.entity_label, matter: t.matter_title })),
  search_memory: (db, ws, i) => searchMemory(db, ws, String(i.query ?? ""), { entityId: refEntity(db, ws, i.contact) ?? null }),
  get_timeline: (db, ws, i) => { const id = refEntity(db, ws, i.contact); return id ? timeline(db, { entityId: id }, 25) : { error: "unknown contact" }; },
  draft_message: (db, ws, i) => {
    const id = refEntity(db, ws, i.contact);
    if (!id) return { error: "unknown contact" };
    const p = entityProfile(db, id)!;
    return {
      facts: p.matters.flatMap((m) => m.terms.map((t) => `${t.key}=${termValue(t)} (${sourceLabel(t.current)})`)), open_alerts: p.alerts.map((a) => a.title), intent: i.intent,
      template_zh: templateDraftZh(db, p.alerts, { missingLicense: p.entity.kind === "supplier" && !p.documents.some((d) => d.doc_type === "business_license") }),
    };
  },
};

const contact = { type: "string", description: "Contact id, label (\"Seller 2\"), name, nickname, or role (\"my landlord\")" };
const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, properties, required: Object.keys(properties), additionalProperties: false });
const TOOLS: Anthropic.Tool[] = [
  { name: "list_contacts", description: "Everyone the user deals with (suppliers, landlords, government offices, agents, themselves) with open alerts. kind: empty string for all.", input_schema: obj({ kind: { type: "string" } }) },
  { name: "get_contact", description: "One contact: company facts, their matters with current terms (source + quote), open alerts, deadlines, details link.", input_schema: obj({ contact }) },
  { name: "list_matters", description: "All matters (purchases, residence permit, lease, tax…). status: open, waiting, done, or empty string for all.", input_schema: obj({ status: { type: "string" } }) },
  { name: "get_matter", description: "One matter: terms, document checklist (what's missing), alerts, deadlines, link.", input_schema: obj({ matter: { type: "string", description: "Matter id or part of its title" } }) },
  { name: "get_fact_history", description: "Every value a term ever had with a contact, oldest first, with source and quote.", input_schema: obj({ contact, key: { type: "string", enum: [...FACT_KEYS] } }) },
  { name: "compare_quotes", description: "Side-by-side terms of suppliers quoting the SAME product. product: empty string for every product with 2+ quotes. Never compare different products.", input_schema: obj({ product: { type: "string" } }) },
  { name: "list_deadlines", description: "Open deadlines, renewals, payments and promises due within N days (overdue included).", input_schema: obj({ within_days: { type: "number" } }) },
  { name: "search_memory", description: "Full-text search over messages, transcripts and documents (Chinese or English, ≥3 chars per word). contact: empty string for all.", input_schema: obj({ query: { type: "string" }, contact: { type: "string" } }) },
  { name: "get_timeline", description: "Messages, documents, term changes and alerts for a contact, newest first.", input_schema: obj({ contact }) },
  { name: "draft_message", description: "Facts and open alerts to base a Chinese message on, plus a template you may improve.", input_schema: obj({ contact, intent: { type: "string" } }) },
].map((t) => ({ ...t, strict: true }) as Anthropic.Tool);

const SYSTEM = `You are Memini, a bilingual assistant for foreigners doing business in China: sourcing from suppliers, and the paperwork of living and running a company there (permits, tax, lease, banking).
Answer ONLY from what your tools return.
- Cite the source of every number or date in brackets: type + date, e.g. "USD 4.20 (voice note, Nov 18)".
- If something isn't in memory, say "I don't have that yet" and what to forward or upload.
- Mention relevant open red flags and close deadlines unprompted, especially before payments ("verify before paying"). No legal advice.
- Only compare suppliers that quote the same product (use compare_quotes).
- If a reference is ambiguous, ask which one.
- Chinese drafts: polite, firm, natural mainland business Chinese, exact numbers and dates.
- Short and plain: this is read on a phone. No markdown tables or headings.`;

export async function ask(db: DB, workspaceId: string, question: string, opts: { channel?: "wecom" | "web" } = {}): Promise<AssistantAnswer> {
  // the tool loop uses Claude's tool use; other back-ends get the rule-based assistant
  if (provider === "mock" || provider === "qwen" || openAIStyleGateway) return { ...ruleAnswer(db, workspaceId, question), source: "mock" };
  if (aiPaused()) return { ...ruleAnswer(db, workspaceId, question), source: "fallback" }; // key rejected a moment ago
  try {
    return await withTimeout(liveAnswer(db, workspaceId, question, opts.channel ?? "web"), Number(process.env.ASSISTANT_TIMEOUT_MS ?? 60000));
  } catch (e) {
    const err = describeError(e);
    if (!noteAiFailure(err)) console.error("[assistant] live failed, using rule-based answer:", err);
    return { ...ruleAnswer(db, workspaceId, question), source: "fallback" };
  }
}

async function liveAnswer(db: DB, ws: string, question: string, channel: string): Promise<AssistantAnswer> {
  const client = await anthropicClient();
  const model = modelFor("assistant");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${question}\n\n(Today is ${today()}. Channel: ${channel}.)` }];
  const used: string[] = [];
  for (let round = 0; round < 6; round++) {
    const t0 = Date.now();
    const res = await client.messages.create({
      model, max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      output_config: { effort: (process.env.EFFORT_ASSISTANT ?? (channel === "wecom" ? "low" : "medium")) as "low" | "medium" },
      messages,
    });
    logCall({ step: "assistant", model, source: "live", ms: Date.now() - t0, usage: res.usage });
    if (res.stop_reason === "refusal") throw new Error("model refused");
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!text) throw new Error(`empty answer (stop_reason ${res.stop_reason})`);
      return { text, source: "live", tools: used };
    }
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: calls.map((c): Anthropic.ToolResultBlockParam => {
        used.push(c.name);
        try {
          const fn = TOOL_FNS[c.name];
          if (!fn) throw new Error(`unknown tool ${c.name}`);
          return { type: "tool_result", tool_use_id: c.id, content: JSON.stringify(fn(db, ws, c.input as Record<string, unknown>)) };
        } catch (e) {
          return { type: "tool_result", tool_use_id: c.id, content: String(e), is_error: true };
        }
      }),
    });
  }
  throw new Error("too many tool rounds");
}

// ── deterministic router (mock mode + fallback) ──
export function ruleAnswer(db: DB, ws: string, q: string): Omit<AssistantAnswer, "source"> {
  const t = q.toLowerCase();
  const refs = findEntityRefs(db, ws, q);
  const all = listEntities(db, ws);
  const t0 = today();

  if (/\b(write|draft|follow[- ]?up|reply|message to)\b|写|回复/.test(t)) {
    const id = refs[0] ?? all[0]?.id;
    if (!id) return { text: "Who should I write to? I don't have any contacts yet.", tools: [] };
    const p = entityProfile(db, id)!;
    const zh = templateDraftZh(db, p.alerts, { missingLicense: p.entity.kind === "supplier" && !p.documents.some((d) => d.doc_type === "business_license") });
    return { text: `Draft for ${entityLabel(p.entity)} (copy and send):\n\n${zh}${refs.length !== 1 ? `\n\n(I assumed ${p.entity.label} — tell me if you meant someone else.)` : ""}`, tools: ["draft_message"] };
  }

  if (/\bdue\b|deadline|this (week|month)|renew|expir|today|overdue|\blate\b|promis|remind/.test(t)) {
    const tasks = listTasks(db, ws, { status: "open", withinDays: /month/.test(t) ? 31 : 45 }).filter((x) => !refs.length || (x.entity_id && refs.includes(x.entity_id)));
    if (!tasks.length) return { text: "Nothing due in the coming weeks.", tools: ["list_deadlines"] };
    return { text: tasks.slice(0, 10).map((x) => `${x.due_at! < t0 ? "❗ LATE" : x.due_at === t0 ? "• Today" : `• ${fmtDay(x.due_at!)}`} — ${x.what}${x.entity_label ? ` (${x.entity_label})` : ""}`).join("\n"), tools: ["list_deadlines"] };
  }

  if (/better deal|cheap|lowest|best price|compare|\bvs\.?\b|versus|shortest|fastest|which (supplier|seller)/.test(t)) {
    const groups = comparisons(db, ws).filter((g) => g.rows.length > 1 && (!refs.length || g.rows.some((r) => r.entity_id && refs.includes(r.entity_id))));
    if (!groups.length) return { text: "I only compare suppliers quoting the same product, and I don't have two quotes for the same product yet.", tools: ["compare_quotes"] };
    const num = (v: string) => Number(v.replace(/[^\d.]/g, ""));
    const blocks = groups.map((g) => {
      const lines = g.rows.map((r) => {
        const p = r.terms.unit_price, lt = r.terms.lead_time_days, inc = r.terms.incoterm, port = r.terms.port;
        return `${r.label} (${r.name}): ${[p ? `${p.value}/unit` : "no price yet", inc ? `${inc.value}${port ? " " + port.value : ""}` : null, lt ? `${lt.value} lead time` : null].filter(Boolean).join(", ")}${p ? ` (${p.source})` : ""}.`;
      });
      const priced = g.rows.filter((r) => r.terms.unit_price).sort((a, b) => num(a.terms.unit_price!.value) - num(b.terms.unit_price!.value));
      const fastest = g.rows.filter((r) => r.terms.lead_time_days).sort((a, b) => num(a.terms.lead_time_days!.value) - num(b.terms.lead_time_days!.value))[0];
      const incos = new Set(g.rows.map((r) => r.terms.incoterm?.value).filter(Boolean));
      const verdict = priced[0] && fastest && priced[0].matter_id !== fastest.matter_id ? `${priced[0].label} is cheaper; ${fastest.label} is faster.` : priced[0] ? `${priced[0].label} has the best price on file.` : "";
      const warn = g.rows.flatMap((r) => [...(r.open_red ? [`⚠️ ${r.label} has ${r.open_red} open red flag${r.open_red > 1 ? "s" : ""} — verify before paying.`] : []), ...(!r.has_license ? [`⚠️ ${r.label} hasn't sent a business license yet.`] : [])]);
      return [`${g.subject}:`, lines.join("\n"), verdict + (incos.size > 1 ? " Careful: different Incoterms — an EXW price isn't comparable to FOB." : ""), warn.join("\n")].filter(Boolean).join("\n");
    });
    return { text: blocks.join("\n\n"), tools: ["compare_quotes"] };
  }

  if (/flag|issue|risk|problem|before i pay|safe|trust|scam|wire|\bpay\b|alert/.test(t)) {
    const ids = refs.length ? refs : all.map((e) => e.id);
    const blocks = ids.map((id) => {
      const p = entityProfile(db, id)!;
      if (!p.alerts.length) return refs.length ? `${entityLabel(p.entity)}: ✅ no open alerts.` : "";
      return `${entityLabel(p.entity)}:\n${p.alerts.map((a) => `${a.severity === "red" ? "🔴" : "🟡"} ${a.title}`).join("\n")}`;
    }).filter(Boolean);
    return { text: blocks.length ? `${blocks.join("\n\n")}\n\nVerify before paying.` : "✅ No open alerts.", tools: ["get_contact"] };
  }

  if (refs.length || /price|said|terms|what did|moq|lead time|incoterm|payment|rent|deposit|quote/.test(t)) {
    const ids = refs.length ? refs : all.map((e) => e.id);
    const want = (Object.keys(KEYWORDS) as FactKey[]).filter((k) => KEYWORDS[k]!.test(t));
    const blocks = ids.map((id) => {
      const p = entityProfile(db, id)!;
      const lines = p.matters.flatMap((m) => {
        const terms = m.terms.filter((x) => (want.length ? want.includes(x.key) : [...COMPARE_KEYS, "rent_amount", "security_deposit", "amount_due", "expiry_date"].includes(x.key)));
        return terms.length ? [`${MATTER_KINDS[m.kind].icon} ${m.title}`, ...terms.map((x) => `  ${factLabel(x.key)}: ${termValue(x)} (${sourceLabel(x.current)})${x.conflicting.length ? ` ⚠️ but ${x.conflicting.map((c) => `${formatValue(c.key, parseValue(c.value_json))} on the ${sourceLabel(c)}`).join("; ")}` : ""}`)] : [];
      });
      const red = p.alerts.filter((a) => a.severity === "red").length;
      return `${entityLabel(p.entity)}:\n${lines.length ? lines.join("\n") : "I don't have that yet — forward their quote, contract or message."}${red ? `\n⚠️ ${red} open red flag${red > 1 ? "s" : ""} — verify before paying.` : ""}`;
    });
    return { text: blocks.join("\n\n"), tools: ["get_contact"] };
  }

  const hits = searchMemory(db, ws, q, { limit: 5 });
  if (hits.length) return { text: `Here's what I found in your messages and documents:\n${hits.map((h) => `• ${h.snippet}`).join("\n")}`, tools: ["search_memory"] };
  return { text: "I don't have that yet. Forward me the message or document, or ask about someone by name (e.g. \"What did Seller 1 quote?\", \"What's due this month?\").", tools: [] };
}

const KEYWORDS: Partial<Record<FactKey, RegExp>> = {
  unit_price: /price|quote|cost|多少钱|价格/, moq: /moq|minimum/, incoterm: /incoterm|fob|exw|cif/, lead_time_days: /lead time|delivery|how long|交期/,
  payment_terms: /payment terms/, deposit_pct: /deposit %|deposit percent/, order_qty: /quantity|units|qty/, rent_amount: /\brent\b|租金/, security_deposit: /security deposit|押金/,
};
