// The verification sheet (.xlsx) for the supplier — deliberately simple: ONE sheet, one line per parameter
// (中文 + the user's language), our requirement, their value, the result, and a column for them to confirm. EU compliance warnings below.
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { localDate } from "@/lib/db";
import { STATUS_LABEL, type Status } from "./compare";
import { EU_DISCLAIMER, euWarnings } from "./eu";
import { checkTitle, type CheckView } from "./store";
import { uiLang, type Lang } from "../lang";
import { rowLabel, S } from "./i18n";

const FILL: Record<Status, string> = { ok: "FFE6F4EA", mismatch: "FFFCE4E2", missing: "FFFFF3D6", check: "FFFFF3D6", info: "FFF2F1EE" };
const thin = { style: "thin" as const, color: { argb: "FFD6D3CD" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

export function sheetFileName(v: CheckView) {
  const base = (v.check.part_number ?? v.check.part_name ?? "spec").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "spec";
  return `Spec-check_${base}_核对表.xlsx`;
}

export async function buildSheet(v: CheckView, lang: Lang = "en"): Promise<Buffer> {
  const ul = uiLang(lang), t = S(ul).sheet, st = S(ul).status;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Memini";
  const ws = wb.addWorksheet(`核对表 ${t.tab}`, { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = [{ width: 5 }, { width: 30 }, { width: 22 }, { width: 22 }, { width: 18 }, { width: 40 }, { width: 22 }];

  ws.mergeCells("A1:G1");
  ws.getCell("A1").value = `规格核对表 ${t.title} — ${checkTitle(v.check)}${v.check.supplier_name ? ` — ${v.check.supplier_name}` : ""}`;
  ws.getCell("A1").font = { size: 14, bold: true };
  ws.mergeCells("A2:G2");
  ws.getCell("A2").value = `${localDate()} · 请在最后一栏逐项确认 / ${t.subtitle}`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF6B665F" } };

  const head = ws.getRow(4);
  const zhHead = ["参数", "我方要求", "贵方数值", "结果", "说明", "贵方确认"];
  head.values = ["#", ...zhHead.map((z, i) => `${z} ${t.columns[i]}`)];
  head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C1B19" } }; c.border = border; c.alignment = { vertical: "middle" }; });
  head.height = 22;

  v.rows.filter((r) => r.status !== "info").forEach((r, i) => {
    const sl = STATUS_LABEL[r.status];
    const row = ws.addRow([i + 1, `${r.label_zh} ${rowLabel(r, lang)}`, r.req?.value ?? "—", r.sup?.value ?? `未提供 ${t.notGiven}`, `${sl.icon} ${sl.zh} ${st[r.status]}`, r.status === "ok" ? "" : r.reason_zh, ""]);
    row.alignment = { wrapText: true, vertical: "top" };
    row.eachCell({ includeEmpty: true }, (c) => { c.border = border; });
    row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[r.status] } };
    row.getCell(5).font = { bold: r.status !== "ok" };
    const choices = ["确认", "可修改", "不能满足"].map((z, k) => `${z} ${t.choices[k]}`.replace(/[",]/g, " "));
    row.getCell(7).dataValidation = { type: "list", allowBlank: true, formulae: [`"${choices.join(",")}"`] };
  });

  const eu = euWarnings(v.rows, v.notes);
  if (eu.length) {
    ws.addRow([]);
    const h = ws.addRow(["", `🇪🇺 欧盟合规提醒（可能不符合） ${t.euHeader}`]);
    ws.mergeCells(`B${h.number}:G${h.number}`);
    h.getCell(2).font = { bold: true, color: { argb: "FFB42318" } };
    for (const w of [...eu, EU_DISCLAIMER]) {
      const r = ws.addRow(["", `${w.zh}\n${w[ul]}`]);
      ws.mergeCells(`B${r.number}:G${r.number}`);
      r.getCell(2).alignment = { wrapText: true, vertical: "top" };
      r.height = 36;
      if (w === EU_DISCLAIMER) r.getCell(2).font = { italic: true, size: 9, color: { argb: "FF6B665F" } };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Writes the sheet under storage/files/sheets/<check> and returns its path (overwritten on each request). */
export async function writeSheet(v: CheckView, lang: Lang = "en"): Promise<{ path: string; name: string }> {
  const dir = path.resolve(process.env.STORAGE_DIR ?? "./storage/files", "sheets", v.check.id);
  fs.mkdirSync(dir, { recursive: true });
  const name = sheetFileName(v);
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, await buildSheet(v, lang));
  return { path: p, name };
}
