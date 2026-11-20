import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { jsonBody } from "@/lib/server";
import { resetDemo } from "@/lib/demo/seed";
import { PROFILES, type ProfileKey } from "@/lib/core/domain";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = (await jsonBody<{ empty?: boolean; profile?: ProfileKey }>(req)) ?? {};
  if (b.profile && !(b.profile in PROFILES)) return NextResponse.json({ error: "unknown profile" }, { status: 400 });
  await resetDemo(getDb(), { empty: b.empty, profile: b.profile });
  return NextResponse.json({ ok: true });
}
