// Liveness + configuration check for deploys and monitoring. No secrets, no data: only what is set up.
import { NextResponse } from "next/server";
import { appDb } from "@/lib/server";
import { provider } from "@/lib/adapters/llm";
import { wecomConfigured } from "@/lib/channels/wecom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let db = "ok";
  try {
    (await appDb()).prepare("SELECT 1").get();
  } catch (e) {
    db = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  const body = {
    ok: db === "ok",
    app: "memini",
    ai: provider,
    wechat: wecomConfigured() ? "configured" : "not configured",
    publicUrl: process.env.APP_BASE_URL ?? null,
    db,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
