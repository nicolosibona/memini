// The electronics spec check on WeChat and the web chat (workspace profile "electronics"):
// forward items → read each (translation + parameters) → add to the open check → compare deterministically →
// a short reply per forward; on request ("excel") the result, a simple bilingual .xlsx and a Chinese message for the supplier.
import type { DB } from "@/lib/db";
import { appUrl } from "../links";
import type { OutgoingReply } from "../reply";
import { STATUS_LABEL, type Row } from "./compare";
import { readSpecItem } from "./extract";
import { addItem, checkTitle, currentCheck, loadCheck, newCheck, setItemSide, type CheckView } from "./store";
import { writeSheet } from "./sheet";
import { EU_DISCLAIMER, euWarnings } from "./eu";
import { checkTranslation } from "./quantity";

export type SpecMsg = { id: string; kind: string; text_original: string | null; file_path: string | null; original_author: string | null };

export const SPEC_WELCOME =
  "👋 I'm Memini, your electronics spec checker.\n\nForward me your messages with the supplier, your spec and their datasheets (PDF, photo or text). I translate every technical line — numbers, units and limits verified — and check what they say against what you asked.\n\nWrite *excel* when you want the verification sheet for the supplier.\n/new starts a new check";

/** "excel", "/excel", "fammi l'excel", "send me the spreadsheet", "核对表"… → the sheet. */
export const isSheetRequest = (text: string) =>
  text.trim().length <= 80 && /^\/(sheet|excel|xlsx)\b|\b(excel|xlsx|spreadsheet|foglio)\b|表格|核对表/i.test(text.trim());

export async function handleSpecContent(db: DB, ws: string, userId: string, msgs: SpecMsg[]): Promise<OutgoingReply[]> {
  const check = currentCheck(db, userId) ?? newCheck(db, ws, userId);
  const read = await Promise.all(msgs.map(async (m) => ({ m, r: await readSpecItem({ text: m.text_original, filePath: m.file_path, author: m.original_author }) })));
  const added: string[] = [];
  for (const { m, r } of read) {
    if (!r.data.parameters.length && !r.data.segments.length) continue;
    // unclear → by language: Chinese comes from the supplier, the rest is yours
    const side = r.data.role === "unclear" ? (r.data.language === "zh" ? "supplier" : "requirement") : r.data.role;
    added.push(addItem(db, check.id, { messageId: m.id, side, kind: m.kind, author: m.original_author, filePath: m.file_path, text: m.text_original, data: r.data, source: r.source }));
  }
  if (!added.length) return [{ kind: "text", text: "I couldn't find any technical content in that. Forward a spec, a datasheet or a message with values." }];
  return itemReplies(loadCheck(db, check.id)!, added);
}

export async function specCommand(db: DB, ws: string, userId: string, cmd: string): Promise<OutgoingReply[] | null> {
  if (cmd === "/new" || cmd === "/nuovo") {
    newCheck(db, ws, userId);
    return [{ kind: "text", text: "🆕 New spec check. Forward your messages with the supplier, your spec and their datasheets." }];
  }
  if (cmd === "/sheet" || cmd === "/excel" || cmd === "/xlsx" || cmd === "/check") return sheetFor(db, userId);
  if (cmd === "/help" || cmd === "/start") return [{ kind: "text", text: SPEC_WELCOME }];
  return null;
}

export async function sheetFor(db: DB, userId: string): Promise<OutgoingReply[]> {
  const c = currentCheck(db, userId) ?? (db.prepare(`SELECT * FROM spec_checks WHERE user_id = ? AND EXISTS (SELECT 1 FROM spec_items i WHERE i.check_id = spec_checks.id) ORDER BY updated_at DESC LIMIT 1`).get(userId) as { id: string } | undefined);
  const v = c && loadCheck(db, c.id);
  if (!v?.items.length) return [{ kind: "text", text: "Nothing to check yet. Forward your messages with the supplier, your spec or their datasheet first." }];
  return sheetReplies(v);
}

/** Menu taps: spec:new, spec:sheet, spec:swap:<item id> */
export async function specMenu(db: DB, ws: string, userId: string, arg: string): Promise<OutgoingReply[]> {
  if (arg === "new") return (await specCommand(db, ws, userId, "/new"))!;
  if (arg === "sheet") return sheetFor(db, userId);
  const swap = arg.match(/^swap:(.+)$/);
  if (swap) {
    const it = db.prepare(`SELECT check_id, side FROM spec_items WHERE id = ?`).get(swap[1]) as { check_id: string; side: string } | undefined;
    if (!it) return [{ kind: "text", text: "I can't find that item any more." }];
    setItemSide(db, swap[1], it.side === "supplier" ? "requirement" : "supplier");
    return itemReplies(loadCheck(db, it.check_id)!, [swap[1]], `↔️ Moved to ${it.side === "supplier" ? "your side" : "the supplier's side"}.`);
  }
  return [{ kind: "text", text: "That button is no longer active." }];
}

const lim = (s: string, n = 46) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const SHEET_BUTTON = { id: "spec:sheet", label: "📊 Excel" };

/** Right after a forward: ONE short message — each item translated, what it changes, the running score. No file:
 *  the sheet comes when asked ("excel"), so forwarding stays fast and within WeChat's message limit. */
function itemReplies(v: CheckView, itemIds: string[], prefix?: string): OutgoingReply[] {
  const blocks: string[] = prefix ? [prefix] : [];
  let myZh: string | null = null;
  for (const it of v.items.filter((i) => itemIds.includes(i.id)).slice(0, 6)) {
    const mine = it.side === "requirement";
    const who = it.author ?? (it.file_path ? lim(it.title, 40) : mine ? "You" : "Supplier");
    const tr = it.data.segments.map((s) => s.translation).join(" ").trim();
    const allKept = it.data.segments.every((s) => checkTranslation(s.original, s.translation).ok);
    const lines = [`${mine ? "📐" : "🏭"} ${who}${it.file_path ? ` · ${it.data.parameters.length} values` : ""}`];
    if (!it.file_path && tr) lines.push(`${mine ? "🇨🇳" : "🇬🇧"} ${lim(tr, 320)}`);
    if (it.data.segments.length) lines.push(allKept ? "✓ numbers, units and limits kept" : "⚠️ some numbers to check by hand");
    const hits = v.rows.filter((r) => (r.sup?.item_id === it.id || r.req?.item_id === it.id) && r.req && r.sup && (r.status === "mismatch" || r.status === "check"));
    for (const r of hits.slice(0, 5)) lines.push(`${STATUS_LABEL[r.status].icon} ${mismatchLine(r)}`);
    for (const n of v.notes.filter((n) => n.item_title === it.title && n.risk === "high").slice(0, 2)) lines.push(`⚠️ 「${lim(n.quote, 24)}」 ${lim(n.text_en, 110)}`);
    blocks.push(lines.join("\n"));
    if (mine && !it.file_path && tr && /[一-鿿]/.test(tr)) myZh = tr;
  }
  const reqN = v.items.filter((i) => i.side === "requirement").length, supN = v.items.length - reqN;
  const c = v.counts;
  const eu = euWarnings(v.rows, v.notes);
  if (reqN && supN) blocks.push(`So far: 🔴 ${c.mismatch} · 🟡 ${c.check + c.missing} · ✅ ${c.ok}${eu.length ? ` · 🇪🇺 ${eu.length} EU warning${eu.length > 1 ? "s" : ""}` : ""}`);
  return [{
    kind: "menu", text: blocks.join("\n\n"), prompt: "Write excel (or tap 📊) for the verification sheet:",
    ...(myZh ? { copy: { label: "📋 Chinese only", text: myZh } } : {}),
    buttons: [SHEET_BUTTON, { id: "spec:new", label: "🆕 New check" }],
  }];
}

/** "excel": the result, the sheet, and the Chinese message to send with it (3 messages, no AI call: instant). */
async function sheetReplies(v: CheckView): Promise<OutgoingReply[]> {
  const sheet = await writeSheet(v);
  const reqN = v.items.filter((i) => i.side === "requirement").length, supN = v.items.length - reqN;
  const c = v.counts;
  const lines = [`📊 ${checkTitle(v.check)}${v.check.supplier_name ? ` · ${v.check.supplier_name}` : ""}`];
  if (reqN && supN) {
    if (c.mismatch) lines.push(`🔴 ${c.mismatch} MISMATCH${c.mismatch > 1 ? "ES" : ""}\n${v.rows.filter((r) => r.status === "mismatch").slice(0, 8).map((r, i) => `${i + 1}. ${mismatchLine(r)}`).join("\n")}`);
    lines.push([
      c.check ? `🟡 To confirm: ${v.rows.filter((r) => r.status === "check").map((r) => r.label_en).slice(0, 4).join(", ")}` : "",
      c.missing ? `⚠️ Not stated: ${v.rows.filter((r) => r.status === "missing").map((r) => r.label_en).slice(0, 4).join(", ")}` : "",
      `✅ ${c.ok} OK`,
    ].filter(Boolean).join("\n"));
  } else lines.push(reqN ? "Only your side so far: the sheet asks the supplier to fill in their values." : "Only the supplier's side so far: add your requirements to compare.");
  const eu = euWarnings(v.rows, v.notes);
  if (eu.length) lines.push(`🇪🇺 EU compliance — might not pass:\n${eu.map((w) => `• ${w.en}`).join("\n")}\n(${EU_DISCLAIMER.en})`);
  const zh = supplierMessageZh(v, reqN > 0 && supN > 0);
  return [
    { kind: "text", text: lines.join("\n\n") },
    { kind: "file", text: `📊 ${sheet.name}`, file: { path: sheet.path, name: sheet.name, url: appUrl(`/api/specs/${v.check.id}/sheet`) } },
    { kind: "menu", text: "💬 Forward the sheet to the supplier. Tap 📋 for the Chinese message to send with it:", prompt: "Tap 📋 for the Chinese message:", copy: { label: "📋 Chinese only", text: zh }, buttons: [{ id: "spec:new", label: "🆕 New check" }] },
  ];
}

function mismatchLine(r: Row) {
  const changed = r.earlier.length ? ` (was ${r.earlier.at(-1)!.value})` : "";
  return `${r.label_en}: you ${r.req?.value ?? "—"} → supplier ${r.sup?.value ?? "—"}${changed}`;
}

/** The Chinese message that goes with the sheet. Built from the table, not by a model: the numbers can't drift. */
export function supplierMessageZh(v: CheckView, compared: boolean): string {
  const part = v.check.part_number ?? v.check.part_name ?? "该产品";
  if (!compared) {
    return `您好！附件是 ${part} 的规格核对表（中英文）。请在「贵方数值」一栏填写贵司产品的实际参数，在「贵方确认」一栏逐项确认，并附上规格书。谢谢！`;
  }
  const bad = v.rows.filter((r) => r.status === "mismatch");
  const open = v.rows.filter((r) => r.status === "missing" || r.status === "check");
  const parts = [`您好！我们对比了贵司 ${part} 的资料和我方规格要求，附件是核对表（中英文）。`];
  const zhv = (x: string | undefined) => (x ?? "—").replace(/\s+to\s+/gi, " ~ ");
  const line = (r: Row) => r.key === "protections" || r.key === "certifications" ? `${r.label_zh}：${r.reason_zh}` : `${r.label_zh}：我方要求 ${zhv(r.req?.value)}，贵方 ${zhv(r.sup?.value)}`;
  if (bad.length) parts.push(`以下 ${bad.length} 项不符合：\n${bad.slice(0, 8).map((r, i) => `${i + 1}. ${line(r)}`).join("\n")}`);
  if (open.length) parts.push(`以下 ${open.length} 项请确认或补充：${open.slice(0, 6).map((r) => `${r.label_zh}（${STATUS_LABEL[r.status].zh}）`).join("、")}`);
  if (v.notes.some((n) => /substitut|changed a part|Same parameters/i.test(n.text_en))) parts.push("如有更换物料（包括国产替代料），请提供新物料的规格书，经我方书面确认后再生产。");
  if (euWarnings(v.rows, v.notes).length) parts.push("另外，产品需符合欧盟要求（CE/RoHS、生态设计 ErP），请提供欧盟符合性声明（DoC）及相关测试报告。");
  parts.push("请在表格「贵方确认」栏逐项回复，并填写可以保证的数值。谢谢！");
  return parts.join("\n\n");
}
