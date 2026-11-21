// The verification sheet (.xlsx) for the supplier — deliberately simple: ONE sheet, one line per parameter
// (EN + 中文), our requirement, their value, the result, and a column for them to confirm. EU compliance warnings below.
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { localDate } from "@/lib/db";
import { STATUS_LABEL, type Status } from "./compare";
import { EU_DISCLAIMER, euWarnings } from "./eu";
import { checkTitle, type CheckView } from "./store";

const FILL: Record<Status, string> = { ok: "FFE6F4EA", mismatch: "FFFCE4E2", missing: "FFFFF3D6", check: "FFFFF3D6", info: "FFF2F1EE" };
const thin = { style: "thin" as const, color: { argb: "FFD6D3CD" } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

export function sheetFileName(v: CheckView) {
  const base = (v.check.part_number ?? v.check.part_name ?? "spec").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "spec";
  return `Spec-check_${base}_核对表.xlsx`;
}

export async function buildSheet(v: CheckView): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Memini";
  const ws = wb.addWorksheet("核对表 Check", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = [{ width: 5 }, { width: 30 }, { width: 22 }, { width: 22 }, { width: 18 }, { width: 40 }, { width: 22 }];

  ws.mergeCells("A1:G1");
  ws.getCell("A1").value = `规格核对表 Spec check — ${checkTitle(v.check)}${v.check.supplier_name ? ` — ${v.check.supplier_name}` : ""}`;
  ws.getCell("A1").font = { size: 14, bold: true };
  ws.mergeCells("A2:G2");
  ws.getCell("A2").value = `${localDate()} · 请在最后一栏逐项确认 / Please confirm each line in the last column`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF6B665F" } };

  const head = ws.getRow(4);
  head.values = ["#", "参数 Parameter", "我方要求 Our spec", "贵方数值 Supplier", "结果 Result", "说明 Note", "贵方确认 Confirm"];
  head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C1B19" } }; c.border = border; c.alignment = { vertical: "middle" }; });
  head.height = 22;

  v.rows.filter((r) => r.status !== "info").forEach((r, i) => {
    const st = STATUS_LABEL[r.status];
    const row = ws.addRow([i + 1, `${r.label_zh} ${r.label_en}`, r.req?.value ?? "—", r.sup?.value ?? "未提供", `${st.icon} ${st.zh} ${st.en}`, r.status === "ok" ? "" : r.reason_zh, ""]);
    row.alignment = { wrapText: true, vertical: "top" };
    row.eachCell({ includeEmpty: true }, (c) => { c.border = border; });
    row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[r.status] } };
    row.getCell(5).font = { bold: r.status !== "ok" };
    row.getCell(7).dataValidation = { type: "list", allowBlank: true, formulae: ['"确认 OK,可修改 Will change,不能满足 Cannot meet"'] };
  });

  const eu = euWarnings(v.rows, v.notes);
  if (eu.length) {
    ws.addRow([]);
    const t = ws.addRow(["", "🇪🇺 欧盟合规提醒 EU compliance — 可能不符合 might not pass"]);
    ws.mergeCells(`B${t.number}:G${t.number}`);
    t.getCell(2).font = { bold: true, color: { argb: "FFB42318" } };
    for (const w of [...eu, EU_DISCLAIMER]) {
      const r = ws.addRow(["", `${w.zh}\n${w.en}`]);
      ws.mergeCells(`B${r.number}:G${r.number}`);
      r.getCell(2).alignment = { wrapText: true, vertical: "top" };
      r.height = 36;
      if (w === EU_DISCLAIMER) r.getCell(2).font = { italic: true, size: 9, color: { argb: "FF6B665F" } };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Writes the sheet under storage/files/sheets/<check> and returns its path (overwritten on each request). */
export async function writeSheet(v: CheckView): Promise<{ path: string; name: string }> {
  const dir = path.resolve(process.env.STORAGE_DIR ?? "./storage/files", "sheets", v.check.id);
  fs.mkdirSync(dir, { recursive: true });
  const name = sheetFileName(v);
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, await buildSheet(v));
  return { path: p, name };
}
