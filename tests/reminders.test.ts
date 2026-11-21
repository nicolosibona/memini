// The user's own appointments from WeChat → a task → the phone calendar. The exact messages from the live log first.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LLM_PROVIDER = "mock";
process.env.MOCK_DELAY_MS = "0";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memini-rem-"));

const { openDb, DEMO_USER, DEMO_WORKSPACE } = await import("@/lib/db");
const { handleIncoming } = await import("@/lib/core/ingest");
const { resetDemo } = await import("@/lib/demo/seed");
const { isCalendarRequest, parseWhen, parseTime, reminderTitle } = await import("@/lib/core/reminders");

const SAT = "2026-11-21"; // a Saturday

describe("is it a calendar request?", () => {
  it.each([
    ["i have a meeting with supplier 1 on 25 december. put it in the calendar", true],
    ["i have a meeting with seller one on 15 december", true],
    ["can we put the meeting on my calendar?", true],
    ["ricordami di pagare l'affitto venerdì", true],
    ["Ho una riunione con il fornitore 1 il 3 dicembre alle 15", true],
    ["提醒我周五付定金", true],
    ["you have calendar tool", false],
    ["what's in my calendar?", false],
    ["What did Seller 2 quote?", false],
    ["老板您好，USB-C充电线每条1.35美元，FOB深圳。下周三前确认的话可以安排生产。", false],
  ])("%s → %s", (text, yes) => expect(isCalendarRequest(text)).toBe(yes));
});

describe("dates and times", () => {
  it.each([
    ["meeting on 25 december", "2026-12-25"],
    ["december 25th at 3pm", "2026-12-25"],
    ["il 3 marzo", "2027-03-03"], // already past this year → next year
    ["on 15/12", "2026-12-15"],
    ["25.12.2026", "2026-12-25"],
    ["2027-01-10", "2027-01-10"],
    ["12月25日下午3点", "2026-12-25"],
    ["tomorrow", "2026-11-22"],
    ["domani", "2026-11-22"],
    ["in 3 days", "2026-11-24"],
    ["venerdì", "2026-11-27"],
    ["on Friday", "2026-11-27"],
    ["next friday", "2026-11-27"], // said on Saturday: Friday of next week
    ["next monday", "2026-11-23"],
    ["周五", "2026-11-27"],
    ["下周二", "2026-11-24"],
  ])("%s → %s", (text, date) => expect(parseWhen(text, SAT)?.date).toBe(date));

  it("a price is not a date", () => {
    expect(parseWhen("4.20 va bene ma solo FOB Shenzhen", SAT)).toBeNull();
    expect(parseWhen("30% deposit", SAT)).toBeNull();
  });

  it("times", () => {
    expect(parseTime("at 3pm")).toBe("15:00");
    expect(parseTime("alle 15")).toBe("15:00");
    expect(parseTime("15:30")).toBe("15:30");
    expect(parseTime("下午3点半")).toBe("15:30");
    expect(parseTime("no time here")).toBeNull();
  });

  it("titles without the date or the calendar instruction", () => {
    const t = "i have a meeting with supplier 1 on 25 december. put it in the calendar";
    expect(reminderTitle(t, parseWhen(t, SAT))).toBe("Meeting with supplier 1");
    const r = "remind me to pay the deposit on friday";
    expect(reminderTitle(r, parseWhen(r, SAT))).toBe("Pay the deposit");
  });
});

describe("from WeChat to the calendar", async () => {
  const db = openDb(":memory:");
  await resetDemo(db, { profile: "sourcing" });
  const send = (text: string) => handleIncoming({ userId: DEMO_USER, channel: "wecom", items: [{ kind: "text", text }] }, db);
  const open = () => db.prepare(`SELECT id, what, due_at, kind, entity_id, status FROM tasks WHERE workspace_id = ? AND status = 'open' AND who = 'me' AND kind = 'appointment'`).all(DEMO_WORKSPACE) as { id: number; what: string; due_at: string; entity_id: string | null }[];

  it("the message from the log: added, linked to Seller 1, with the exact date and an Undo", async () => {
    const [r] = await send("i have a meeting with supplier 1 on 25 december. put it in the calendar");
    expect(r.text).toMatch(/📅 Added: Meeting with Seller 1 – Shenzhen ABC Tech/);
    expect(r.text).toMatch(/Dec 25, 20\d\d/);
    expect(r.buttons!.map((b) => b.label)).toEqual(["📅 Add to iPhone calendar", "↩️ Undo"]);
    const [t] = open();
    expect(t.due_at).toMatch(/-12-25$/);
    expect(t.entity_id).not.toBeNull();
    const [undo] = await send_menu(r.buttons!.find((b) => b.id.startsWith("tdel:"))!.id);
    expect(undo.text).toContain("Removed");
    expect(open()).toHaveLength(0);
  });

  it("a statement with a date is added; the follow-up 'put it in my calendar' doesn't add it twice", async () => {
    const [r] = await send("i have a meeting with seller one on 15 december");
    expect(r.text).toContain("📅 Added: Meeting with Seller 1");
    const [again] = await send("can we put the meeting on my calendar?");
    expect(again.text).toContain("Already added");
    expect(open()).toHaveLength(1);
  });

  it("a request without any date asks for one; a question about the calendar goes to the assistant", async () => {
    db.prepare(`UPDATE messages SET received_at = '2000-01-01T00:00:00.000Z'`).run(); // nothing recent to take a date from
    const [r] = await send("please add the inspection to my calendar");
    expect(r.text).toContain("Which day?");
    const [q] = await send("what's in my calendar?");
    expect(q.text).not.toContain("Added");
  });

  async function send_menu(menuId: string) { return handleIncoming({ userId: DEMO_USER, channel: "wecom", items: [{ kind: "text", text: "", menuId }] }, db); }
});
