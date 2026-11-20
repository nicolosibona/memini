// Server-side entry for pages and route handlers: the DB (seeded on first run) and the current workspace.
import "server-only";
import { getDb, DEMO_USER, DEMO_WORKSPACE, type DB } from "@/lib/db";
import { ensureSeeded } from "@/lib/demo/seed";
import { PROFILES, type ProfileKey } from "@/lib/core/domain";

export async function appDb() {
  const db = getDb();
  await ensureSeeded(db);
  return db;
}
export const CURRENT_USER = DEMO_USER; // D11: single demo user until login + QR linking
export const CURRENT_WS = DEMO_WORKSPACE;

export function workspaceProfile(db: DB) {
  const key = ((db.prepare(`SELECT profile FROM workspaces WHERE id = ?`).get(CURRENT_WS) as { profile: string } | undefined)?.profile ?? "china_business") as ProfileKey;
  return { key, def: PROFILES[key] ?? PROFILES.china_business };
}

/** Parse a JSON body safely: route handlers return 400 instead of crashing on bad input. */
export async function jsonBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
