// Email-to-Memini delivery: every way an email can arrive ends here, then goes through the same brain as WeChat.
//   webhook  POST /api/inbound/email/<token> — raw MIME from a Cloudflare Email Worker (free, needs a domain)
//   imap     a dedicated Gmail / QQ Mail inbox polled by the server (free, no domain) — lib/channels/imap.ts
//   upload   an .eml file dropped in the web chat or upload page
//   simulate the "Simulate an incoming email" form in Settings
// Who may send: the address carries the user's secret token (memini+<token>@…), or the sender is on the allowlist
// (EMAIL_ALLOWED_SENDERS, plus the user's own email) and SPF/DKIM didn't fail. Anything else is dropped.
import "server-only";
import { DEMO_USER, getDb, type DB } from "@/lib/db";
import { handleIncoming, storeFile, type IncomingItem, type OutgoingReply } from "@/lib/core/ingest";
import { parseEmail, companyDomain, tokenIn, type ParsedEmail } from "@/lib/core/email";
import { resolveToken, userToken } from "@/lib/core/tokens";
import { mimeOf } from "@/lib/core/extract";
import { notifyUser } from "./wecom";

export type Via = "webhook" | "imap" | "upload" | "simulate";
export type DeliverResult = { ok: true; userId: string; replies: OutgoingReply[] } | { ok: false; reason: string };

const allowlist = (db: DB, userId: string) => {
  const own = (db.prepare(`SELECT email FROM users WHERE id = ?`).get(userId) as { email: string | null } | undefined)?.email;
  return [...(process.env.EMAIL_ALLOWED_SENDERS ?? "").split(","), own ?? ""].map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@") && !s.endsWith(".local"));
};

/** Which user an email is for, or why it is refused. */
export function authorize(db: DB, mail: Pick<ParsedEmail, "from" | "to" | "authPass">, o: { token?: string | null; via: Via; userId?: string }): { userId: string } | { reason: string } {
  if (o.via === "upload" || o.via === "simulate") return { userId: o.userId ?? DEMO_USER }; // the signed-in web user
  const token = o.token ?? tokenIn(mail.to);
  if (token) {
    const t = resolveToken(db, token, "email");
    if (t) return { userId: t.user_id };
    if (o.token) return { reason: "unknown token" };
  }
  // no token in the address (e.g. QQ Mail has no plus-addressing): only the user's own addresses, authenticated
  const user = DEMO_USER; // D11: single user
  if (mail.from && allowlist(db, user).includes(mail.from) && mail.authPass !== false) return { userId: user };
  return { reason: `sender ${mail.from ?? "unknown"} not allowed` };
}

/** Email → one group of items (body + attachments). Forwarded: the original sender is a weak clue, like a WeChat nickname. */
export function emailItems(mail: ParsedEmail, userIsSender: boolean): IncomingItem[] {
  const id = mail.messageId ? `email:${mail.messageId}` : undefined;
  const at = (mail.forwarded?.date && !isNaN(+new Date(mail.forwarded.date)) ? new Date(mail.forwarded.date).toISOString() : null) ?? mail.date ?? new Date().toISOString();
  const author = mail.forwarded
    ? [mail.forwarded.name, mail.forwarded.email && `<${mail.forwarded.email}>`].filter(Boolean).join(" ") || null
    : userIsSender ? null : [mail.fromName, mail.from && `<${mail.from}>`].filter(Boolean).join(" ") || null;
  const domain = companyDomain(mail.forwarded?.email ?? (userIsSender ? null : mail.from));
  const items: IncomingItem[] = [];
  const body = mail.body.replace(/^-{2,}\s*(Forwarded message|Original Message|转发的邮件|原始邮件)\s*-{2,}$/gim, "").trim();
  if (body.length >= 20 || !mail.attachments.length) {
    items.push({
      kind: "text", text: `${mail.subject ? `Subject: ${mail.subject}\n\n` : ""}${body}`.slice(0, 8000), receivedAt: at,
      originalAuthor: author ?? undefined, chatTitle: domain ? `${mail.subject} (${domain})` : mail.subject || undefined,
      externalMsgId: id && `${id}#body`,
      fromMe: !mail.forwarded && userIsSender, // BCC'd: the user wrote this to the counterparty
    });
  }
  mail.attachments.forEach((a, i) => {
    const p = storeFile(a.filename, a.content);
    const mime = a.mimeType.startsWith("image/") ? a.mimeType : mimeOf(p);
    items.push({ kind: mime.startsWith("image/") ? "image" : "file", filePath: p, receivedAt: at, originalAuthor: author ?? undefined, externalMsgId: id && `${id}#${i}` });
  });
  return items;
}

export async function deliverParsed(mail: ParsedEmail, o: { via: Via; token?: string | null; userId?: string; notify?: boolean }, db: DB = getDb()): Promise<DeliverResult> {
  const auth = authorize(db, mail, o);
  if ("reason" in auth) { console.warn(`[email] refused (${o.via}): ${auth.reason}`); return { ok: false, reason: auth.reason }; }
  const userIsSender = !!mail.from && allowlist(db, auth.userId).includes(mail.from);
  const items = emailItems(mail, userIsSender);
  if (!items.length) return { ok: false, reason: "empty email" };
  const replies = await handleIncoming({ userId: auth.userId, channel: "email", items }, db);
  if (o.notify && replies.length) {
    const head: OutgoingReply = { kind: "text", text: `📧 Email${mail.forwarded?.name || mail.forwarded?.email ? ` from ${mail.forwarded.name ?? mail.forwarded.email}` : ""}: “${mail.subject || "(no subject)"}”${mail.attachments.length ? ` · ${mail.attachments.length} attachment${mail.attachments.length > 1 ? "s" : ""}` : ""}` };
    await notifyUser(db, auth.userId, [head, ...replies]).catch((e) => console.error("[email] notify failed:", e));
  }
  return { ok: true, userId: auth.userId, replies };
}

export async function deliverRaw(raw: Buffer | string, o: { via: Via; token?: string | null; userId?: string; notify?: boolean }, db: DB = getDb()): Promise<DeliverResult> {
  let mail: ParsedEmail;
  try { mail = await parseEmail(raw); } catch (e) { return { ok: false, reason: `unreadable email: ${e instanceof Error ? e.message : e}` }; }
  return deliverParsed(mail, o, db);
}

/** The address the user forwards to, as configured (EMAIL_INBOUND_ADDRESS for IMAP, EMAIL_INBOUND_DOMAIN for Cloudflare). */
export function inboundAddress(db: DB, userId: string): { address: string | null; mode: "imap" | "cloudflare" | "off"; token: string } {
  const token = userToken(db, userId, "email");
  const domain = process.env.EMAIL_INBOUND_DOMAIN?.trim();
  if (domain) return { address: `${token}@${domain}`, mode: "cloudflare", token };
  const box = process.env.EMAIL_INBOUND_ADDRESS?.trim();
  if (box && process.env.IMAP_HOST) {
    const [local, host] = box.split("@");
    return { address: process.env.EMAIL_PLUS_ADDRESSING === "0" ? box : `${local}+${token}@${host}`, mode: "imap", token };
  }
  return { address: null, mode: "off", token };
}
