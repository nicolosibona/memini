import { NextResponse } from "next/server";
import { appDb, CURRENT_WS } from "@/lib/server";
import { ask } from "@/lib/core/assistant";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { question } = (await req.json()) as { question?: string };
  if (!question?.trim()) return NextResponse.json({ error: "empty question" }, { status: 400 });
  const t0 = Date.now();
  const a = await ask(await appDb(), CURRENT_WS, question.trim(), { channel: "web" });
  return NextResponse.json({ ...a, ms: Date.now() - t0 });
}
