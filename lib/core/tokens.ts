// Long-lived secret URLs that belong to the user (not to a counterparty): the calendar feed and the email
// forwarding address. They don't expire — a subscribed iPhone calendar must keep working — but can be reset.
import crypto from "node:crypto";
import type { DB } from "@/lib/db";
import { nowIso } from "@/lib/db";

export type TokenPurpose = "calendar" | "email";
type TokenRow = { token: string; user_id: string; workspace_id: string; purpose: TokenPurpose; created_at: string; revoked_at: string | null; last_used_at: string | null };

/** 24 random bytes, URL- and email-safe (lowercase letters + digits, so it also works as an address local part). */
export const randomToken = (bytes = 24) => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.randomBytes(bytes * 2), (b) => alphabet[b % 36]).join("").slice(0, Math.ceil(bytes * 1.6));
};

export function userToken(db: DB, userId: string, purpose: TokenPurpose): string {
  const row = db.prepare(`SELECT token FROM inbound_tokens WHERE user_id = ? AND purpose = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(userId, purpose) as { token: string } | undefined;
  if (row) return row.token;
  return createToken(db, userId, purpose);
}

function createToken(db: DB, userId: string, purpose: TokenPurpose): string {
  const ws = (db.prepare(`SELECT workspace_id FROM users WHERE id = ?`).get(userId) as { workspace_id: string } | undefined)?.workspace_id;
  if (!ws) throw new Error(`unknown user ${userId}`);
  const token = randomToken();
  db.prepare(`INSERT INTO inbound_tokens (token, user_id, workspace_id, purpose, created_at) VALUES (?,?,?,?,?)`).run(token, userId, ws, purpose, nowIso());
  return token;
}

/** "Reset link": the old URL stops working at once (a leaked calendar link or a spammed address). */
export function rotateToken(db: DB, userId: string, purpose: TokenPurpose): string {
  db.prepare(`UPDATE inbound_tokens SET revoked_at = ? WHERE user_id = ? AND purpose = ? AND revoked_at IS NULL`).run(nowIso(), userId, purpose);
  return createToken(db, userId, purpose);
}

export function resolveToken(db: DB, token: string, purpose: TokenPurpose): TokenRow | null {
  if (!/^[a-z0-9]{16,64}$/.test(token)) return null;
  const row = db.prepare(`SELECT * FROM inbound_tokens WHERE token = ? AND purpose = ? AND revoked_at IS NULL`).get(token, purpose) as TokenRow | undefined;
  if (!row) return null;
  db.prepare(`UPDATE inbound_tokens SET last_used_at = ? WHERE token = ?`).run(nowIso(), token);
  return row;
}
