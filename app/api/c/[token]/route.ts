// What the counterparty's phone posts from /c/<token>: confirm the terms, ask for a change, upload a document.
// Plain HTML forms (works in WeChat's browser even without JavaScript): answers with a redirect back to the page;
// fetch() callers asking for JSON get JSON. Slow work (reading a document, translating a note) runs after the answer.
import { after } from "next/server";
import { NextResponse } from "next/server";
import { appDb } from "@/lib/server";
import { confirmTerms, getLink, isExpired, recordChangeRequest, recordUpload, MAX_UPLOADS, MAX_UPLOAD_BYTES, type Snapshot } from "@/lib/core/confirm";
import { handleIncoming, storeFile, type OutgoingReply } from "@/lib/core/ingest";
import { mimeOf } from "@/lib/core/extract";
import { runAudit, openAlerts } from "@/lib/core/audit";
import { getEntity, entityLabel } from "@/lib/core/entities";
import { shareUrl } from "@/lib/core/links";
import { notifyUser } from "@/lib/channels/wecom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// a few answers per minute is plenty for a person; this stops a script from burning AI calls through a leaked link
const hits = new Map<string, number[]>();
function limited(key: string, max = 20, windowMs = 10 * 60_000) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

const OK_TYPES = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  const back = (q: string, status = 303) => wantsJson ? NextResponse.json({ result: q }, { status: q.startsWith("err=") ? 400 : 200 }) : new Response(null, { status, headers: { location: `/c/${token}?${q}` } });
  const db = await appDb();
  const link = getLink(db, token);
  if (!link) return wantsJson ? NextResponse.json({ error: "not_found" }, { status: 404 }) : new Response(null, { status: 303, headers: { location: `/c/${token}` } });
  if (isExpired(link)) return back("err=expired");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const ua = req.headers.get("user-agent");
  if (limited(`${token}:${ip}`)) return back("err=rate");

  const form = await req.formData().catch(() => null);
  if (!form) return back("err=bad");
  const action = String(form.get("action") ?? "");
  const entity = link.entity_id ? getEntity(db, link.entity_id) : undefined;
  const who = link.contact_name ? `${link.contact_name}${entity ? ` (${entity.display_name})` : ""}` : entity ? entityLabel(entity) : "Your counterparty";
  const snap = JSON.parse(link.terms_json) as Snapshot;

  if (action === "confirm") {
    const r = confirmTerms(db, token, { ip, ua });
    if (!r.ok) return back(`err=${r.error}`);
    if (!r.already) {
      await runAudit(db, link.workspace_id);
      after(async () => {
        const red = openAlerts(db, { matterId: link.matter_id }).filter((a) => a.severity === "red");
        const text = [
          `✅ ${who} confirmed the terms of ${snap.matter_title} through your link:`,
          snap.terms.map((t) => `• ${t.en}: ${t.value_en}`).join("\n"),
          red.length ? `⚠️ Still open:\n${red.map((a) => `• ${a.title}`).join("\n")}` : "",
          `🔗 ${shareUrl("m", link.matter_id)}`,
        ].filter(Boolean).join("\n\n");
        await notifyUser(db, link.user_id, [{ kind: "text", text }]).catch((e) => console.error("[confirm] notify failed:", e));
      });
    }
    return back("ok=confirmed");
  }

  if (action === "changes") {
    const note = String(form.get("note") ?? "").trim().slice(0, 1000);
    if (!note) return back("err=empty");
    recordChangeRequest(db, token, { note, messageId: null, ip, ua });
    after(async () => {
      try {
        const replies = await handleIncoming({ userId: link.user_id, channel: "supplier_link", items: [{ kind: "text", text: note }], entityId: link.entity_id ?? undefined, matterId: link.matter_id }, db);
        await notifyUser(db, link.user_id, [{ kind: "text", text: `✏️ ${who} asked for a change to ${snap.matter_title} through your link:\n“${note}”` }, ...replies]);
      } catch (e) { console.error("[confirm] change request failed:", e); }
    });
    return back("ok=changes");
  }

  if (action === "upload") {
    if (link.upload_count >= MAX_UPLOADS) return back("err=limit");
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return back("err=nofile");
    const stored: { path: string; name: string; kind: "image" | "file" }[] = [];
    for (const f of files.slice(0, Math.max(0, MAX_UPLOADS - link.upload_count))) {
      if (f.size > MAX_UPLOAD_BYTES) return back("err=too_big");
      const p = storeFile(f.name || "upload.jpg", Buffer.from(await f.arrayBuffer()));
      const mime = f.type && OK_TYPES.test(f.type) ? f.type : mimeOf(p);
      if (!OK_TYPES.test(mime)) return back("err=type");
      stored.push({ path: p, name: f.name, kind: mime.startsWith("image/") ? "image" : "file" });
      recordUpload(db, token, { fileName: f.name || "photo", ip, ua });
    }
    after(async () => {
      for (const s of stored) {
        try {
          const replies: OutgoingReply[] = await handleIncoming({ userId: link.user_id, channel: "supplier_link", items: [{ kind: s.kind, filePath: s.path }], entityId: link.entity_id ?? undefined, matterId: link.matter_id }, db);
          await notifyUser(db, link.user_id, [{ kind: "text", text: `📎 ${who} uploaded “${s.name}” through your link.` }, ...replies]);
        } catch (e) { console.error("[confirm] upload failed:", e); }
      }
    });
    return back("ok=uploaded");
  }
  return back("err=bad");
}
