// Web app: the current user's calendar links, and "Reset link" (the old URL stops working).
import { NextResponse } from "next/server";
import { appDb, CURRENT_USER, jsonBody } from "@/lib/server";
import { rotateToken, userToken } from "@/lib/core/tokens";
import { calendarFeedUrl, calendarPageUrl, webcalUrl } from "@/lib/core/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const links = (token: string) => ({ feed: calendarFeedUrl(token), webcal: webcalUrl(token), page: calendarPageUrl(token) });

export async function GET() {
  const db = await appDb();
  return NextResponse.json(links(userToken(db, CURRENT_USER, "calendar")));
}

export async function POST(req: Request) {
  const body = await jsonBody<{ action?: string }>(req);
  if (body?.action !== "rotate") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const db = await appDb();
  return NextResponse.json(links(rotateToken(db, CURRENT_USER, "calendar")));
}
