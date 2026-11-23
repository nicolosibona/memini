// 微信客服 via WeCom (blueprint §6, §13.4): access_token cache, sync_msg pull, media download,
// 6 s debounce per user, send_msg (text / msgmenu) with the send budget (§6.2).
import "server-only";
import { getDb, DEMO_USER, nowIso, type DB } from "@/lib/db";
import { handleIncoming, storeFile, type IncomingItem, type OutgoingReply } from "@/lib/core/ingest";

const API = "https://qyapi.weixin.qq.com/cgi-bin";
const DEBOUNCE_MS = Number(process.env.WECOM_DEBOUNCE_MS ?? 6000);
const SEND_BUDGET = Number(process.env.WECOM_SEND_BUDGET ?? 5); // [VERIFY] §17.4: ~5 messages / 48 h
const MENU_HEAD_MAX = Number(process.env.WECOM_MENU_HEAD_MAX ?? 900); // [VERIFY] §17.3
const TEXT_MAX_BYTES = 1800;

const state = {
  get: (db: DB, k: string) => (db.prepare(`SELECT v FROM wecom_state WHERE k = ?`).get(k) as { v: string } | undefined)?.v ?? null,
  set: (db: DB, k: string, v: string) => db.prepare(`INSERT OR REPLACE INTO wecom_state (k, v) VALUES (?, ?)`).run(k, v),
};

class WecomError extends Error {
  constructor(public errcode: number, msg: string) {
    super(`${errcode} ${msg}${HINTS[errcode] ? ` — ${HINTS[errcode]}` : ""}`);
  }
}
const HINTS: Record<number, string> = {
  60020: "server IP is not in the app's trusted IPs (企业可信IP), see blueprint §13.2",
  95027: "customer-service account limit reached (unverified WeCom account)",
  95018: "send budget exhausted for this customer (48 h / 5 messages)",
  42001: "access_token expired",
};

// ── access_token (valid ~2 h, refreshed 5 min early) ──
export async function accessToken(db: DB = getDb()): Promise<string> {
  const cached = state.get(db, "access_token");
  const exp = Number(state.get(db, "access_token_exp") ?? 0);
  if (cached && Date.now() < exp) return cached;
  const res = await fetch(`${API}/gettoken?corpid=${encodeURIComponent(process.env.WECOM_CORP_ID!)}&corpsecret=${encodeURIComponent(process.env.WECOM_APP_SECRET!)}`);
  const j = (await res.json()) as { errcode: number; errmsg: string; access_token: string; expires_in: number };
  if (j.errcode) throw new WecomError(j.errcode, j.errmsg);
  state.set(db, "access_token", j.access_token);
  state.set(db, "access_token_exp", String(Date.now() + (j.expires_in - 300) * 1000));
  return j.access_token;
}

async function post<T>(path: string, body: unknown, db: DB = getDb()): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${API}${path}?access_token=${await accessToken(db)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json()) as T & { errcode: number; errmsg: string };
    if (j.errcode === 42001 || j.errcode === 40014) { state.set(db, "access_token_exp", "0"); continue; }
    if (j.errcode) throw new WecomError(j.errcode, j.errmsg);
    return j;
  }
  throw new Error("access_token refresh failed");
}

/** Temporary media (3 days) for a file message: the verification sheet. */
async function uploadFile(db: DB, filePath: string, name: string): Promise<string> {
  const fs = await import("node:fs");
  for (let attempt = 0; attempt < 2; attempt++) {
    const form = new FormData();
    form.append("media", new Blob([fs.readFileSync(filePath)]), name);
    const res = await fetch(`${API}/media/upload?access_token=${await accessToken(db)}&type=file`, { method: "POST", body: form });
    const j = (await res.json()) as { errcode?: number; errmsg?: string; media_id?: string };
    if (j.errcode === 42001 || j.errcode === 40014) { state.set(db, "access_token_exp", "0"); continue; }
    if (j.errcode || !j.media_id) throw new WecomError(j.errcode ?? -1, j.errmsg ?? "upload failed");
    return j.media_id;
  }
  throw new Error("access_token refresh failed");
}

/** A file payload is kept as a local path until it is sent (held payloads too): upload right before sending. */
async function materialize(db: DB, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const local = payload.local_file as { path: string; name: string } | undefined;
  if (!local) return payload;
  return { msgtype: "file", file: { media_id: await uploadFile(db, local.path, local.name) } };
}

/** msg_send_fail.fail_type (WeCom kf docs) */
const SEND_FAIL: Record<number, string> = {
  0: "unknown", 1: "customer-service account deleted", 2: "app closed", 4: "session expired", 5: "session closed", 6: "over the 5-message limit",
  8: "company not verified", 10: "user refused messages", 11: "no member logged in to the WeCom app", 12: "message type not allowed", 13: "account limit",
};

// ── pulling messages ──
type KfMsg = {
  msgid: string; open_kfid?: string; external_userid?: string; send_time: number; origin: number; msgtype: string;
  text?: { content: string; menu_id?: string };
  image?: { media_id: string }; voice?: { media_id: string }; file?: { media_id: string };
  merged_msg?: { title: string; item: { send_time: number; msgtype: string; sender_name: string; msg_content: string }[] };
  event?: { event_type: string; open_kfid?: string; external_userid?: string; scene?: string; scene_param?: string; welcome_code?: string; fail_msgid?: string; fail_type?: number };
};

let syncing: Promise<void> | null = null;
/** Called (in the background) after each kf_msg_or_event callback. Serialized: one pull at a time. */
export function onCallbackEvent(token: string, openKfId: string) {
  const run = async () => {
    const db = getDb();
    let cursor = state.get(db, "sync_cursor") ?? "";
    for (let more = true; more; ) {
      const r = await post<{ next_cursor: string; has_more: number; msg_list: KfMsg[] }>("/kf/sync_msg", { cursor, token, limit: 1000, open_kfid: openKfId }, db);
      cursor = r.next_cursor;
      state.set(db, "sync_cursor", cursor);
      more = r.has_more === 1;
      if (r.msg_list.length) console.log(`[wecom] sync_msg: ${r.msg_list.length} item(s) [${r.msg_list.map((m) => `${m.msgtype}/${m.origin}`).join(",")}]`);
      for (const m of r.msg_list) await enqueue(db, m, openKfId).catch((e) => console.error("[wecom] message failed:", e));
    }
  };
  syncing = (syncing ?? Promise.resolve()).then(run).catch((e) => console.error("[wecom] sync failed:", e));
  return syncing;
}

async function download(db: DB, mediaId: string, fallbackName: string): Promise<string> {
  // media ids expire after a few days → download right away (§13.4)
  const res = await fetch(`${API}/media/get?access_token=${await accessToken(db)}&media_id=${encodeURIComponent(mediaId)}`);
  if ((res.headers.get("content-type") ?? "").includes("json")) {
    const j = (await res.json()) as { errcode: number; errmsg: string };
    throw new WecomError(j.errcode, j.errmsg);
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const name = decodeURIComponent(cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? fallbackName);
  return storeFile(name, Buffer.from(await res.arrayBuffer()));
}

/** QR linking (§6.3): the one-time scene (or the 6-digit fallback code) binds this WeChat user to a web account. */
function bindLink(db: DB, ext: string, match: (k: string, v: { user: string; code: string; exp: number }) => boolean): boolean {
  const rows = db.prepare(`SELECT k, v FROM wecom_state WHERE k LIKE 'link:%'`).all() as { k: string; v: string }[];
  for (const r of rows) {
    const v = JSON.parse(r.v) as { user: string; code: string; exp: number };
    if (Date.now() > v.exp || !match(r.k, v)) continue;
    db.prepare(`UPDATE users SET wecom_external_userid = NULL WHERE wecom_external_userid = ?`).run(ext);
    db.prepare(`UPDATE users SET wecom_external_userid = ? WHERE id = ?`).run(ext, v.user);
    db.prepare(`DELETE FROM wecom_state WHERE k = ?`).run(r.k);
    return true;
  }
  return false;
}

function userFor(db: DB, externalUserId: string): string {
  const u = db.prepare(`SELECT id FROM users WHERE wecom_external_userid = ?`).get(externalUserId) as { id: string } | undefined;
  if (u) return u.id;
  // D11 hackathon shortcut: everybody who writes is the single demo user (QR linking: §6.3, later)
  db.prepare(`UPDATE users SET wecom_external_userid = COALESCE(wecom_external_userid, ?) WHERE id = ?`).run(externalUserId, DEMO_USER);
  return DEMO_USER;
}

async function toItems(db: DB, m: KfMsg): Promise<IncomingItem[] | null> {
  const base = { externalMsgId: m.msgid, receivedAt: new Date(m.send_time * 1000).toISOString() };
  switch (m.msgtype) {
    case "text": return [{ ...base, kind: "text", text: m.text!.content, menuId: m.text!.menu_id || undefined }];
    case "image": return [{ ...base, kind: "image", filePath: await download(db, m.image!.media_id, `${m.msgid}.jpg`) }];
    case "file": return [{ ...base, kind: "file", filePath: await download(db, m.file!.media_id, `${m.msgid}.bin`) }];
    case "voice": return [{ ...base, kind: "voice", filePath: await download(db, m.voice!.media_id, `${m.msgid}.amr`) }];
    case "merged_msg": {
      // [VERIFY] §17.5: whether media inside a merged forward can be downloaded; we keep the text items.
      return m.merged_msg!.item.flatMap((it, i): IncomingItem[] => {
        let content: { content?: string } = {};
        try { content = JSON.parse(it.msg_content); } catch { /* not JSON */ }
        const text = it.msgtype === "text" ? content.content : it.msgtype === "voice" ? "[语音]" : null;
        return text ? [{ kind: "merged", text, originalAuthor: it.sender_name, chatTitle: m.merged_msg!.title, externalMsgId: `${m.msgid}#${i}`, receivedAt: new Date(it.send_time * 1000).toISOString() }] : [];
      });
    }
    case "event":
      // send_msg returning ok doesn't mean delivered: WeChat reports a failed delivery later as this event
      if (m.event?.event_type === "msg_send_fail") console.error(`[wecom] delivery failed: msgid=${m.event.fail_msgid} fail_type=${m.event.fail_type} (${SEND_FAIL[m.event.fail_type ?? 0] ?? "unknown"})`);
      return m.event?.event_type === "enter_session" ? [{ ...base, kind: "event", event: "enter_session" }] : [];
    default: return null; // unsupported type
  }
}

// ── 6 s debounce per user → one group → one reply (§5.7) ──
const buffers = new Map<string, { items: IncomingItem[]; timer: NodeJS.Timeout; openKfId: string }>();

async function enqueue(db: DB, m: KfMsg, fallbackOpenKfId = "") {
  if (m.origin !== 3 && m.msgtype !== "event") return; // only messages from the WeChat user
  const ext = m.external_userid || m.event?.external_userid;
  const kfid = m.open_kfid || m.event?.open_kfid || fallbackOpenKfId || process.env.WECOM_OPEN_KFID || "";
  if (!ext || !kfid) return;
  if (m.origin === 3) {
    state.set(db, `budget:${ext}`, "0"); // a user message resets the send budget [VERIFY] whether a menu tap does
    state.set(db, `last_in:${ext}`, nowIso()); // opens WeChat's 48 h window for notify()
    state.set(db, `kfid:${ext}`, kfid);
    await flushHeld(db, ext, kfid);
  }
  const scene = m.event?.scene_param || m.event?.scene;
  if (m.msgtype === "event" && m.event?.event_type === "enter_session" && scene) bindLink(db, ext, (k) => k === `link:${scene}`);
  if (m.msgtype === "text" && /^\d{6}$/.test(m.text?.content.trim() ?? "")) {
    const code = m.text!.content.trim();
    if (bindLink(db, ext, (_k, v) => v.code === code)) return send(db, ext, kfid, [{ kind: "text", text: "✅ WeChat connected to your Memini account." }]);
  }
  const items = await toItems(db, m);
  if (items === null)
    return send(db, ext, kfid, [{ kind: "text", text: "Sorry, I can't read this type of message yet. Send text, photos, PDFs or a merged chat." }]);
  if (!items.length) return;
  // menu taps and events are answered at once (after flushing what's buffered, to keep order)
  if (items.some((i) => i.menuId || i.kind === "event")) {
    await flush(ext);
    return serial(ext, (o) => process_(db, ext, kfid, items, m.event?.welcome_code, o));
  }
  const buf = buffers.get(ext);
  if (buf) { clearTimeout(buf.timer); buf.items.push(...items); }
  const entry = buf ?? { items, timer: undefined as unknown as NodeJS.Timeout, openKfId: kfid };
  entry.timer = setTimeout(() => void flush(ext), DEBOUNCE_MS);
  buffers.set(ext, entry);
}

async function flush(ext: string) {
  const buf = buffers.get(ext);
  if (!buf) return;
  buffers.delete(ext);
  clearTimeout(buf.timer);
  await serial(ext, (o) => process_(getDb(), ext, buf.openKfId, buf.items, undefined, o));
}

// ── one batch at a time per user ──
// WeChat allows only ~5 messages after the user's last message. Items sent in a burst (3 files) can still arrive as
// several batches: they run one after the other (each sees the previous one's data), only the first says "Thinking...",
// and a batch that has a newer one waiting may skip its reply (the spec check answers with the whole state at the end).
type SerialOpts = { quiet: boolean; later: () => boolean };
const chains: Map<string, { tail: Promise<void>; waiting: number; running: boolean }> =
  ((globalThis as unknown as { __wecomChains?: Map<string, { tail: Promise<void>; waiting: number; running: boolean }> }).__wecomChains ??= new Map());
function serial(ext: string, fn: (o: SerialOpts) => Promise<void>): Promise<void> {
  const c = chains.get(ext) ?? { tail: Promise.resolve(), waiting: 0, running: false };
  chains.set(ext, c);
  const quiet = !c.running && c.waiting === 0; // nothing in flight: this batch may say "Thinking..."
  c.waiting++;
  const run = async () => {
    c.waiting--; c.running = true;
    try { await fn({ quiet, later: () => c.waiting > 0 || buffers.has(ext) }); } finally { c.running = false; }
  };
  c.tail = c.tail.then(run, run);
  return c.tail;
}

async function process_(db: DB, ext: string, openKfId: string, items: IncomingItem[], welcomeCode?: string, o: SerialOpts = { quiet: true, later: () => false }) {
  const isEvent = items.every((i) => i.kind === "event");
  try {
    // progressive replies: "Thinking..." at once, then the fast translation, then the full answer (each counts toward the send budget)
    // WECOM_PROGRESS=0: one reply at the end, as before
    const progress = isEvent || process.env.WECOM_PROGRESS === "0" ? undefined : { ack: o.quiet, send: (r: OutgoingReply) => send(db, ext, openKfId, [r]) };
    const replies = await handleIncoming({ userId: userFor(db, ext), channel: "wecom", items, progress, superseded: o.later }, db);
    if (isEvent) {
      if (!welcomeCode || !replies.length) return;
      const first = replies.flatMap(toWecomPayloads)[0];
      if (first) await post("/kf/send_msg_on_event", { code: welcomeCode, ...first }, db);
      return;
    }
    await send(db, ext, openKfId, replies);
  } catch (e) {
    console.error("[wecom] processing failed:", e);
    if (!isEvent) await send(db, ext, openKfId, [{ kind: "text", text: "Sorry, something went wrong on my side. Your message is saved — please try again in a minute." }]).catch(() => {});
  }
}

// ── sending (§6.2 budget, §5.12 msgmenu) ──
/** click.content: 1-128 bytes. Drop variation selectors and cut on a whole character, never inside an emoji. */
function menuLabel(label: string): string {
  let out = "";
  for (const ch of label.replace(/[\uFE0E\uFE0F]/g, "")) {
    if (Buffer.byteLength(out + ch) > 120) break;
    out += ch;
  }
  return out.trim() || "…";
}

export function toWecomPayloads(reply: OutgoingReply): Record<string, unknown>[] {
  if (reply.kind === "file" && reply.file) return [{ msgtype: "file", local_file: { path: reply.file.path, name: reply.file.name } }];
  if (reply.kind === "menu" && reply.buttons?.length) {
    // WeChat customer service has no styled buttons: msgmenu items are its only tappable choices (blue lines)
    const list = reply.buttons.map((b) => ({ type: "click", click: { id: b.id, content: menuLabel(b.label) } }));
    const tail = "";
    if (Buffer.byteLength(reply.text) <= MENU_HEAD_MAX) return [{ msgtype: "msgmenu", msgmenu: { head_content: reply.text, list, tail_content: tail } }];
    // long reply → the text first, then the question alone with its choices right under it
    const prompt = reply.prompt && Buffer.byteLength(reply.prompt) <= MENU_HEAD_MAX ? reply.prompt : "Choose one:";
    const body = reply.prompt && reply.text.endsWith(reply.prompt) ? reply.text.slice(0, -reply.prompt.length).trimEnd() : reply.text;
    return [...textChunks(body).map((t) => ({ msgtype: "text", text: { content: t } })), { msgtype: "msgmenu", msgmenu: { head_content: prompt, list, tail_content: tail } }];
  }
  return textChunks(reply.text).map((t) => ({ msgtype: "text", text: { content: t } }));
}

function textChunks(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n\n/)) {
    const next = cur ? `${cur}\n\n${para}` : para;
    if (Buffer.byteLength(next) > TEXT_MAX_BYTES && cur) { out.push(cur); cur = para; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

async function send(db: DB, ext: string, openKfId: string, replies: OutgoingReply[]) {
  for (const payload of replies.flatMap(toWecomPayloads)) {
    const used = Number(state.get(db, `budget:${ext}`) ?? 0);
    if (used >= SEND_BUDGET) {
      // budget exhausted → hold; the next user message triggers "I have N updates" (§6.2)
      const held = JSON.parse(state.get(db, `held:${ext}`) ?? "[]");
      state.set(db, `held:${ext}`, JSON.stringify([...held, payload]));
      continue;
    }
    let ready: Record<string, unknown>;
    try { ready = await materialize(db, payload); } catch (e) {
      // the sheet couldn't be uploaded: say where to get it instead of failing the whole reply
      console.error("[wecom] file upload failed:", e);
      const local = payload.local_file as { name: string } | undefined;
      ready = { msgtype: "text", text: { content: `📊 ${local?.name ?? "File"} is ready in the web app (Spec checks). Sending it on WeChat failed.` } };
    }
    let r: { msgid?: string };
    try { r = await post<{ msgid?: string }>("/kf/send_msg", { touser: ext, open_kfid: openKfId, ...ready }, db); } catch (e) {
      if (!(e instanceof WecomError) || (e.errcode !== 95001 && e.errcode !== 95018)) throw e;
      // WeChat's real limit was reached before ours: keep this and the rest for the user's next message
      console.error(`[wecom] send limit (${e.errcode}): holding the rest`);
      state.set(db, `budget:${ext}`, String(SEND_BUDGET));
      const held = JSON.parse(state.get(db, `held:${ext}`) ?? "[]");
      state.set(db, `held:${ext}`, JSON.stringify([...held, payload]));
      continue;
    }
    console.log(`[wecom] sent ${String(payload.msgtype)} msgid=${r.msgid ?? "?"} (${Buffer.byteLength(JSON.stringify(payload))} B)`);
    state.set(db, `budget:${ext}`, String(used + 1));
    state.set(db, `last_send:${ext}`, nowIso());
  }
}

/** Deliver what waited for this message. They count toward WeChat's ~5-message budget like any reply (they used not
 *  to, so the reply after them hit 95001), and what can't go out now stays held instead of being lost. Never throws:
 *  the user's new message is processed whatever happens here. */
async function flushHeld(db: DB, ext: string, openKfId: string) {
  const held = JSON.parse(state.get(db, `held:${ext}`) ?? "[]") as Record<string, unknown>[];
  if (!held.length) return;
  state.set(db, `held:${ext}`, "[]");
  const room = Math.max(0, SEND_BUDGET - 2); // keep two messages for the answer to what the user just sent
  const now = held.slice(0, room), later = held.slice(room);
  const intro = { msgtype: "text", text: { content: `📬 I have ${held.length} update${held.length > 1 ? "s" : ""} for you${later.length ? ` (here are ${now.length}, the rest with your next message)` : ""}:` } };
  const queue = now.length ? [intro, ...now] : [];
  let sent = 0;
  try {
    for (const p of queue) {
      await post("/kf/send_msg", { touser: ext, open_kfid: openKfId, ...(await materialize(db, p).catch(() => ({ msgtype: "text", text: { content: "📊 A file is ready in the web app." } }))) }, db);
      sent++;
    }
  } catch (e) {
    console.error(`[wecom] held updates: ${sent}/${queue.length} delivered, keeping the rest:`, e instanceof Error ? e.message : e);
  }
  const left = [...queue.slice(Math.max(1, sent)), ...later].filter((p) => p !== intro);
  state.set(db, `held:${ext}`, JSON.stringify(left));
  state.set(db, `budget:${ext}`, String(sent));
}

/** WeChat can only write to a user for 48 h after their last message (and ~5 messages). */
const WINDOW_MS = 47 * 3600_000;

/**
 * Tell the user about something that happened without them writing (a supplier confirmed through a link, an email
 * arrived). Inside WeChat's window it goes out now; otherwise it waits and is delivered with "I have N updates"
 * on their next message. The web app shows it either way.
 */
export async function notifyUser(db: DB, userId: string, replies: OutgoingReply[]): Promise<"sent" | "held" | "off"> {
  if (!wecomConfigured() || !replies.length) return "off";
  const ext = (db.prepare(`SELECT wecom_external_userid AS e FROM users WHERE id = ?`).get(userId) as { e: string | null } | undefined)?.e;
  if (!ext) return "off";
  const kfid = state.get(db, `kfid:${ext}`) ?? process.env.WECOM_OPEN_KFID ?? "";
  const lastIn = state.get(db, `last_in:${ext}`);
  if (!kfid || !lastIn || Date.now() - +new Date(lastIn) > WINDOW_MS) {
    const held = JSON.parse(state.get(db, `held:${ext}`) ?? "[]");
    state.set(db, `held:${ext}`, JSON.stringify([...held, ...replies.flatMap(toWecomPayloads)]));
    return "held";
  }
  await send(db, ext, kfid, replies);
  return "sent";
}

/** Contact link for the QR code (§6.3, §13.3 step 8). */
export async function contactLink(scene: string): Promise<string> {
  const r = await post<{ url: string }>("/kf/add_contact_way", { open_kfid: process.env.WECOM_OPEN_KFID, scene });
  return r.url;
}

export const wecomConfigured = () =>
  !!(process.env.WECOM_CORP_ID && process.env.WECOM_APP_SECRET && process.env.WECOM_CALLBACK_TOKEN && process.env.WECOM_ENCODING_AES_KEY);
