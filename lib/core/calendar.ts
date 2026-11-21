// Live calendar (.ics, RFC 5545): every Memini deadline in the phone's own Calendar app, with reminders.
// WeChat customer service can only write to the user for 48 h after their last message; the calendar has no such limit.
// Events are all-day (deadlines are dates), so they never shift with the phone's time zone.
import type { DB } from "@/lib/db";
import { addDays, nowIso, today, TZ } from "@/lib/db";
import { listTasks, ensureRecurring, type TaskRow } from "./tasks";
import { shareUrl, appUrl } from "./links";

export type FeedTask = Pick<TaskRow, "id" | "kind" | "who" | "what" | "due_at" | "status" | "matter_id" | "entity_id" | "created_at"> & {
  entity_name?: string | null; matter_title?: string | null; link?: string | null;
};

// ── RFC 5545 text helpers ──
/** TEXT values: backslash, semicolon, comma and newlines escaped (§3.3.11). */
export const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets are folded with CRLF + space, never inside a UTF-8 character (§3.1). */
export function icsFold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + b > limit) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const ymd = (d: string) => d.slice(0, 10).replace(/-/g, "");
const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "").slice(0, 15) + "Z";

/** Reminders that fit the kind of deadline. Triggers are relative to the start of the all-day event (00:00 local). */
export function alarmsFor(t: Pick<FeedTask, "kind" | "who">): { trigger: string; text: string }[] {
  const at9DaysBefore = (d: number) => (d === 0 ? "PT9H" : `-P${d - 1}DT15H`); // 09:00, d days before
  if (t.who === "counterparty") return [{ trigger: "PT10H", text: "Did they deliver? Check and follow up." }];
  if (t.kind === "renewal" || t.who === "authority" || t.kind === "appointment")
    return [{ trigger: at9DaysBefore(7), text: "In one week" }, { trigger: at9DaysBefore(1), text: "Tomorrow" }];
  if (t.kind === "payment") return [{ trigger: at9DaysBefore(2), text: "Payment due in 2 days" }, { trigger: at9DaysBefore(0), text: "Payment due today" }];
  return [{ trigger: at9DaysBefore(1), text: "Tomorrow" }, { trigger: at9DaysBefore(0), text: "Today" }];
}

const ICON: Record<string, string> = { renewal: "🔁", payment: "💳", appointment: "📅", deadline: "⏰", promise: "👀", todo: "✅" };

export function eventSummary(t: FeedTask): string {
  const who = t.who === "counterparty" && t.entity_name ? `${t.entity_name}: ` : "";
  const done = t.status === "done" ? "✓ " : "";
  return `${done}${ICON[t.kind] ?? "⏰"} ${who}${t.what}`;
}

/** Build the whole feed. Pure: same input → same output (except DTSTAMP), easy to test. */
export function buildIcs(tasks: FeedTask[], opts: { name?: string; now?: string; host?: string } = {}): string {
  const now = stamp(opts.now ?? nowIso());
  const host = opts.host ?? "memini";
  const lines: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Memini//Deadlines//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.name ?? "Memini")}`, `X-WR-TIMEZONE:${TZ}`,
    "X-WR-CALDESC:Deadlines\\, renewals\\, payments and promises tracked by Memini",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H", "X-APPLE-CALENDAR-COLOR:#D23F2E",
  ];
  for (const t of tasks) {
    if (!t.due_at || !/^\d{4}-\d{2}-\d{2}/.test(t.due_at) || t.status === "cancelled") continue;
    const desc = [
      t.who === "counterparty" ? "They promised this." : t.who === "authority" ? "Official deadline." : "Your deadline.",
      t.entity_name ? `With: ${t.entity_name}` : "",
      t.matter_title ? `Matter: ${t.matter_title}` : "",
      t.link ? `Details: ${t.link}` : "",
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${t.id}@${host}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${ymd(t.due_at)}`,
      `DTEND;VALUE=DATE:${ymd(addDays(t.due_at, 1))}`,
      `SUMMARY:${icsEscape(eventSummary(t))}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      ...(t.link ? [`URL:${t.link}`] : []),
      `CATEGORIES:${icsEscape(t.kind)}`,
      "TRANSP:TRANSPARENT", // a deadline doesn't make you busy
      "STATUS:CONFIRMED", // done tasks stay visible (✓, no reminder) for 30 days; cancelled ones are left out
    );
    if (t.status === "open" && t.due_at.slice(0, 10) >= (opts.now ?? nowIso()).slice(0, 10))
      for (const a of alarmsFor(t)) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(`${a.text}: ${t.what}`)}`, `TRIGGER:${a.trigger}`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** Open tasks (overdue included) + what was done in the last 30 days, with a fresh signed link to the matter. */
export function feedTasks(db: DB, workspaceId: string): FeedTask[] {
  ensureRecurring(db, workspaceId);
  const since = addDays(today(), -30);
  const rows = [...listTasks(db, workspaceId, { status: "open" }), ...listTasks(db, workspaceId, { status: "done" }).filter((t) => (t.due_at ?? "") >= since)];
  return rows.map((t) => ({
    ...t,
    link: t.matter_id ? shareUrl("m", t.matter_id) : t.entity_id ? shareUrl("e", t.entity_id) : null, // re-signed on every refresh: never expires in the calendar
  }));
}

export const calendarFeedUrl = (token: string) => appUrl(`/api/calendar/${token}.ics`);
export const calendarPageUrl = (token: string) => appUrl(`/cal/${token}`);
/** webcal:// makes iOS open "Subscribe to calendar" directly. */
export const webcalUrl = (token: string) => calendarFeedUrl(token).replace(/^https?:\/\//, "webcal://");
