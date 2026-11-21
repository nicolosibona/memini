import { NextResponse } from "next/server";
import { appDb, CURRENT_WS } from "@/lib/server";
import { getOutreachCampaign, simulateOutreachCampaign } from "@/lib/core/outreach";
import { pulse } from "@/lib/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  const existing = getOutreachCampaign(db, id);
  if (!existing) return NextResponse.json({ error: "Outreach campaign not found" }, { status: 404 });

  try {
    const campaign = await simulateOutreachCampaign(db, id);
    return NextResponse.json({
      ok: true,
      campaign,
      pulse: pulse(db, CURRENT_WS),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
