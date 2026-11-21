// Reply composition (blueprint §6.6, §7.2, generalized): summary + alerts + consistent terms + next steps
// + a Chinese draft when replying makes sense (not for a government notice). The draft comes from the LLM
// (MODEL_DRAFT) with a deterministic template fallback built from the alerts.
import type { DB } from "@/lib/db";
import { callJSON } from "@/lib/adapters/llm";
import { DraftSchema, type TextExtraction } from "./schemas";
import { FACT_DEFS, type EntityKind, type FactKey } from "./domain";
import { formatValue, isConversationSource, isDocumentSource, parseValue, sameValue, sourceLabel, factLabel, type FactRow } from "./facts";
import type { AlertRow } from "./audit";
import { shareUrl } from "./links";

export type Button = { id: string; label: string };
export type OutgoingReply = { kind: "text" | "menu"; text: string; buttons?: Button[] };

const SEV: Record<string, string> = { red: "🔴", amber: "🟡", info: "ℹ️" };

export function formatAlerts(alerts: AlertRow[]): string {
  if (!alerts.length) return "";
  const reds = alerts.filter((a) => a.severity === "red").length;
  const head = reds ? `🔴 ${reds} RED FLAG${reds > 1 ? "S" : ""}` : `🟡 ${alerts.length} TO CHECK`;
  const lines = alerts.map((a, i) => `${i + 1}. ${SEV[a.severity]} ${a.title}${a.severity === "red" && a.detail.includes("→") ? `\n   ${a.detail.slice(a.detail.indexOf("→"))}` : ""}`);
  if (reds && alerts.some((a) => /PAYEE|BENEFICIARY|PERSONAL|PRICE|AMOUNT/.test(a.code)) && !lines.some((l) => l.includes("→"))) lines.push("   → Verify before paying.");
  return `${head}\n${lines.join("\n")}`;
}

/** Keys where a document matches what was said: "✅ Consistent: unit price USD 4.20 · lead time 15 days". */
export function consistentTerms(facts: FactRow[]): string {
  const keys = (Object.keys(FACT_DEFS) as FactKey[]).filter((k) => "compare" in FACT_DEFS[k]).concat(["order_qty"]);
  const ok: string[] = [];
  for (const k of keys) {
    const d = facts.filter((f) => f.key === k && isDocumentSource(f.source_type)).at(-1);
    const c = facts.filter((f) => f.key === k && isConversationSource(f.source_type)).at(-1);
    if (d && c && sameValue(k, parseValue(d.value_json), parseValue(c.value_json))) ok.push(`${factLabel(k).replace(/ \(.*\)/, "").toLowerCase()} ${formatValue(k, parseValue(d.value_json))}`);
  }
  return ok.length ? `✅ Consistent: ${ok.join(" · ")}` : "";
}

export function formatTranslation(x: TextExtraction, o: { translation?: boolean } = {}): string {
  const parts = o.translation === false ? [] : [`🇬🇧 ${x.translation}`];
  if (x.subtext.length) parts.push(`💡 Between the lines:\n${x.subtext.map((s) => `• ${s.phrase} → ${s.meaning}`).join("\n")}`);
  return parts.join("\n\n");
}

// ── Chinese drafts ──
const zhDate = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? "" : `${d.getMonth() + 1}月${d.getDate()}日`; };
const PORT_ZH: Record<string, string> = { Shenzhen: "深圳", Ningbo: "宁波", Shanghai: "上海", Guangzhou: "广州", Xiamen: "厦门", Qingdao: "青岛" };

/** Values as a Chinese counterparty writes them: 19,500元 · 4.20美元 · 30% · 15天 */
function zhValue(f: FactRow): string {
  const v = parseValue(f.value_json);
  if ("amount" in v) {
    const n = v.amount.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: v.amount % 1 ? 2 : 0 });
    return v.currency === "CNY" ? `${n}元` : v.currency === "USD" ? `${n}美元` : `${n} ${v.currency}`;
  }
  if (f.key === "lead_time_days") return `${(v as { value: number }).value}天`;
  return formatValue(f.key, v);
}

function evidence(db: DB, a: AlertRow): FactRow[] {
  const ids = JSON.parse(a.evidence_fact_ids || "[]") as number[];
  return ids.length ? (db.prepare(`SELECT * FROM facts WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as FactRow[]) : [];
}

/** No reply to a government notice or to yourself. */
export const canReplyTo = (kind: EntityKind | null | undefined) => !!kind && !["government", "self_company", "self_person"].includes(kind);

/** Deterministic Chinese draft: one polite, specific sentence per alert. Mock mode + LLM fallback. */
export function templateDraftZh(db: DB, alerts: AlertRow[], ctx: { contactName?: string | null; missingLicense?: boolean; tasks?: TextExtraction["tasks"] }): string {
  const lines: string[] = [];
  for (const a of alerts) {
    const ev = evidence(db, a);
    const conv = ev.find((e) => isConversationSource(e.source_type));
    const doc = ev.find((e) => isDocumentSource(e.source_type));
    const v = (e?: FactRow) => (e ? zhValue(e) : "");
    const docZh = doc?.source_doc_type === "lease_contract" ? "合同" : "PI";
    switch (a.code) {
      case "INCOTERM_CHANGED": {
        const port = a.matter_id ? (db.prepare(`SELECT value_json FROM facts WHERE matter_id = ? AND key = 'port' AND source_type IN ('chat','voice') ORDER BY stated_at DESC LIMIT 1`).get(a.matter_id) as { value_json: string } | undefined) : undefined;
        const portZh = port ? PORT_ZH[(parseValue(port.value_json) as { value: string }).value] ?? "" : "";
        lines.push(`${docZh}上的贸易条款写的是${v(doc)}，但我们${conv ? zhDate(conv.stated_at) : "之前"}确认的是${v(conv)}${portZh}，麻烦修改一下。`);
        break;
      }
      case "PRICE_CHANGED": lines.push(`${docZh}上的单价是${v(doc)}，但我们之前谈好的是${v(conv)}，请按约定修改。`); break;
      case "AMOUNT_CHANGED": lines.push(`${docZh}上的${doc?.key === "rent_amount" ? "租金" : doc?.key === "security_deposit" ? "押金" : "金额"}是${v(doc)}，但我们之前沟通的是${v(conv)}，请确认并修改。`); break;
      case "PAYMENT_TERMS_CHANGED": lines.push(`${docZh}上的定金比例（${v(doc)}）和我们之前沟通的（${v(conv)}）不一致，请按约定修改。`); break;
      case "MOQ_CHANGED": lines.push(`起订量和之前沟通的不一样（${v(conv)} / ${v(doc)}），请确认一下。`); break;
      case "LEAD_TIME_CHANGED": lines.push(`交期比之前说的长了（${v(conv)} → ${v(doc)}），请问最快什么时候可以交货？`); break;
      case "NEW_FEE": lines.push(`${docZh}上多了一项费用（${v(doc)}），之前没有提到过，麻烦解释一下。`); break;
      case "BENEFICIARY_MISMATCH": lines.push(`${lines.length ? "另外" : ""}收款账户名称和${docZh === "合同" ? "合同上" : "营业执照上"}的公司名称不一致，请提供贵司对公账户，谢谢！`); break;
      case "PERSONAL_ACCOUNT": lines.push(`${lines.length ? "另外，" : ""}我们只能付款到公司对公账户，不能付到个人账户，请提供贵司的对公账户信息。`); break;
      case "OFFSHORE_ACCOUNT": lines.push(`收款账户在境外，请问可以提供贵司在国内的对公账户吗？`); break;
      case "SELLER_LICENSE_MISMATCH": lines.push(`PI上的卖方和营业执照上的公司不一样，请问是什么情况？`); break;
      case "CERT_HOLDER_MISMATCH": case "CERT_MODEL_MISMATCH": lines.push(`请提供以贵司名义、覆盖我们所订型号的有效证书。`); break;
      case "CREDIT_CODE_INVALID": lines.push(`营业执照上的统一社会信用代码看不太清楚，麻烦再发一张清晰的照片。`); break;
      case "COMMITMENT_LATE": lines.push(`请问之前说好的事情现在进展如何？`); break;
      default: break;
    }
  }
  if (!lines.length) {
    lines.push("好的，收到，谢谢！");
    const sample = ctx.tasks?.find((t) => t.who === "counterparty" && t.due);
    if (sample?.due) lines.push(`麻烦务必在${zhDate(sample.due)}前完成，好了请告诉我一声。`);
    if (ctx.missingLicense) lines.push("另外麻烦发一下贵司的营业执照，谢谢！");
  }
  let body = lines.join("\n");
  if (!/谢谢！$/.test(body)) body += "谢谢！";
  return `${ctx.contactName ? `${ctx.contactName}您好，` : "您好，"}${body}`;
}

export async function draftReply(
  db: DB,
  p: { counterparty: string; counterpartyKind: EntityKind | null; matterTitle: string | null; alerts: AlertRow[]; facts: FactRow[]; translations: TextExtraction[]; summaries: string[]; contactName?: string | null; missingLicense: boolean; openTasks: string[] },
): Promise<{ reply_zh: string; summary_en: string; next_steps: string[]; extra_alerts: { title: string; detail: string }[] }> {
  const replyable = canReplyTo(p.counterpartyKind);
  const fallbackZh = replyable ? templateDraftZh(db, p.alerts, { contactName: p.contactName, missingLicense: p.missingLicense, tasks: p.translations.flatMap((t) => t.tasks) }) : "";
  const fallbackSteps = [...p.openTasks.slice(0, 3)];
  const factLines = p.facts.slice(-40).map((f) => `- ${f.key} = ${formatValue(f.key, parseValue(f.value_json))} (${sourceLabel(f)}${f.quote_original ? `, "${f.quote_original}"` : ""})`).join("\n");
  const r = await callJSON({
    step: "draft",
    system: `You are a bilingual assistant for a foreign business person in China.
Given what just arrived and what is on file, write:
- summary_en: one plain sentence for the user.
- reply_zh: a WeChat reply in natural mainland business Chinese to the counterparty (您好…/麻烦…/谢谢！), polite but firm, 2–5 sentences, citing exact numbers and dates. Empty string if the counterparty is a government office or a reply makes no sense. Never agree to pay, never threaten.
- next_steps: up to 3 concrete actions for the user (e.g. "Ask for the company's corporate account before paying the deposit").
- extra_alerts: risks the rule-based checks missed (empty if none). Don't repeat the rule-based ones.`,
    text: `Counterparty: ${p.counterparty} (${p.counterpartyKind ?? "unknown"})${p.contactName ? `, contact ${p.contactName}` : ""}
Matter: ${p.matterTitle ?? "—"}
Rule-based alerts:\n${p.alerts.map((a) => `- [${a.severity}] ${a.title}`).join("\n") || "(none)"}
Open deadlines:\n${p.openTasks.join("\n") || "(none)"}
Facts on file:\n${factLines || "(none)"}
${p.missingLicense ? "No business license received yet.\n" : ""}What just arrived:\n${[...p.summaries, ...p.translations.map((t) => t.translation)].join("\n") || "(nothing)"}`,
    schema: DraftSchema,
    fallback: () => ({ reply_zh: fallbackZh, summary_en: "", next_steps: fallbackSteps, extra_alerts: [] }),
    timeoutMs: Number(process.env.LLM_TIMEOUT_DRAFT_MS ?? 30000),
  });
  return { ...r.data, reply_zh: replyable ? r.data.reply_zh : "" };
}

export const analysisButtons = (assignmentId: string): Button[] => [
  { id: `chg:${assignmentId}`, label: "Change where it's filed" },
  { id: `agr:${assignmentId}`, label: "Mark terms as agreed" },
];

export const detailsLine = (kind: "e" | "m", id: string) => `🔗 Details: ${shareUrl(kind, id)}`;
