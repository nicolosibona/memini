// The verification sheet of one spec check, built fresh from the current table (so it always matches the page).
import { appDb, CURRENT_WS } from "@/lib/server";
import { loadCheck } from "@/lib/core/spec/store";
import { buildSheet, sheetFileName } from "@/lib/core/spec/sheet";
import { workspaceLang } from "@/lib/core/lang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  const v = loadCheck(db, id);
  if (!v || v.check.workspace_id !== CURRENT_WS) return new Response("Not found", { status: 404 });
  const name = sheetFileName(v);
  return new Response(new Uint8Array(await buildSheet(v, workspaceLang(db, CURRENT_WS))), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="spec-check.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
