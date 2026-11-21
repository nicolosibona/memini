// Phone calendar, supplier confirmation links, copy-ready Chinese, Email-to-Memini, additive migrations.
// Mock mode (no AI), through the same core entry point as WeChat.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LLM_PROVIDER = "mock";
process.env.MOCK_DELAY_MS = "0";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memini-feat-"));
process.env.APP_BASE_URL = "https://memini.test";

const { openDb, DEMO_USER, DEMO_WORKSPACE } = await import("@/lib/db");
const { handleIncoming, storeFile } = await import("@/lib/core/ingest");
const { resetDemo } = await import("@/lib/demo/seed");
const { DEMO_TEXTS } = await import("@/data/demo/fixtures");
const { openAlerts, runAudit } = await import("@/lib/core/audit");
const { listMatters } = await import("@/lib/core/matters");
const { listEntities } = await import("@/lib/core/entities");
const { buildIcs, icsFold, icsEscape, alarmsFor, feedTasks } = await import("@/lib/core/calendar");
const { userToken, rotateToken, resolveToken } = await import("@/lib/core/tokens");
const confirm = await import("@/lib/core/confirm");
const { chineseDraftIn } = await import("@/lib/core/reply");
const { parseEmail, forwardedFrom, tokenIn, companyDomain } = await import("@/lib/core/email");
const { authorize, deliverRaw } = await import("@/lib/channels/email");

type Item = Parameters<typeof handleIncoming>[0]["items"][number];
const demoFile = (name: string) => storeFile(name, fs.readFileSync(path.join("data/demo", name)));

// ── calendar ──
describe("live calendar (.ics)", () => {
  const task = (o: Partial<Parameters<typeof buildIcs>[0][number]>) => ({ id: 1, kind: "renewal" as const, who: "me" as const, what: "Renew passport", due_at: "2026-12-15", status: "open" as const, matter_id: null, entity_id: null, created_at: "", ...o });

  it("escapes text and folds long lines at 75 octets without splitting a Chinese character", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = icsFold(`SUMMARY:${"深圳市ABC科技有限公司".repeat(6)}`);
    for (const line of folded.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(`SUMMARY:${"深圳市ABC科技有限公司".repeat(6)}`);
  });

  it("all-day events with reminders per kind; done tasks without reminders; cancelled ones left out", () => {
    const ics = buildIcs([
      task({ id: 1 }),
      task({ id: 2, kind: "promise", who: "counterparty", what: "Send the sample", entity_name: "Shenzhen ABC Tech", due_at: "2026-12-01" }),
      task({ id: 3, status: "done", what: "Pay rent", kind: "payment", due_at: "2026-12-02" }),
      task({ id: 4, status: "cancelled", what: "Gone" }),
    ], { now: "2026-11-21T00:00:00.000Z", host: "memini.test" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261215\r\nDTEND;VALUE=DATE:20261216");
    expect(ics).toContain("UID:task-1@memini.test");
    expect(ics).toContain("TRIGGER:-P6DT15H"); // 09:00 one week before
    expect(ics).toContain("SUMMARY:👀 Shenzhen ABC Tech: Send the sample");
    expect(ics).toContain("SUMMARY:✓ 💳 Pay rent");
    expect(ics).not.toContain("Gone");
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
    const doneEvent = ics.slice(ics.indexOf("UID:task-3"), ics.indexOf("END:VEVENT", ics.indexOf("UID:task-3")));
    expect(doneEvent).not.toContain("VALARM");
    expect(alarmsFor({ kind: "payment", who: "me" }).map((a) => a.trigger)).toEqual(["-P1DT15H", "PT9H"]);
  });

  it("feed from the demo workspace links each event to its matter; the token can be reset", async () => {
    const db = openDb(":memory:");
    await resetDemo(db, { profile: "china_business" });
    const tasks = feedTasks(db, DEMO_WORKSPACE);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.find((t) => t.matter_id)?.link).toMatch(/^https:\/\/memini\.test\/s\//);
    const t1 = userToken(db, DEMO_USER, "calendar");
    expect(userToken(db, DEMO_USER, "calendar")).toBe(t1); // stable: a subscribed phone keeps working
    expect(resolveToken(db, t1, "calendar")?.user_id).toBe(DEMO_USER);
    const t2 = rotateToken(db, DEMO_USER, "calendar");
    expect(resolveToken(db, t1, "calendar")).toBeNull();
    expect(resolveToken(db, t2, "calendar")).not.toBeNull();
    expect(resolveToken(db, t2, "email")).toBeNull(); // a calendar token is not an email token
  });
});

describe("dates from WeChat → iPhone calendar", async () => {
  const { calendarSubscribed } = await import("@/lib/core/tokens");
  const db = openDb(":memory:");
  await resetDemo(db, { profile: "sourcing" });
  const send = (items: Item[]) => handleIncoming({ userId: DEMO_USER, channel: "sim", items }, db);
  const s1 = listEntities(db, DEMO_WORKSPACE).find((e) => e.display_name === "Shenzhen ABC Tech")!.id;
  const fileDated = async () => {
    const [r] = await send([{ kind: "text", text: DEMO_TEXTS.lisa }]);
    return r.buttons?.some((b) => b.id.startsWith("ent:")) ? (await send([{ kind: "text", menuId: `ent:${s1}` }]))[0] : r;
  };

  it("not subscribed: a forward with a date offers 📅, and the tap gives the one-time Safari steps", async () => {
    expect(calendarSubscribed(db, DEMO_USER)).toBe(false);
    const r = await fileDated();
    const b = r.buttons!.find((x) => x.id === "cal:add")!;
    expect(b.label).toBe("📅 Add to iPhone calendar");
    const [steps] = await send([{ kind: "text", menuId: b.id }]);
    expect(steps.text).toMatch(/https:\/\/memini\.test\/cal\/[a-z0-9]+/);
    expect(steps.text).toContain("Open in Safari");
  });

  it("viewing the page is not subscribing; a calendar app fetching the feed is", () => {
    const token = userToken(db, DEMO_USER, "calendar");
    resolveToken(db, token, "calendar", { touch: false });
    expect(calendarSubscribed(db, DEMO_USER)).toBe(false);
    resolveToken(db, token, "calendar"); // the feed route
    expect(calendarSubscribed(db, DEMO_USER)).toBe(true);
    expect(calendarSubscribed(db, DEMO_USER, Date.now() + 4 * 86400_000)).toBe(false); // silent for days → not any more
  });

  it("subscribed: no button, the reply says the date is already in the calendar", async () => {
    const r = await fileDated();
    expect(r.buttons!.some((x) => x.id === "cal:add")).toBe(false);
    expect(r.text).toContain("📅 Already in your iPhone calendar");
    const [again] = await send([{ kind: "text", text: "/calendar" }]);
    expect(again.text).toContain("already subscribed");
  });
});

// ── supplier confirmation link + Chinese bubbles ──
describe("confirmation link for the supplier", async () => {
  const db = openDb(":memory:");
  await resetDemo(db, { profile: "sourcing" });
  const send = (items: Item[]) => handleIncoming({ userId: DEMO_USER, channel: "sim", items }, db);
  const s1 = listEntities(db, DEMO_WORKSPACE).find((e) => e.display_name === "Shenzhen ABC Tech")!.id;
  const purchase = () => listMatters(db, DEMO_WORKSPACE, { entityId: s1 })[0];
  await send([{ kind: "text", text: DEMO_TEXTS.lisa }]);
  await send([{ kind: "text", menuId: `ent:${s1}` }]);
  await send([{ kind: "file", filePath: demoFile("abc_business_license.html") }, { kind: "file", filePath: demoFile("abc_proforma_PI-2026-118.html") }]);

  it("term choices: when the PI says EXW but the chat said FOB, the chat value goes on the page by default", () => {
    const inco = confirm.termChoices(db, purchase().id).find((c) => c.key === "incoterm")!;
    expect(inco.options.map((o) => o.value_en).sort()).toEqual(["EXW", "FOB"]);
    expect(inco.options.find((o) => o.fact_id === inco.default_fact_id)!.value_en).toBe("FOB");
  });

  let token = "";
  it("creates a link with a Chinese snapshot and a ready WeChat message", () => {
    const r = confirm.createConfirmLink(db, { userId: DEMO_USER, matterId: purchase().id, contactName: "Lisa" });
    token = r.link.token;
    expect(r.url).toBe(`https://memini.test/c/${token}`);
    expect(r.snapshot.terms.find((t) => t.key === "unit_price")!.value_zh).toBe("4.20 美元");
    expect(r.snapshot.terms.find((t) => t.key === "incoterm")!.value_zh).toBe("FOB");
    expect(r.message_zh).toMatch(/^Lisa您好，麻烦您打开下面的链接，核对并确认一下订单条款/);
    expect(r.message_zh).toContain(r.url);
    expect(r.link.terms_hash).toBe(confirm.snapshotHash(r.snapshot));
    // the page never carries Memini's own checks
    expect(r.link.terms_json).not.toMatch(/RED FLAG|Payee .* is NOT|alert/i);
  });

  it("a question-like change request from the supplier is still filed as their content, under the right matter", async () => {
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM pending_groups WHERE status = 'open'`).get() as { n: number }).n;
    const [r] = await handleIncoming({ userId: DEMO_USER, channel: "supplier_link", items: [{ kind: "text", text: "单价能不能改成4.5美元？" }], entityId: s1, matterId: purchase().id }, db);
    expect(r.text).toContain("Filed under: Seller 1");
    expect((db.prepare(`SELECT COUNT(*) AS n FROM pending_groups WHERE status = 'open'`).get() as { n: number }).n).toBe(before); // no menu asked
    confirm.recordChangeRequest(db, token, { note: "单价能不能改成4.5美元？", messageId: null });
    expect(confirm.getLink(db, token)!.status).toBe("changes_requested");
  });

  it("✅ confirm: terms become agreed, stored as their statement; the record is immutable", async () => {
    const r = confirm.confirmTerms(db, token, { ip: "1.2.3.4", ua: "MicroMessenger" });
    expect(r.ok).toBe(true);
    expect(confirm.getLink(db, token)!.status).toBe("confirmed");
    const agreed = db.prepare(`SELECT key, said_by, value_json FROM facts WHERE matter_id = ? AND status = 'agreed' ORDER BY key`).all(purchase().id) as { key: string; said_by: string; value_json: string }[];
    expect(agreed.map((f) => f.key)).toEqual(expect.arrayContaining(["incoterm", "unit_price"]));
    expect(agreed.every((f) => f.said_by === "counterparty")).toBe(true);
    expect(confirm.confirmTerms(db, token)).toMatchObject({ ok: true, already: true });
    expect(() => db.prepare(`UPDATE confirmations SET note = 'x'`).run()).toThrow(/immutable/);
    expect(() => db.prepare(`DELETE FROM confirmations`).run()).toThrow(/immutable/);
    // the PI still says EXW: its red flag stays until a corrected PI arrives
    await runAudit(db, DEMO_WORKSPACE);
    expect(openAlerts(db, { matterId: purchase().id }).map((a) => a.code)).toContain("INCOTERM_CHANGED");
  });

  it("a new price after the confirmation raises TERMS_CHANGED_AFTER_CONFIRMATION", async () => {
    await handleIncoming({ userId: DEMO_USER, channel: "supplier_link", items: [{ kind: "text", text: "亲，单价调整为4.5美元，FOB深圳不变。" }], entityId: s1, matterId: purchase().id }, db);
    const a = openAlerts(db, { matterId: purchase().id }).find((x) => x.code === "TERMS_CHANGED_AFTER_CONFIRMATION");
    expect(a?.title).toMatch(/unit price USD 4\.20 → USD 4\.50/);
  });

  it("uploads through the link land in the matter; expired links refuse", async () => {
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE matter_id = ?`).get(purchase().id) as { n: number }).n;
    await handleIncoming({ userId: DEMO_USER, channel: "supplier_link", items: [{ kind: "file", filePath: demoFile("abc_ce_certificate.html") }], entityId: s1, matterId: purchase().id }, db);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE matter_id = ?`).get(purchase().id) as { n: number }).n).toBe(before + 1);
    const l2 = confirm.createConfirmLink(db, { userId: DEMO_USER, matterId: purchase().id });
    db.prepare(`UPDATE share_links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token = ?`).run(l2.link.token);
    expect(confirm.confirmTerms(db, l2.link.token)).toEqual({ ok: false, error: "expired" });
    confirm.revokeLink(db, DEMO_WORKSPACE, l2.link.token);
    expect(confirm.isExpired(confirm.getLink(db, l2.link.token)!)).toBe(true);
  });

  it("WeChat: /link answers with the summary, then the Chinese message alone (forwardable)", async () => {
    let replies = await send([{ kind: "text", text: "/link" }]);
    if (replies[0].text.startsWith("Which one")) { // Seller 1 and Seller 2 both have an open charger purchase → it asks
      const b = replies[0].buttons!.find((x) => x.id === `lnk:m:${purchase().id}`)!;
      replies = await send([{ kind: "text", menuId: b.id }]);
    }
    const zh = replies.at(-1)!;
    expect(replies[0].text).toContain("Confirmation page for");
    expect(zh.text).toMatch(/^Lisa您好|^您好/);
    expect(zh.text).toMatch(/https:\/\/memini\.test\/c\/[a-z0-9]+$/);
    expect(zh.buttons).toBeUndefined(); // the bubble itself is the clean text
    expect(zh.copy?.text).toBe(zh.text);
  });

  it("📋 tap returns only the Chinese draft of an analysis", async () => {
    const [r] = await send([{ kind: "text", text: "亲，样品周五前寄出。" }]);
    const menu = r.buttons?.find((b) => b.id.startsWith("ent:")) ? (await send([{ kind: "text", menuId: `ent:${s1}` }]))[0] : r;
    const zhBtn = menu.buttons!.find((b) => b.id.startsWith("zh:"))!;
    const [bubble] = await send([{ kind: "text", menuId: zhBtn.id }]);
    expect(bubble.text).toBe(menu.copy!.text);
    expect(bubble.text).toMatch(/[一-鿿]/);
    expect(bubble.text).not.toMatch(/Filed under|RED FLAG/);
  });

  it("finds the Chinese draft inside an assistant answer, ignoring names in English sentences", () => {
    expect(chineseDraftIn("Here is a draft:\n\n王经理您好，PI上的贸易条款写的是EXW，麻烦修改一下，谢谢！\n\nSend it when ready.")).toBe("王经理您好，PI上的贸易条款写的是EXW，麻烦修改一下，谢谢！");
    expect(chineseDraftIn("Payee (深圳市鑫达贸易有限公司) is NOT the company on the license.")).toBeNull();
  });
});

// ── email ──
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/.{76}/g, "$&\r\n");
function rawEmail(o: { from: string; to: string; subject: string; body: string; attach?: { name: string; type: string; data: Buffer; inline?: boolean }[]; auth?: string; id?: string }) {
  const B = "XXBOUNDARYXX";
  const parts = [
    `--${B}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(o.body)}\r\n`,
    ...(o.attach ?? []).map((a) => `--${B}\r\nContent-Type: ${a.type}; name="${a.name}"\r\nContent-Disposition: ${a.inline ? "inline" : "attachment"}; filename="${a.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(a.data)}\r\n`),
  ];
  return [
    `From: ${o.from}`, `To: ${o.to}`, `Subject: ${o.subject}`, `Date: Fri, 20 Nov 2026 10:00:00 +0800`, `Message-ID: <${o.id ?? "m1"}@mail.test>`,
    ...(o.auth ? [`Authentication-Results: mx.google.com; ${o.auth}`] : []),
    `MIME-Version: 1.0`, `Content-Type: multipart/mixed; boundary="${B}"`, ``, ...parts, `--${B}--`, ``,
  ].join("\r\n");
}

describe("Email to Memini", async () => {
  const db = openDb(":memory:");
  await resetDemo(db, { profile: "sourcing" });
  const token = userToken(db, DEMO_USER, "email");
  const pi = fs.readFileSync("data/demo/abc_proforma_PI-2026-118.html");
  const forwarded = rawEmail({
    from: "Alex <alex@nordlys.test>", to: `memini.inbox+${token}@gmail.com`, subject: "Fwd: PI-2026-118", auth: "spf=pass dkim=pass",
    body: "FYI see the PI\n\n---------- Forwarded message ---------\nFrom: Lisa Wang <lisa@abc-tech.cn>\nDate: Thu, 19 Nov 2026 at 15:12\nSubject: PI-2026-118\n\n王总您好，附件是PI，请查收。",
    attach: [
      { name: "abc_proforma_PI-2026-118.html", type: "text/html", data: pi },
      { name: "logo.png", type: "image/png", data: Buffer.alloc(800, 1), inline: true },
      { name: "invite.ics", type: "text/calendar", data: Buffer.from("BEGIN:VCALENDAR") },
    ],
  });

  it("parses a forwarded email: original sender, attachments kept and skipped", async () => {
    const m = await parseEmail(forwarded);
    expect(m.forwarded).toMatchObject({ name: "Lisa Wang", email: "lisa@abc-tech.cn" });
    expect(m.attachments.map((a) => a.filename)).toEqual(["abc_proforma_PI-2026-118.html"]);
    expect(m.skipped).toEqual(expect.arrayContaining(["logo.png", "invite.ics"]));
    expect(m.authPass).toBe(true);
    expect(tokenIn(m.to)).toBe(token);
    expect(companyDomain("lisa@abc-tech.cn")).toBe("abc-tech.cn");
    expect(companyDomain("lisa@qq.com")).toBeNull();
    expect(forwardedFrom("发件人: 王丽 <wang@xyz.cn>\n发送时间: 2026年11月19日\n主题: 报价")?.email).toBe("wang@xyz.cn");
  });

  it("who may send: the token in the address, or an allowed sender that passed SPF/DKIM", () => {
    process.env.EMAIL_ALLOWED_SENDERS = "alex@nordlys.test";
    expect(authorize(db, { from: "spam@x.com", to: [`a+${token}@gmail.com`], authPass: null }, { via: "imap" })).toEqual({ userId: DEMO_USER });
    expect(authorize(db, { from: "alex@nordlys.test", to: ["a@gmail.com"], authPass: true }, { via: "imap" })).toEqual({ userId: DEMO_USER });
    expect(authorize(db, { from: "alex@nordlys.test", to: ["a@gmail.com"], authPass: false }, { via: "imap" })).toHaveProperty("reason"); // spoofed
    expect(authorize(db, { from: "spam@x.com", to: ["a@gmail.com"], authPass: true }, { via: "imap" })).toHaveProperty("reason");
    expect(authorize(db, { from: "x@y.z", to: [], authPass: null }, { via: "webhook", token: "nottherighttoken000" })).toHaveProperty("reason");
  });

  it("delivers body + PI as one group: the PI is filed under Seller 1 and checked against the chat", async () => {
    const r = await deliverRaw(forwarded, { via: "imap" }, db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replies.map((x) => x.text).join("\n")).toMatch(/Filed under: Seller 1|Who is this from/);
    const doc = db.prepare(`SELECT d.doc_type, m.channel FROM documents d JOIN messages m ON m.id = d.message_id WHERE d.title LIKE '%PI-2026-118%' ORDER BY d.created_at DESC LIMIT 1`).get() as { doc_type: string; channel: string };
    expect(doc).toEqual({ doc_type: "proforma_invoice", channel: "email" });
    // the same email again (IMAP retry) is not processed twice
    const again = await deliverRaw(forwarded, { via: "imap" }, db);
    expect(again.ok && again.replies.length).toBe(0);
  });

  it("refuses an email without the token from an unknown sender", async () => {
    const r = await deliverRaw(rawEmail({ from: "x@spam.test", to: "memini.inbox@gmail.com", subject: "hi", body: "buy now", id: "m2" }), { via: "imap" }, db);
    expect(r).toMatchObject({ ok: false });
  });
});

// ── migrations ──
describe("database migrations are additive", () => {
  it("opening a version-2 database keeps its data and adds the new tables", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "memini-db-")), "m.db");
    const v2 = openDb(file);
    v2.prepare(`INSERT INTO entities (id, workspace_id, kind, label, display_name) VALUES ('e1', ?, 'supplier', 'S', 'Kept Co')`).run(DEMO_WORKSPACE);
    v2.exec(`DROP TABLE share_links; DROP TABLE confirmations; DROP TABLE inbound_tokens; PRAGMA user_version = 2;`); // simulate the live server before this release
    v2.close();
    const db = openDb(file);
    expect((db.prepare(`SELECT display_name FROM entities WHERE id = 'e1'`).get() as { display_name: string }).display_name).toBe("Kept Co");
    expect(db.pragma("user_version", { simple: true })).toBe(3);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name IN ('share_links','confirmations','inbound_tokens') ORDER BY name`).all()).toHaveLength(3);
    db.close();
  });
});
