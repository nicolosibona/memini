// The live calendar feed (iOS Calendar, macOS, Outlook, Google): GET /api/calendar/<token>.ics
// The token is the only credential (calendar apps can't log in), long-lived and resettable in Settings.
import crypto from "node:crypto";
import { appDb } from "@/lib/server";
import { resolveToken } from "@/lib/core/tokens";
import { buildIcs, feedTasks } from "@/lib/core/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await appDb();
  const t = resolveToken(db, token.replace(/\.ics$/i, ""), "calendar");
  if (!t) return new Response("Calendar link not found or reset. Get the new one in Memini → Deadlines.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const host = new URL(process.env.APP_BASE_URL ?? "http://localhost:3000").hostname;
  const body = buildIcs(feedTasks(db, t.workspace_id), { name: "Memini", host });
  // ETag on the content without DTSTAMP, so an unchanged calendar answers 304
  const etag = `"${crypto.createHash("sha1").update(body.replace(/^DTSTAMP:.*$/gm, "")).digest("hex").slice(0, 20)}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="memini.ics"',
      "cache-control": "private, max-age=300",
      etag,
    },
  });
}
