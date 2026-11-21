import { NextResponse } from "next/server";
import { appDb, CURRENT_WS, jsonBody } from "@/lib/server";
import {
  createOutreachCampaign,
  ensureOutreachSuppliers,
  listOutreachCampaigns,
  type CreateCampaignInput,
} from "@/lib/core/outreach";
import { createMatter, getMatter } from "@/lib/core/matters";
import { pulse } from "@/lib/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await appDb();
  ensureOutreachSuppliers(db, CURRENT_WS);
  const campaigns = listOutreachCampaigns(db, CURRENT_WS);
  return NextResponse.json({ campaigns, pulse: pulse(db, CURRENT_WS) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await jsonBody<Partial<CreateCampaignInput> & { newProductTitle?: string }>(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const db = await appDb();
  ensureOutreachSuppliers(db, CURRENT_WS);

  let matterId = body.matterId?.trim();
  if (!matterId && body.newProductTitle?.trim()) {
    const title = body.newProductTitle.trim();
    const created = createMatter(db, CURRENT_WS, { kind: "purchase", subject: title, title });
    matterId = created.id;
  }

  if (!matterId || !getMatter(db, matterId)) {
    return NextResponse.json({ error: "Valid matterId (or newProductTitle) is required" }, { status: 400 });
  }

  const targetPrice = Number(body.targetPrice);
  const targetQuantity = Number(body.targetQuantity);
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    return NextResponse.json({ error: "targetPrice must be a positive number" }, { status: 400 });
  }
  if (!Number.isFinite(targetQuantity) || targetQuantity <= 0) {
    return NextResponse.json({ error: "targetQuantity must be a positive number" }, { status: 400 });
  }

  const contactIds = Array.isArray(body.contactIds) ? body.contactIds.filter((id) => typeof id === "string" && id.trim()) : [];
  if (!contactIds.length) {
    return NextResponse.json({ error: "Select at least one supplier contact" }, { status: 400 });
  }

  try {
    const campaign = await createOutreachCampaign(db, {
      workspaceId: CURRENT_WS,
      matterId,
      targetPrice,
      currency: body.currency ?? "USD",
      targetQuantity,
      preferredIncoterm: body.preferredIncoterm ?? "FOB",
      maxLeadTimeDays: Number(body.maxLeadTimeDays ?? 20),
      deadline: body.deadline ?? null,
      contactIds,
    });
    return NextResponse.json({ campaign, pulse: pulse(db, CURRENT_WS) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
