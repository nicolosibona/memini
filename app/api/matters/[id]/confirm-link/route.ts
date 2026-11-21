// Web app: create / list / disable the confirmation links of a matter (the page counterparties open from WeChat).
import { NextResponse } from "next/server";
import { appDb, CURRENT_USER, CURRENT_WS, jsonBody } from "@/lib/server";
import { confirmUrl, createConfirmLink, linksForMatter, missingDocs, revokeLink, termChoices, forwardMessageZh, isExpired, type Snapshot } from "@/lib/core/confirm";
import { getMatter } from "@/lib/core/matters";
import { DOC_TYPES, MATTER_KINDS, type DocType } from "@/lib/core/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const own = async (id: string) => {
  const db = await appDb();
  const m = getMatter(db, id);
  return { db, m: m && m.workspace_id === CURRENT_WS ? m : undefined };
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { db, m } = await own((await params).id);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const checklist = (MATTER_KINDS[m.kind]?.checklist ?? []).map((c) => c.doc as DocType);
  return NextResponse.json({
    choices: termChoices(db, m.id),
    missing: missingDocs(db, m),
    docOptions: [...new Set([...checklist, "business_license", "proforma_invoice", "bank_details", "certificate", "purchase_contract"] as DocType[])].map((d) => ({ doc: d, label: DOC_TYPES[d].label, zh: DOC_TYPES[d].zh })),
    links: linksForMatter(db, m.id).map((l) => {
      const snap = JSON.parse(l.terms_json) as Snapshot;
      return {
        token: l.token, url: confirmUrl(l.token), status: isExpired(l) && l.status === "open" ? "expired" : l.status, created_at: l.created_at, expires_at: l.expires_at,
        opened_at: l.opened_at, open_count: l.open_count, upload_count: l.upload_count, terms: snap.terms.length,
        message_zh: forwardMessageZh({ contact: l.contact_name, hasTerms: snap.terms.length > 0, docs: JSON.parse(l.docs_json), url: confirmUrl(l.token), kind: m.kind }),
      };
    }),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { db, m } = await own((await params).id);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = await jsonBody<{ factIds?: number[]; docs?: string[]; contactName?: string }>(req);
  try {
    const r = createConfirmLink(db, {
      userId: CURRENT_USER, matterId: m.id,
      factIds: Array.isArray(b?.factIds) ? b.factIds.map(Number).filter(Number.isFinite) : undefined,
      docs: Array.isArray(b?.docs) ? (b.docs.filter((d) => d in DOC_TYPES) as DocType[]) : undefined,
      contactName: b?.contactName?.trim() || null,
    });
    return NextResponse.json({ url: r.url, message_zh: r.message_zh, token: r.link.token });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { db, m } = await own((await params).id);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const token = new URL(req.url).searchParams.get("token");
  if (token) revokeLink(db, CURRENT_WS, token);
  return NextResponse.json({ ok: true });
}
