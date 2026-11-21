// Live updates: open pages poll this fingerprint and refresh only when it changes.
import { NextResponse } from "next/server";
import { appDb, CURRENT_WS } from "@/lib/server";
import { pulse } from "@/lib/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(pulse(await appDb(), CURRENT_WS), { headers: { "cache-control": "no-store" } });
}
