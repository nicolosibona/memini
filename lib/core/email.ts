// Email-to-Memini: a forwarded (or BCC'd) email becomes ONE group for handleIncoming — the body as a message, the
// attachments as documents — so a PI that arrives by email is checked against what was agreed on WeChat.
// Pure parsing here (tested); delivery (webhook, IMAP, notification) lives in lib/channels/email.ts.
import PostalMime from "postal-mime";
import { htmlToText } from "./extract";

export type ParsedEmail = {
  messageId: string | null;
  from: string | null;            // envelope/header sender: who forwarded it to Memini (normally the user)
  fromName: string | null;
  to: string[];                   // every recipient address (To, Cc, Delivered-To, X-Original-To)
  subject: string;
  date: string | null;            // ISO
  body: string;                   // the text the user forwarded, signatures and long quoted history trimmed
  forwarded: { name: string | null; email: string | null; date: string | null } | null; // the original sender, when forwarded
  authPass: boolean | null;       // SPF or DKIM passed (null: no Authentication-Results header)
  attachments: { filename: string; mimeType: string; content: Buffer }[];
  skipped: string[];              // attachments left out (logos, calendar invites, signatures…)
};

const KEEP = /^(application\/pdf|image\/(jpeg|png|webp|gif)|text\/(html|plain))$/i;
const KEEP_EXT = /\.(pdf|jpe?g|png|webp|gif|html?|txt)$/i;
const SKIP_EXT = /\.(ics|vcf|p7s|asc|sig)$|^winmail\.dat$/i;
export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const addr = (s: string | undefined | null) => (s ?? "").trim().toLowerCase() || null;

export async function parseEmail(raw: Buffer | string): Promise<ParsedEmail> {
  const mail = await PostalMime.parse(typeof raw === "string" ? raw : new Uint8Array(raw));
  const header = (name: string) => mail.headers.filter((h) => h.key.toLowerCase() === name).map((h) => h.value);
  const text = (mail.text?.trim() || (mail.html ? htmlToText(mail.html) : "")).replace(/\r\n/g, "\n");
  const forwarded = forwardedFrom(text);
  const auth = header("authentication-results").join(" ");
  const recipients = [...(mail.to ?? []), ...(mail.cc ?? []), ...(mail.bcc ?? [])]
    .flatMap((a) => (a.group ? a.group : [a])).map((a) => addr(a.address)).filter(Boolean) as string[];
  const extra = [mail.deliveredTo ?? "", ...header("delivered-to"), ...header("x-original-to"), ...header("x-forwarded-to")].map((v) => addr(v.replace(/.*<|>.*/g, ""))).filter(Boolean) as string[];
  const from = mail.from && !mail.from.group ? mail.from : mail.sender && !mail.sender.group ? mail.sender : undefined;

  const attachments: ParsedEmail["attachments"] = [];
  const skipped: string[] = [];
  for (const a of mail.attachments) {
    const name = a.filename || `attachment${a.mimeType === "application/pdf" ? ".pdf" : ""}`;
    const content = typeof a.content === "string" ? Buffer.from(a.content, a.encoding === "base64" ? "base64" : "utf8") : Buffer.from(a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content));
    const inlineSmall = (a.disposition === "inline" || a.related) && a.mimeType.startsWith("image/") && content.length < 30_000; // logos, signature images
    if (SKIP_EXT.test(name) || inlineSmall || !(KEEP.test(a.mimeType) || KEEP_EXT.test(name)) || content.length > MAX_ATTACHMENT_BYTES || attachments.length >= MAX_ATTACHMENTS) { skipped.push(name); continue; }
    attachments.push({ filename: name, mimeType: a.mimeType, content });
  }
  return {
    messageId: mail.messageId?.replace(/[<>\s]/g, "") || null,
    from: addr(from?.address), fromName: from?.name || null,
    to: [...new Set([...recipients, ...extra])],
    subject: (mail.subject ?? "").trim(),
    date: mail.date ? new Date(mail.date).toISOString() : null,
    body: trimBody(text),
    forwarded,
    authPass: auth ? /\b(dkim|spf|dmarc)=pass\b/i.test(auth) : null,
    attachments, skipped,
  };
}

/** "---------- Forwarded message ---------\nFrom: Lisa <lisa@abc.cn>" (Gmail), "发件人: …" (QQ/163/Outlook in Chinese), "From: …\nSent: …" (Outlook). */
export function forwardedFrom(text: string): ParsedEmail["forwarded"] {
  const block = text.match(/(?:-{2,}\s*(?:Forwarded message|Original Message|转发的邮件|原始邮件)\s*-{2,}|Begin forwarded message:)([\s\S]{0,800})/i)?.[1] ?? (/^(From|发件人)\s*[:：]/m.test(text.slice(0, 600)) ? text.slice(0, 800) : null);
  if (!block) return null;
  const line = block.match(/^\s*(?:From|发件人)\s*[:：]\s*(.+)$/im)?.[1]?.trim();
  if (!line) return null;
  const email = line.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0]?.toLowerCase() ?? null;
  const name = line.replace(/<[^>]*>|\[mailto:[^\]]*\]|"/g, "").replace(email ?? "\u0000", "").trim() || null;
  const date = block.match(/^\s*(?:Date|Sent|发送时间|日期|时间)\s*[:：]\s*(.+)$/im)?.[1]?.trim() ?? null;
  return { name, email, date };
}

/** Keep the message, drop a long quoted thread below it (older messages already reached Memini, or would re-date old facts). */
export function trimBody(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let quoted = 0;
  for (const l of lines) {
    if (/^\s*>/.test(l)) { if (++quoted > 40) continue; }
    if (/^On .{6,80} wrote:\s*$|^在.{4,60}写道[:：]\s*$/.test(l.trim()) && out.length > 3) break; // reply chain under a forward
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}

const FREE_MAIL = /@(gmail|googlemail|qq|foxmail|163|126|yeah|sina|sohu|aliyun|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail)\.(com|cn|net|me)$/i;
/** A company email domain is a weak clue (orders the "Who is this from?" menu); free-mail domains say nothing. */
export const companyDomain = (email: string | null) => (email && !FREE_MAIL.test(email) ? email.split("@")[1] : null);

/** The user's token in the address: memini+<token>@gmail.com (IMAP) or <token>@in.your-domain (Cloudflare). */
export function tokenIn(addresses: string[]): string | null {
  for (const a of addresses) {
    const local = a.split("@")[0] ?? "";
    const t = local.includes("+") ? local.split("+").pop()! : local;
    if (/^[a-z0-9]{16,64}$/.test(t)) return t;
  }
  return null;
}
