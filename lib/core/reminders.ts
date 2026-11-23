// "I have a meeting with Seller 1 on 25 December, put it in the calendar" / "ricordami di pagare l'affitto venerdì" /
// "提醒我周五付定金": the user's OWN appointments and reminders, typed or dictated on WeChat. They become a task (→ the
// phone calendar feed). Dates are read with rules first (EN / IT / ZH, relative to China time); the model is only asked
// when the rules find no date. Never a silent guess: the reply states the exact date and offers Undo.
import { z } from "zod";
import type { DB } from "@/lib/db";
import { addDays, today, weekdayOf } from "@/lib/db";
import { callJSON, provider } from "@/lib/adapters/llm";
import { findEntityRefs } from "./memory";
import { getEntity, entityLabel } from "./entities";
import { addTask } from "./tasks";
import type { TaskKind } from "./domain";

// ── is this a calendar request? ──
const ASK_CAL = /\b(calendar|calender|agenda|remind me|reminder|schedule (it|this|that)|add (it|this|that) to my|save (it|the date))\b|calendario|ricordami|promemoria|segna(mi|lo|la)?\b|metti(lo|la)? in agenda|aggiungi(lo|la)? al|提醒我|加到日历|放到日历|日历|记一下|别忘了提醒/i;
const ADD_VERB = /\b(put|add|save|insert|schedule|set|book|note|remind|keep)\b|metti|aggiungi|segna|inserisci|salva|ricordami|promemoria|提醒|加到|放到|记一下|记下/i;
const OWN_EVENT = /^(?:\s*(?:i|we)\s+(?:have|'ve got|got|will have)|\s*(?:i'm|i am|we're|we are)\s+(?:meeting|visiting|seeing|calling)|\s*(?:ho|abbiamo|avrò|avremo)\b|\s*(?:我|我们)(?:有|要|约了))/i;
const EVENT_NOUN = /\b(meeting|call|appointment|visit|inspection|interview|dinner|lunch|flight|trip|deadline|payment|riunione|incontro|appuntamento|chiamata|call|visita|ispezione|volo|scadenza|pagamento)\b|开会|会议|见面|拜访|验货|面试|航班|约/i;

export function isCalendarRequest(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 600) return false;
  if (ASK_CAL.test(t) && ADD_VERB.test(t)) return true; // "put it in my calendar" — not "what's in my calendar?"
  return OWN_EVENT.test(t) && EVENT_NOUN.test(t) && !!parseWhen(t, today()); // "I have a meeting with X on Dec 25"
}

/** "I have a meeting", "ho una call col fornitore": the user's own plan, even without a date yet (the bot asks for it). */
export function mentionsOwnEvent(text: string): boolean {
  const t = text.trim();
  return !!t && t.length <= 300 && OWN_EVENT.test(t) && EVENT_NOUN.test(t);
}

// ── dates ──
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, gennaio: 1, feb: 2, february: 2, febbraio: 2, mar: 3, march: 3, marzo: 3, apr: 4, april: 4, aprile: 4,
  may: 5, maggio: 5, jun: 6, june: 6, giugno: 6, jul: 7, july: 7, luglio: 7, aug: 8, august: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, settembre: 9, oct: 10, october: 10, ottobre: 10, nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, dicembre: 12,
};
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, domenica: 0, monday: 1, mon: 1, lunedì: 1, lunedi: 1, tuesday: 2, tue: 2, tues: 2, martedì: 2, martedi: 2,
  wednesday: 3, wed: 3, mercoledì: 3, mercoledi: 3, thursday: 4, thu: 4, thurs: 4, giovedì: 4, giovedi: 4,
  friday: 5, fri: 5, venerdì: 5, venerdi: 5, saturday: 6, sat: 6, sabato: 6,
};
const ZH_WD: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
const pad = (n: number) => String(n).padStart(2, "0");
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
/** A day-month without a year: this year, or next year if it already passed. */
const nextOccurrence = (m: number, d: number, t0: string) => {
  const y = Number(t0.slice(0, 4));
  const ds = `${y}-${pad(m)}-${pad(d)}`;
  return ds >= t0 ? ds : `${y + 1}-${pad(m)}-${pad(d)}`;
};

export type When = { date: string; time: string | null; span: [number, number] };

export function parseWhen(text: string, t0: string = today()): When | null {
  const s = text.toLowerCase();
  const time = parseTime(s);
  const hit = (date: string | null, m: RegExpMatchArray | null): When | null => (date && m ? { date, time, span: [m.index!, m.index! + m[0].length] } : null);
  let m: RegExpMatchArray | null;
  // 2026-12-25 · 2026/12/25 · 2026年12月25日
  if ((m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?/)) && valid(+m[1], +m[2], +m[3])) return hit(`${m[1]}-${pad(+m[2])}-${pad(+m[3])}`, m);
  // 12月25日 / 12月25号
  if ((m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)) && valid(2000, +m[1], +m[2])) return hit(nextOccurrence(+m[1], +m[2], t0), m);
  // (on) 25 december (2026) · 25th of December · 25 dicembre
  const monthRe = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  if ((m = s.match(new RegExp(`\\b(?:on |il |the )?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+|di\\s+)?(${monthRe})\\.?(?:\\s*,?\\s*(\\d{4}))?\\b`))) && valid(2000, MONTHS[m[2]], +m[1]))
    return hit(m[3] ? `${m[3]}-${pad(MONTHS[m[2]])}-${pad(+m[1])}` : nextOccurrence(MONTHS[m[2]], +m[1], t0), m);
  // (on) December 25(th) (2026)
  if ((m = s.match(new RegExp(`\\b(?:on )?(${monthRe})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`))) && valid(2000, MONTHS[m[1]], +m[2]))
    return hit(m[3] ? `${m[3]}-${pad(MONTHS[m[1]])}-${pad(+m[2])}` : nextOccurrence(MONTHS[m[1]], +m[2], t0), m);
  // 25/12 · 25/12/2026 (day first, as in Europe and China); 12/25 when the first number can't be a month
  // (a dot only with a year: "4.20" is a price, "25.12.2026" a date)
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b|\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/))) {
    let [d, mo] = [+(m[1] ?? m[4]), +(m[2] ?? m[5])];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    const yy = m[3] ?? m[6];
    const y = yy ? (yy.length === 2 ? 2000 + +yy : +yy) : null;
    if (valid(y ?? 2000, mo, d)) return hit(y ? `${y}-${pad(mo)}-${pad(d)}` : nextOccurrence(mo, d, t0), m);
  }
  // today / tomorrow / day after tomorrow
  if ((m = s.match(/\b(today|oggi)\b|今天/))) return hit(t0, m);
  if ((m = s.match(/\b(day after tomorrow|dopodomani)\b|后天/))) return hit(addDays(t0, 2), m);
  if ((m = s.match(/\b(tomorrow|domani)\b|明天/))) return hit(addDays(t0, 1), m);
  // in 3 days / tra 3 giorni / 3天后
  if ((m = s.match(/\b(?:in|tra|fra)\s+(\d{1,3})\s+(?:days?|giorni)\b|(\d{1,3})\s*天后/))) return hit(addDays(t0, +(m[1] ?? m[2])), m);
  // (next) friday · venerdì (prossimo) · 下周五 / 周五 / 星期五
  const wdRe = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|");
  // plain "Friday" = the coming one; "next Friday" / "venerdì prossimo" / 下周五 = that day in next calendar week
  const coming = (wd: number) => { const d = (wd - weekdayOf(t0) + 7) % 7; return addDays(t0, d === 0 ? 7 : d); };
  const nextWeek = (wd: number) => addDays(addDays(t0, 7 - ((weekdayOf(t0) + 6) % 7)), (wd + 6) % 7); // Monday of next week + offset
  if ((m = s.match(new RegExp(`(?<![a-zà-ù])(?:(next|on|this|questo|il|prossimo)\\s+)?(${wdRe})(?![a-zà-ù])(\\s+(?:prossimo|next week))?`))))
    return hit(m[1] === "next" || m[1] === "prossimo" || m[3] ? nextWeek(WEEKDAYS[m[2]]) : coming(WEEKDAYS[m[2]]), m);
  if ((m = s.match(/(下)?(?:周|星期|礼拜)([一二三四五六日天])/))) return hit(m[1] ? nextWeek(ZH_WD[m[2]]) : coming(ZH_WD[m[2]]), m);
  return null;
}

/** "at 3pm" · "15:00" · "alle 15" · "下午3点" → "15:00" */
export function parseTime(s: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i)) && +m[1] < 24 && +m[2] < 60) return `${pad((+m[1] % 12) + (m[3]?.toLowerCase() === "pm" ? 12 : m[3] ? 0 : Math.floor(+m[1] / 12) * 12))}:${m[2]}`;
  if ((m = s.match(/\b(?:at|alle|ore)\s*(\d{1,2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b/i))) {
    const h = +(m[1] ?? m[3]), ap = (m[2] ?? m[4])?.toLowerCase();
    if (h <= 23) return `${pad(ap === "pm" && h < 12 ? h + 12 : ap === "am" && h === 12 ? 0 : h)}:00`;
  }
  if ((m = s.match(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*点(半)?/))) {
    let h = +m[2];
    if ((m[1] === "下午" || m[1] === "晚上") && h < 12) h += 12;
    return `${pad(h)}:${m[3] ? "30" : "00"}`;
  }
  return null;
}

// ── what ──
const NUM_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", uno: "1", due: "2", tre: "3", quattro: "4", cinque: "5" };
/** "supplier one" / "fornitore 1" → "seller 1", so the alias lookup finds Seller 1. */
const sellerRefs = (t: string) => t.replace(/\b(seller|supplier|vendor|fornitore|venditore)\s+(one|two|three|four|five|uno|due|tre|quattro|cinque|\d)\b/gi, (_, _w, n) => `seller ${NUM_WORDS[n.toLowerCase()] ?? n}`);

export function reminderTitle(text: string, when: When | null): string {
  let t = text;
  if (when) t = t.slice(0, when.span[0]) + " " + t.slice(when.span[1]);
  t = t
    .replace(/[.!?。！？]?\s*(?:can (?:we|you)|could you|please|pls|per favore|puoi)?\s*(?:put|add|save|insert|metti|aggiungi|segna|inserisci)\s+(?:it|this|that|the meeting|lo|la|questo)?\s*(?:in|on|to|nel|nella|al|in)\s+(?:my|the|il|mio|nel)?\s*(?:calendar|calender|agenda|calendario)\b[^.!?。]*/gi, " ")
    .replace(/\b(?:remind me (?:to|about|of)?|ricordami (?:di|che)?|set a reminder (?:to|for)?|reminder:?)\s*/gi, " ")
    .replace(/提醒我|加到日历|放到日历|记一下|日历/g, " ")
    .replace(/^\s*(?:i|we)\s+(?:have|'ve got|got|will have)\s+(?:a|an)?\s*/i, "")
    .replace(/^\s*(?:ho|abbiamo|avrò|avremo)\s+(?:un|una|uno)?\s*/i, "")
    .replace(/\b(?:at|alle|ore)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\b|\b\d{1,2}[:.]\d{2}\b|(?:上午|下午|晚上)?\d{1,2}点半?/gi, " ")
    .replace(/\b(?:on|il|the)\s*$/i, "")
    .replace(/\s+([,.;:!?])/g, "$1").replace(/[\s,.;:]+$/g, "").replace(/^[\s,.;:]+/, "").replace(/\s{2,}/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1, 120) : "Reminder";
}

const KIND: [RegExp, TaskKind][] = [
  [/\b(pay|payment|deposit|rent|wire|transfer|pagare|pagamento|affitto|bonifico)\b|付款|付定金|房租|转账/i, "payment"],
  [/\b(deadline|due|file|submit|scadenza|consegna)\b|截止|申报/i, "deadline"],
  [/\b(meeting|call|appointment|visit|inspection|interview|dinner|lunch|flight|riunione|incontro|appuntamento|chiamata|visita|volo)\b|开会|会议|见面|拜访|验货|面试|航班/i, "appointment"],
];

export type ReminderDraft = { what: string; date: string; time: string | null; kind: TaskKind; via: "rule" | "llm" };

/** Rules first; the model only when no date was found (live providers only). */
export async function readReminder(text: string, t0: string = today()): Promise<ReminderDraft | null> {
  const when = parseWhen(text, t0);
  const kind = KIND.find(([re]) => re.test(text))?.[1] ?? "todo";
  if (when) return { what: withTime(reminderTitle(text, when), when.time), date: when.date, time: when.time, kind, via: "rule" };
  if (provider === "mock") return null;
  const r = await callJSON({
    step: "intent",
    system: `The user (a foreign business person in China) wants something in their calendar. Today is ${t0} (China time). Return the event: what (short title in the user's language, no date words), date (YYYY-MM-DD, null if none is given or implied), time (HH:MM 24h or null).`,
    text, schema: z.object({ what: z.string(), date: z.string().nullable(), time: z.string().nullable() }),
    fallback: () => ({ what: "", date: null, time: null }), timeoutMs: 6000,
  });
  if (!r.data.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.data.date)) return null;
  const time = r.data.time && /^\d{2}:\d{2}$/.test(r.data.time) ? r.data.time : null;
  return { what: withTime(r.data.what.trim() || reminderTitle(text, null), time), date: r.data.date, time, kind, via: "llm" };
}
const withTime = (what: string, time: string | null) => (time && !what.includes(time) ? `${what} at ${time}` : what);

/** Create the task, linked to the counterparty when exactly one is named (and to their only open matter). */
export function saveReminder(db: DB, ws: string, d: ReminderDraft, sourceText: string, messageId: string | null): { taskId: number; entity: string | null } {
  const refs = findEntityRefs(db, ws, sellerRefs(sourceText));
  const entityId = refs.length === 1 ? refs[0] : null;
  const e = entityId ? getEntity(db, entityId) : undefined;
  const matters = entityId ? (db.prepare(`SELECT id FROM matters WHERE entity_id = ? AND status IN ('open','waiting')`).all(entityId) as { id: string }[]) : [];
  let what = d.what.replace(/\b(seller|supplier|fornitore)\s+(one|two|three|four|five|uno|due|tre|\d)\b/i, (x) => (e ? entityLabel(e) : x));
  if (e && !what.includes(e.display_name) && !what.includes(e.label)) what = `${what} – ${entityLabel(e)}`;
  const taskId = addTask(db, { workspaceId: ws, entityId, matterId: matters.length === 1 ? matters[0].id : null, messageId }, { kind: d.kind, who: "me", what, due: d.date })!;
  return { taskId, entity: e ? entityLabel(e) : null };
}
