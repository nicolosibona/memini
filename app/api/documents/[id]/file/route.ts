// Serves an original document to the web app (never logged, workspace-checked — §12).
import fs from "node:fs";
import { appDb, CURRENT_WS } from "@/lib/server";
import { mimeOf, originalFileName } from "@/lib/core/extract";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  const d = db.prepare(`SELECT file_path FROM documents WHERE id = ? AND workspace_id = ?`).get(id, CURRENT_WS) as { file_path: string } | undefined;
  if (!d?.file_path || !fs.existsSync(d.file_path)) return new Response("not found", { status: 404 });
  const mime = mimeOf(d.file_path);
  return new Response(new Uint8Array(fs.readFileSync(d.file_path)), {
    headers: {
      "content-type": mime.startsWith("text/") ? `${mime}; charset=utf-8` : mime,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(originalFileName(d.file_path))}`,
      "cache-control": "private, max-age=300",
      // uploaded HTML is shown in a sandboxed iframe; no scripts
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    },
  });
}
