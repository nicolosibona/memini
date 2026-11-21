// THE one core entry point (blueprint §10.3). WeChat and the web chat on Home both call handleIncoming(),
// so every surface behaves identically. Grouping/debounce happens in the channel; one call = one group.
//
// content → extract each item → WHO is it from? (entity: certain or ask) → WHICH matter? (deterministic or ask)
//         → facts + tasks + aliases → audit → reply (alerts, consistent terms, next steps, Chinese draft)
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { getDb, newId, nowIso, today, type DB } from "@/lib/db";
import { transcribe } from "@/lib/adapters/asr";
import { addFacts, formatValue, parseValue, factLabel, fmtDay, type FactRow } from "./facts";
import { runAudit, openAlerts, type AlertRow } from "./audit";
import { classifyIntent, commandOf } from "./intent";
import { documentClues, documentFacts, documentPerson, extractDocument, extractText, quickTranslate, textFacts } from "./extract";
import { createEntity, entityLabel, getEntity, kindForRole, learnAliases, listEntities, ownNames, resolveEntity, type Clue } from "./entities";
import { createMatter, getMatter, listMatters, pickMatter, touchMatter, matterChecklist, type MatterRow } from "./matters";
import { addTask, deriveDocumentTasks, deriveFactTasks, ensureRecurring, listTasks } from "./tasks";
import { analysisButtons, canReplyTo, chineseDraftIn, COPY_LABEL, consistentTerms, detailsLine, draftReply, formatAlerts, formatTranslation, type OutgoingReply } from "./reply";
import { indexText, reindexScope, entityProfile } from "./memory";
import { ask } from "./assistant";
import { calendarSubscribed, userToken } from "./tokens";
import { isCalendarRequest, readReminder, saveReminder } from "./reminders";
import { createConfirmLink, missingDocs, termChoices } from "./confirm";
import { calendarPageUrl } from "./calendar";
import { DOC_TYPES, ENTITY_KINDS, MATTER_KINDS, SELF_KINDS, profileOf, type DocType, type EntityKind, type MatterKind } from "./domain";
import { isChinese, nameSimilarity } from "./normalize";
import { handleSpecContent, isSheetRequest, sheetFor, specCommand, specMenu, SPEC_WELCOME } from "./spec/flow";
import type { DocumentExtraction, TextExtraction } from "./schemas";

export type Channel = "wecom" | "web_upload" | "web_chat" | "sim" | "supplier_link" | "email";
export type IncomingItem = {
  kind: "text" | "voice" | "image" | "file" | "merged" | "event";
  text?: string;
  filePath?: string; // already stored under STORAGE_DIR
  menuId?: string;
  originalAuthor?: string; // nickname inside a merged forward
  chatTitle?: string; // merged forward title
  externalMsgId?: string;
  receivedAt?: string;
  event?: string;
  transcriptHint?: string; // simulator: transcript used for a voice item without ASR
  fromMe?: boolean; // written by the user (an email they BCC'd to Memini): its terms are what YOU said
};
export type { OutgoingReply } from "./reply";

/** Progressive replies (chat channels): the channel passes `send`, and the core sends short messages while it works —
 *  "Thinking...", then a fast translation — and leaves out of the final reply what was already shown. */
export type Progress = { send: (r: OutgoingReply) => Promise<void>; ack?: boolean };
type ProgressCtx = Progress & { shownTr: Set<string>; shownDoc: Set<string>; pending: Promise<unknown>[] };
const progressStore = new AsyncLocalStorage<ProgressCtx>();
const THINKING = process.env.PROGRESS_TEXT ?? "Thinking...";
const px = () => progressStore.getStore();
async function ack(text: string) {
  const c = px();
  if (c?.ack) await c.send({ kind: "text", text }).catch(() => {});
}

type MsgRow = {
  id: string; workspace_id: string; user_id: string | null; channel: string; group_id: string; kind: string; intent: string | null; original_author: string | null;
  text_original: string | null; text_translated: string | null; file_path: string | null; entity_id: string | null; matter_id: string | null; status: string;
  received_at: string; extracted_json: string | null;
};
type Extracted =
  | { type: "document"; document_id: string; data: DocumentExtraction; chat_title?: string }
  | { type: "text"; data: TextExtraction; said_by: "counterparty" | "user_report" | "me"; chat_title?: string };
type PendingRow = { id: string; user_id: string; message_ids: string; candidate_ids: string; clues_json: string; awaiting: string; menu_sent_at: string; status: string };
type PendingState = {
  clues: Clue[]; newName?: string | null; newKind?: EntityKind | null; conflict?: string | null;
  moveFrom?: { assignmentId: string } | null; entityId?: string; // set while asking WHICH matter
};

export const STORAGE_DIR = () => path.resolve(process.env.STORAGE_DIR ?? "./storage/files");

/** Store an uploaded/downloaded file as <id>__<original name>. Returns the absolute path. */
export function storeFile(name: string, data: Buffer): string {
  fs.mkdirSync(STORAGE_DIR(), { recursive: true });
  const safe = path.basename(name).replace(/[/\\?%*:|"<>\x00-\x1f]/g, "_").slice(-120) || "file";
  const p = path.join(STORAGE_DIR(), `${newId("f")}__${safe}`);
  fs.writeFileSync(p, data);
  return p;
}

const wsOf = (db: DB, userId: string) => {
  const u = db.prepare(`SELECT workspace_id FROM users WHERE id = ?`).get(userId) as { workspace_id: string } | undefined;
  if (!u) throw new Error(`unknown user ${userId}`);
  return u.workspace_id;
};
const profileKey = (db: DB, ws: string) => (db.prepare(`SELECT profile FROM workspaces WHERE id = ?`).get(ws) as { profile: string } | undefined)?.profile ?? "china_business";

/** `entityId` / `matterId`: the sender is already known for certain (a supplier answering through their own link),
 *  so "Who is this from?" is skipped. The content is still extracted and audited like any other forward. */
/** `superseded`: a newer batch from the same user is already waiting (WeChat bursts) — a reply that only restates
 *  state (the spec check) can be left to that batch. */
type IncomingInput = { userId: string; channel: Channel; items: IncomingItem[]; progress?: Progress; entityId?: string; matterId?: string; superseded?: () => boolean };

export async function handleIncoming(input: IncomingInput, db: DB = getDb()): Promise<OutgoingReply[]> {
  let replies: OutgoingReply[];
  if (!input.progress) replies = await handleIncomingInner(input, db);
  else {
    const ctx: ProgressCtx = { ...input.progress, shownTr: new Set(), shownDoc: new Set(), pending: [] };
    replies = await progressStore.run(ctx, () => handleIncomingInner(input, db));
  }
  return withCopyButtons(db, input.userId, input.channel, replies);
}

/** Every reply that carries a Chinese draft gets a "📋 Chinese only" button: the tap answers with a bubble holding
 *  just the Chinese, ready to forward. The draft is kept as an outgoing message so the tap works later too. */
function withCopyButtons(db: DB, userId: string, channel: Channel, replies: OutgoingReply[]): OutgoingReply[] {
  return replies.map((r) => {
    // a reply that IS the clean text (the bubble itself) needs no button: on WeChat it is forwarded as it is
    if (!r.copy?.text || r.copy.text === r.text || r.buttons?.some((b) => b.id.startsWith("zh:"))) return r;
    const id = newId("out");
    const ws = wsOf(db, userId);
    db.prepare(`INSERT INTO messages (id, workspace_id, user_id, channel, direction, kind, intent, text_original, status, received_at) VALUES (?,?,?,?,'out','draft','draft',?,'skipped',?)`)
      .run(id, ws, userId, channel, r.copy.text, nowIso());
    const button = { id: `zh:${id}`, label: COPY_LABEL };
    return r.kind === "menu"
      ? { ...r, buttons: [button, ...(r.buttons ?? [])] }
      : { ...r, kind: "menu", buttons: [button], prompt: "Tap to get the Chinese alone, ready to forward:" };
  });
}

async function handleIncomingInner(input: IncomingInput, db: DB): Promise<OutgoingReply[]> {
  const ws = wsOf(db, input.userId);
  const items = input.items.filter((it) => !it.externalMsgId || !db.prepare(`SELECT 1 FROM messages WHERE external_msgid = ?`).get(it.externalMsgId)); // WeCom retries
  if (!items.length) return [];

  const menu = items.find((i) => i.menuId);
  if (menu) {
    logRaw(db, ws, input, [menu], "menu_reply");
    if (/^(ent|mat):/.test(menu.menuId!) && menu.menuId !== "ent:skip") await ack(THINKING);
    if (menu.menuId!.startsWith("spec:")) { if (menu.menuId !== "spec:new") await ack(THINKING); return specMenu(db, ws, input.userId, menu.menuId!.slice(5)); }
    return handleMenu(db, ws, input.userId, menu.menuId!);
  }
  const ev = items.find((i) => i.kind === "event");
  if (ev) return ev.event === "enter_session" ? [welcome(profileKey(db, ws))] : [];

  const textOnly = items.every((i) => i.kind === "text");
  const joined = items.map((i) => i.text ?? "").join("\n").trim();
  const pending = openPending(db, input.userId);

  if (pending?.awaiting === "new_entity_name" && textOnly && joined) {
    // "What do you want to call it?" → the next free text is the name (§5.10)
    logRaw(db, ws, input, items, "command");
    const st = JSON.parse(pending.clues_json) as PendingState;
    const e = createEntity(db, ws, { kind: st.newKind ?? "supplier", display_name: joined.slice(0, 80) });
    return resolvePendingWithEntity(db, ws, pending, e.id, `➕ Created ${entityLabel(e)}.`);
  }
  const electronics = profileKey(db, ws) === "electronics" && !input.entityId && input.channel !== "supplier_link";
  if (textOnly && commandOf(joined)) {
    logRaw(db, ws, input, items, "command");
    if (electronics) { const r = await specCommand(db, ws, input.userId, commandOf(joined)!); if (r) return r; }
    return handleCommand(db, ws, input.userId, commandOf(joined)!, joined);
  }

  const msgs = await storeMessages(db, ws, input, items);
  const text = msgs.map((m) => m.text_original ?? "").join("\n");
  if (electronics) {
    // electronics spec check: everything forwarded goes into the open check; only a clear question goes to the assistant
    if (textOnly && isSheetRequest(text)) { setStatus(db, msgs, "command", "skipped"); return sheetFor(db, input.userId); }
    const it = textOnly ? await classifyIntent(text, msgs.map((m) => m.kind)) : { intent: "content" as const, confidence: 1 };
    const technical = /\d\s*(?:k?v|m?a|k?w|mv|%|°c|℃|[µμu]f|mm|k?hz|小时|伏|安)/i.test(text); // values → it's content, whatever the phrasing
    if (it.intent === "question" && it.confidence >= 0.8 && !technical) {
      setStatus(db, msgs, "question", "skipped");
      await ack(THINKING);
      return [answerReply((await ask(db, ws, text, { channel: input.channel === "wecom" ? "wecom" : "web" })).text)];
    }
    setStatus(db, msgs, "content", "assigned");
    if (msgs.some((m) => m.file_path)) await ack(THINKING); // documents take ~10 s; chat messages answer in a few
    const replies = await handleSpecContent(db, ws, input.userId, msgs);
    return input.superseded?.() ? [] : replies; // the batch waiting behind this one answers with the whole check
  }
  // the user's own appointment or reminder, typed or dictated ("meeting with Seller 1 on Dec 25, put it in the calendar")
  if (!input.entityId && input.channel !== "email" && input.channel !== "supplier_link" && msgs.every((m) => m.kind === "text" || m.kind === "voice") && isCalendarRequest(text)) {
    setStatus(db, msgs, "command", "skipped");
    return reminderReplies(db, ws, input.userId, text, msgs);
  }
  // a counterparty answering through their own link, or a forwarded email: always content, never a question for the assistant
  const intent = input.entityId || input.channel === "email" ? { intent: "content" as const, confidence: 1, via: "rule" as const } : await classifyIntent(text, msgs.map((m) => m.kind));
  if (intent.intent === "question" && intent.confidence >= 0.7) {
    setStatus(db, msgs, "question", "skipped");
    await ack(THINKING);
    return [answerReply((await ask(db, ws, text, { channel: input.channel === "wecom" ? "wecom" : "web" })).text)];
  }
  if (intent.intent === "content") {
    setStatus(db, msgs, "content", "pending");
    await ack(THINKING);
    return processContent(db, ws, input.userId, msgs, { entityId: input.entityId, matterId: input.matterId });
  }
  // unsure (D7 default: ask)
  db.prepare(`INSERT INTO pending_groups (id, user_id, message_ids, candidate_ids, clues_json, awaiting, menu_sent_at, status) VALUES (?,?,?,?,?,?,?,'open')`)
    .run(newId("pg"), input.userId, JSON.stringify(msgs.map((m) => m.id)), "[]", "{}", "intent_choice", nowIso());
  return [{ kind: "menu", text: "Is this from someone you deal with, or a question for me?", buttons: [{ id: "int:content", label: "📥 Forwarded content" }, { id: "int:question", label: "❓ My question" }] }];
}

/** An assistant answer; a Chinese draft inside it ("write a polite follow-up…") becomes copy-ready. */
function answerReply(text: string): OutgoingReply {
  const zh = chineseDraftIn(text);
  return { kind: "text", text, ...(zh ? { copy: { label: COPY_LABEL, text: zh } } : {}) };
}

function logRaw(db: DB, ws: string, input: { userId: string; channel: Channel }, items: IncomingItem[], intent: string) {
  for (const it of items)
    db.prepare(`INSERT INTO messages (id, workspace_id, user_id, channel, external_msgid, direction, kind, intent, text_original, status, received_at) VALUES (?,?,?,?,?,'in',?,?,?,'skipped',?)`)
      .run(newId("msg"), ws, input.userId, input.channel, it.externalMsgId ?? null, it.menuId ? "menu_click" : it.kind, intent, it.menuId ?? it.text ?? null, it.receivedAt ?? nowIso());
}

async function storeMessages(db: DB, ws: string, input: { userId: string; channel: Channel }, items: IncomingItem[]): Promise<MsgRow[]> {
  const group = newId("grp");
  const out: MsgRow[] = [];
  for (const it of items) {
    let text = it.text ?? null;
    if (it.kind === "voice") text = it.filePath ? (await transcribe(it.filePath, it.transcriptHint ?? it.text)).text : it.transcriptHint ?? it.text ?? null;
    const row: MsgRow = {
      id: newId("msg"), workspace_id: ws, user_id: input.userId, channel: input.channel, group_id: group, kind: it.kind, intent: null, original_author: it.originalAuthor ?? null,
      text_original: text, text_translated: null, file_path: it.filePath ?? null, entity_id: null, matter_id: null, status: "pending",
      received_at: it.receivedAt ?? nowIso(), extracted_json: it.chatTitle || it.fromMe ? JSON.stringify({ chat_title: it.chatTitle, from_me: it.fromMe || undefined }) : null,
    };
    db.prepare(`INSERT INTO messages (id, workspace_id, user_id, channel, external_msgid, group_id, direction, kind, original_author, text_original, file_path, status, received_at, extracted_json) VALUES (?,?,?,?,?,?,'in',?,?,?,?,?,?,?)`)
      .run(row.id, ws, input.userId, row.channel, it.externalMsgId ?? null, group, row.kind, row.original_author, row.text_original, row.file_path, row.status, row.received_at, row.extracted_json);
    out.push(row);
  }
  return out;
}

const setStatus = (db: DB, msgs: MsgRow[], intent: string, status: string) => { for (const m of msgs) db.prepare(`UPDATE messages SET intent = ?, status = ? WHERE id = ?`).run(intent, status, m.id); };
const loadMsgs = (db: DB, ids: string[]) => (ids.length ? (db.prepare(`SELECT * FROM messages WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY received_at, rowid`).all(...ids) as MsgRow[]) : []);
const extractedOf = (m: MsgRow): Extracted | null => { const x = m.extracted_json ? JSON.parse(m.extracted_json) : null; return x?.type ? (x as Extracted) : null; };
const recentEntity = (db: DB, ws: string) => listEntities(db, ws)[0]?.id ?? null;
const openPending = (db: DB, userId: string) => db.prepare(`SELECT * FROM pending_groups WHERE user_id = ? AND status = 'open' ORDER BY menu_sent_at DESC LIMIT 1`).get(userId) as PendingRow | undefined;

/** Clues of an item: identifying parties on documents; company names in text, nicknames and chat titles are weak. */
function cluesOf(m: MsgRow, x: Extracted): Clue[] {
  const clues: Clue[] = x.type === "document" ? documentClues(x.data) : x.data.company_names.map((n) => ({ kind: "legal_name" as const, value: n, strong: false }));
  if (m.original_author) clues.push({ kind: "wechat_nickname", value: m.original_author, strong: false });
  if (x.chat_title) clues.push({ kind: "chat_title", value: x.chat_title, strong: false });
  return clues;
}

async function processContent(db: DB, ws: string, userId: string, msgs: MsgRow[], known?: { entityId?: string; matterId?: string }): Promise<OutgoingReply[]> {
  // 0. chat channels: one fast translation of all the Chinese text, sent as soon as it's ready (the full reading takes longer)
  const ctx = px();
  let extracted = false;
  const zh = msgs.filter((m) => ["text", "merged", "voice"].includes(m.kind) && isChinese(m.text_original ?? ""));
  if (ctx && zh.length) {
    const joined = zh.map((m) => (m.original_author ? `${m.original_author}: ${m.text_original}` : m.text_original)).join("\n");
    ctx.pending.push(quickTranslate(joined).then(async (t) => {
      if (!t || extracted) return; // the full reading won the race: it carries the translation itself
      for (const m of zh) ctx.shownTr.add(m.id);
      await ctx.send({ kind: "text", text: `🇬🇧 ${t}` });
    }).catch(() => {}));
  }

  // 1. normalize + extract every item (in parallel)
  await Promise.all(msgs.map(async (m) => {
    const meta = m.extracted_json ? JSON.parse(m.extracted_json) : {};
    let x: Extracted;
    if (m.file_path && (m.kind === "image" || m.kind === "file")) {
      const { data } = await extractDocument(m.file_path, { receivedAt: m.received_at });
      const docId = newId("doc");
      db.prepare(`INSERT INTO documents (id, workspace_id, message_id, doc_type, title, extracted_json, doc_date, expires_at, file_path, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(docId, ws, m.id, data.doc_type, data.title, JSON.stringify(data), data.doc_date, data.expiry_date, m.file_path, nowIso());
      indexText(db, { type: "document", id: docId, workspaceId: ws }, `${data.title}\n${data.summary}\n${data.visible_text}`);
      x = { type: "document", document_id: docId, data, chat_title: meta.chat_title };
    } else {
      const { data } = await extractText(m.text_original ?? "", m.received_at);
      x = { type: "text", data, said_by: meta.from_me ? "me" : m.kind === "voice" ? "user_report" : "counterparty", chat_title: meta.chat_title }; // your own voice note is a report (§6.4)
      db.prepare(`UPDATE messages SET text_translated = ? WHERE id = ?`).run(data.translation, m.id);
      indexText(db, { type: "message", id: m.id, workspaceId: ws }, `${m.text_original ?? ""}\n${data.translation}`);
    }
    m.extracted_json = JSON.stringify(x);
    db.prepare(`UPDATE messages SET extracted_json = ? WHERE id = ?`).run(m.extracted_json, m.id);
  }));
  extracted = true;
  if (ctx) await Promise.all(ctx.pending); // keep the order: the translation goes out before anything below

  if (known?.entityId && getEntity(db, known.entityId)) {
    // the sender is certain (their own link), but a document may be about someone else (a middleman's license):
    // learn its identifiers only if they point to nobody else
    const clues = msgs.flatMap((m) => cluesOf(m, extractedOf(m)!));
    const r = resolveEntity(db, { workspaceId: ws, clues: clues.filter((c) => c.strong) });
    const safe = !r.certainId || r.certainId === known.entityId ? clues : [];
    return assign(db, ws, userId, msgs, known.entityId, safe, "document", undefined, known.matterId);
  }

  // 2. your own documents (passport, permit…) go to you — identified by name/ID number, not guessed
  const own = ownNames(db, ws);
  const replies: OutgoingReply[] = [];
  const selfMsgs = msgs.filter((m) => { const x = extractedOf(m); const p = x?.type === "document" ? documentPerson(x.data) : null; return !!p && own.some((n) => nameSimilarity(n, p.name) >= 0.9 || (p.name_alt && nameSimilarity(n, p.name_alt) >= 0.9)); });
  for (const m of selfMsgs) {
    const x = extractedOf(m) as Extracted & { type: "document" };
    const p = documentPerson(x.data)!;
    const existing = resolveEntity(db, { workspaceId: ws, clues: documentClues(x.data), includeSelf: true });
    const person = existing.certainId && SELF_KINDS.includes(getEntity(db, existing.certainId)!.kind) ? existing.certainId
      : listEntities(db, ws, { kinds: ["self_person"], includeSelf: true }).find((e) => nameSimilarity(e.display_name, p.name) >= 0.9 || (p.name_alt && nameSimilarity(e.display_name, p.name_alt) >= 0.9))?.id
      ?? createEntity(db, ws, { kind: "self_person", display_name: p.name_alt && !/[一-鿿]/.test(p.name_alt) ? p.name_alt : p.name, id_number: p.id_number }).id;
    await sendInterim([m]);
    replies.push(...(await assign(db, ws, userId, [m], person, documentClues(x.data), "document")));
  }

  // 3. counterparties: certain → file it; otherwise ask once (§5.6, §5.7)
  const rest = msgs.filter((m) => !selfMsgs.includes(m));
  const strong = (m: MsgRow) => cluesOf(m, extractedOf(m)!).some((c) => c.strong);
  const idMsgs = rest.filter(strong), others = rest.filter((m) => !strong(m));
  const toPending: MsgRow[] = [...others];
  let conflict: string | null = null, newName: string | null = null, newKind: EntityKind | null = null;
  if (idMsgs.length) {
    const clues = idMsgs.flatMap((m) => cluesOf(m, extractedOf(m)!));
    const r = resolveEntity(db, { workspaceId: ws, clues, recentEntityId: recentEntity(db, ws) });
    if (r.certainId) { await sendInterim(idMsgs); replies.push(...(await assign(db, ws, userId, idMsgs, r.certainId, clues, "document"))); }
    else { toPending.unshift(...idMsgs); ({ conflict, newName, newKind } = r); }
  }
  if (toPending.length) replies.push(...askWho(db, ws, userId, toPending, toPending.flatMap((m) => cluesOf(m, extractedOf(m)!)), { conflict, newName, newKind }));
  return replies;
}

/** Chat channels: before the slow part (checks + Chinese draft), say what arrived — unless it was already shown. */
async function sendInterim(msgs: MsgRow[]) {
  const ctx = px();
  if (!ctx) return;
  const lines: string[] = [];
  for (const m of msgs) {
    const x = extractedOf(m);
    if (x?.type === "document" && !ctx.shownDoc.has(m.id)) { lines.push(`📄 ${x.data.title}${x.data.summary ? ` — ${x.data.summary}` : ""}`); ctx.shownDoc.add(m.id); }
    if (x?.type === "text" && !ctx.shownTr.has(m.id) && x.data.translation) { lines.push(`🇬🇧 ${x.data.translation}`); ctx.shownTr.add(m.id); }
  }
  if (lines.length) await ctx.send({ kind: "text", text: `${lines.join("\n\n")}\n\n${THINKING}` }).catch(() => {});
}

/** Which kinds of counterparty usually send this content: only orders the "Who is this from?" menu. */
function kindsForContent(msgs: MsgRow[]): EntityKind[] {
  const keys = new Set(msgs.flatMap((m) => extractedOf(m)?.data.facts.map((f) => f.key) ?? []));
  const docTypes = msgs.map((m) => extractedOf(m)).filter((x): x is Extracted & { type: "document" } => x?.type === "document").map((x) => DOC_TYPES[x.data.doc_type].matterKind as MatterKind);
  const kinds = new Set<EntityKind>();
  if (["unit_price", "moq", "incoterm", "lead_time_days", "order_qty", "tooling_fee"].some((k) => keys.has(k as never)) || docTypes.includes("purchase")) kinds.add("supplier");
  if (["rent_amount", "security_deposit", "rent_due_day", "lease_end"].some((k) => keys.has(k as never)) || docTypes.includes("lease")) kinds.add("landlord");
  if (["tax_type", "tax_period", "filing_deadline", "amount_due"].some((k) => keys.has(k as never)) || docTypes.includes("tax")) { kinds.add("government"); kinds.add("service_provider"); }
  if (docTypes.includes("logistics")) kinds.add("logistics");
  return [...kinds];
}

function describeItems(msgs: MsgRow[]) {
  const n = (k: string[]) => msgs.filter((m) => k.includes(m.kind)).length;
  return ([[n(["text", "merged"]), "message"], [n(["voice"]), "voice note"], [n(["image"]), "photo"], [n(["file"]), "document"]] as [number, string][])
    .filter(([c]) => c > 0).map(([c, w]) => `${c} ${w}${c > 1 ? "s" : ""}`).join(" and ");
}

/** An unanswered "Who is this from?" older than this is closed: its items wait in To file on the web, and new forwards get a fresh menu. */
const PENDING_STALE_MS = Number(process.env.PENDING_STALE_MS ?? 10 * 60_000);

/** One menu per user (§5.7, §5.9): uncertain items sent within a few minutes join the open question, and the menu is
 *  sent again with them (WeChat users don't scroll back to an old menu). An old unanswered question is closed instead. */
function askWho(db: DB, ws: string, userId: string, msgs: MsgRow[], clues: Clue[], o: { conflict: string | null; newName: string | null; newKind: EntityKind | null }): OutgoingReply[] {
  const shown = px();
  const translations = msgs.flatMap((m) => { const x = extractedOf(m); return x?.type === "text" ? [formatTranslation(x.data, { translation: !shown?.shownTr.has(m.id) })] : []; }).filter(Boolean);
  const summaries = msgs.flatMap((m) => { const x = extractedOf(m); return x?.type === "document" && !shown?.shownDoc.has(m.id) ? [`📄 ${x.data.title}${x.data.summary ? ` — ${x.data.summary}` : ""}`] : []; });
  // only an open "Who is this from?" can be joined; any other open question (intent, matter, name) is left as it is
  let existing = openPending(db, userId);
  if (existing && existing.awaiting !== "entity_choice") existing = undefined;
  if (existing && Date.now() - +new Date(existing.menu_sent_at) > PENDING_STALE_MS) {
    db.prepare(`UPDATE pending_groups SET status = 'expired' WHERE id = ?`).run(existing.id); // its messages stay pending → To file
    existing = undefined;
  }
  let groupMsgIds = msgs.map((m) => m.id);
  let st: PendingState;
  let joinedCount = 0;
  if (existing) {
    groupMsgIds = [...JSON.parse(existing.message_ids), ...groupMsgIds];
    const prev = JSON.parse(existing.clues_json) as PendingState;
    st = { ...prev, clues: [...prev.clues, ...clues], conflict: prev.conflict ?? o.conflict, newName: prev.newName ?? o.newName, newKind: prev.newKind ?? o.newKind };
    joinedCount = groupMsgIds.length;
  } else st = { clues, conflict: o.conflict, newName: o.newName, newKind: o.newKind };

  const r = resolveEntity(db, { workspaceId: ws, clues: st.clues, recentEntityId: recentEntity(db, ws), preferKinds: kindsForContent(msgs) });
  st = { ...st, conflict: st.conflict ?? r.conflict, newName: st.newName ?? r.newName, newKind: st.newKind ?? r.newKind };
  if (existing) {
    db.prepare(`UPDATE pending_groups SET message_ids = ?, candidate_ids = ?, clues_json = ?, menu_sent_at = ? WHERE id = ?`)
      .run(JSON.stringify(groupMsgIds), JSON.stringify(r.candidates.map((c) => c.id)), JSON.stringify(st), nowIso(), existing.id);
  } else {
    db.prepare(`INSERT INTO pending_groups (id, user_id, message_ids, candidate_ids, clues_json, awaiting, menu_sent_at, status) VALUES (?,?,?,?,?,?,?,'open')`)
      .run(newId("pg"), userId, JSON.stringify(groupMsgIds), JSON.stringify(r.candidates.map((c) => c.id)), JSON.stringify(st), "entity_choice", nowIso());
  }
  const guess = r.guessId ? r.candidates.find((c) => c.id === r.guessId) : undefined;
  const lines = [...summaries, ...translations];
  const what = joinedCount ? `${joinedCount} items in a row` : describeItems(msgs);
  if (joinedCount) lines.push(`📥 Together with what you sent just before, ${joinedCount} items are waiting. They'll all be filed under the one you pick.`);
  const prompt = st.conflict ? `⚠️ ${st.conflict}\nI saved nothing yet. Who is this from?`
    : st.newName ? `I received ${what} from ${st.newName}, who isn't in your contacts yet.\nWho is this from?`
    : guess ? `I received ${what}, but I can't find the company name.\nWho is this from? I think it's ${guess.label} — ${r.guessReason}.`
    : `I received ${what}, but I can't find the company name.\nWho is this from?`;
  lines.push(prompt);
  const ordered = guess ? [guess, ...r.candidates.filter((c) => c.id !== guess.id)] : r.candidates;
  const kindLabel = ENTITY_KINDS[st.newKind ?? "supplier"].label.toLowerCase();
  return [{
    kind: "menu", text: lines.join("\n\n"), prompt,
    buttons: [
      ...ordered.slice(0, st.newName ? 3 : 4).map((c) => ({ id: `ent:${c.id}`, label: `${ENTITY_KINDS[c.kind]?.icon ?? "👤"} ${entityLabel(c)}${guess && c.id === guess.id ? " (likely)" : ""}` })),
      { id: "ent:new", label: st.newName ? `➕ New ${kindLabel}: ${st.newName}` : "➕ Someone new" },
      { id: "ent:skip", label: "🚫 Don't save, just translate" },
    ],
  }];
}

/** Matter kind an item belongs to: from the document type, else the counterparty's usual kind of matter. */
function matterKindFor(x: Extracted | null, entityKind: EntityKind): MatterKind {
  if (x?.type === "document" && x.data.doc_type !== "other" && x.data.doc_type !== "chat_screenshot") {
    const k = DOC_TYPES[x.data.doc_type].matterKind as MatterKind;
    // a landlord's business license belongs to the lease, a tax office's notice to tax…
    if (x.data.doc_type === "business_license" || x.data.doc_type === "bank_details") return defaultMatterKind(entityKind);
    return k;
  }
  return defaultMatterKind(entityKind);
}
/** For a chat message: the kind of matter this counterparty usually has open (the accountant → Tax), else the default. */
function usualMatterKind(db: DB, entityId: string, k: EntityKind): MatterKind {
  const kinds = [...new Set((db.prepare(`SELECT kind FROM matters WHERE entity_id = ? AND status IN ('open','waiting')`).all(entityId) as { kind: MatterKind }[]).map((r) => r.kind))];
  return kinds.length === 1 ? kinds[0] : defaultMatterKind(k);
}
function defaultMatterKind(k: EntityKind): MatterKind {
  return ({ supplier: "purchase", customer: "sale", landlord: "lease", government: "general", service_provider: "general", bank: "banking", logistics: "logistics", employee: "hr", self_person: "residence_permit", self_company: "company", other: "general" } as Record<EntityKind, MatterKind>)[k];
}
const subjectOf = (x: Extracted | null) => (x ? x.data.subject ?? null : null);

/** Link messages → entity + matter → facts, tasks, aliases → audit → reply. */
async function assign(db: DB, ws: string, userId: string, msgs: MsgRow[], entityId: string, clues: Clue[], aliasSource: "document" | "user_choice", prefix?: string, forcedMatterId?: string): Promise<OutgoingReply[]> {
  const entity = getEntity(db, entityId)!;
  const startedAt = nowIso(); // deadlines created from here on came from these items (→ the phone calendar)
  // which matter? (one per matter kind in this group; ambiguous → ask)
  const matterByKind = new Map<MatterKind, MatterRow>();
  const createdMatters: string[] = [];
  const isSelf = SELF_KINDS.includes(entity.kind);
  for (const m of msgs) {
    const x = extractedOf(m);
    if (forcedMatterId) continue;
    const kind = x?.type === "document" && x.data.doc_type !== "other" ? matterKindFor(x, entity.kind) : usualMatterKind(db, entityId, entity.kind);
    if (matterByKind.has(kind)) continue;
    // a government office's notice: the workspace's matter of that kind (e.g. Tax), whoever the main counterparty is
    const pick = pickMatter(db, ws, { kind, entityId: isSelf && kind !== "residence_permit" ? null : entityId, entityName: entity.display_name, subject: subjectOf(x), personName: kind === "residence_permit" ? (isSelf ? entity.display_name : null) : null });
    if ("ambiguous" in pick) return askWhichMatter(db, userId, msgs, entityId, clues, pick.ambiguous);
    matterByKind.set(kind, pick.matter);
    if (pick.created) createdMatters.push(pick.matter.id);
  }
  const forced = forcedMatterId ? getMatter(db, forcedMatterId) : undefined;
  const matterFor = (m: MsgRow) => {
    const x = extractedOf(m);
    return forced ?? matterByKind.get(x?.type === "document" && x.data.doc_type !== "other" ? matterKindFor(x, entity.kind) : usualMatterKind(db, entityId, entity.kind))!;
  };

  const saved: FactRow[] = [];
  const translations: TextExtraction[] = [];
  const docs: DocumentExtraction[] = [];
  const trShown: boolean[] = [], docShown: boolean[] = []; // already sent as a progress message
  for (const m of msgs) {
    const matter = matterFor(m);
    const ctx = { workspaceId: ws, entityId, matterId: matter.id };
    db.prepare(`UPDATE messages SET entity_id = ?, matter_id = ?, status = 'assigned', intent = 'content' WHERE id = ?`).run(entityId, matter.id, m.id);
    reindexScope(db, { type: "message", id: m.id }, entityId, matter.id);
    const x = extractedOf(m);
    if (!x) continue;
    if (x.type === "document") {
      docs.push(x.data);
      docShown.push(!!px()?.shownDoc.has(m.id));
      db.prepare(`UPDATE documents SET entity_id = ?, matter_id = ? WHERE id = ?`).run(entityId, matter.id, x.document_id);
      reindexScope(db, { type: "document", id: x.document_id }, entityId, matter.id);
      const r = addFacts(db, ctx, documentFacts(x.data, { documentId: x.document_id, messageId: m.id, statedAt: m.received_at }));
      saved.push(...r.saved);
      for (const t of x.data.tasks) addTask(db, { ...ctx, messageId: m.id, documentId: x.document_id }, { kind: t.kind, who: t.who, what: t.what, due: t.due });
      deriveDocumentTasks(db, { ...ctx, documentId: x.document_id }, { doc_type: x.data.doc_type, title: x.data.title, expires_at: x.data.expiry_date });
      deriveFactTasks(db, ctx, r.saved);
      if (x.data.expiry_date && !matter.target_date && ["residence_permit", "company"].includes(matter.kind)) db.prepare(`UPDATE matters SET target_date = ? WHERE id = ?`).run(x.data.expiry_date, matter.id);
    } else {
      translations.push(x.data);
      trShown.push(!!px()?.shownTr.has(m.id));
      const r = addFacts(db, ctx, textFacts(x.data, { messageId: m.id, statedAt: m.received_at, saidBy: x.said_by, sourceType: m.kind === "voice" ? "voice" : "chat" }), m.text_original ?? "");
      saved.push(...r.saved);
      for (const t of x.data.tasks) addTask(db, { ...ctx, messageId: m.id }, { kind: t.kind, who: t.who, what: t.what, due: t.due });
      deriveFactTasks(db, ctx, r.saved);
      if (m.original_author && !db.prepare(`SELECT 1 FROM contacts WHERE entity_id = ? AND wechat_nickname = ?`).get(entityId, m.original_author))
        db.prepare(`INSERT INTO contacts (id, entity_id, name, role, wechat_nickname) VALUES (?,?,?,?,?)`).run(newId("ct"), entityId, m.original_author.replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/)[0] || m.original_author, null, m.original_author);
    }
    touchMatter(db, matter.id);
  }
  const learned = learnAliases(db, entityId, clues, aliasSource);
  db.prepare(`UPDATE entities SET last_activity_at = ? WHERE id = ?`).run(nowIso(), entityId);
  ensureRecurring(db, ws);
  const newAlerts = await runAudit(db, ws);

  const matterIds = [...new Set(msgs.map((m) => matterFor(m).id))];
  const asgId = newId("asg");
  db.prepare(`INSERT INTO pending_groups (id, user_id, message_ids, candidate_ids, clues_json, awaiting, menu_sent_at, status) VALUES (?,?,?,?,?,?,?,'resolved')`)
    .run(asgId, userId, JSON.stringify(msgs.map((m) => m.id)), JSON.stringify([entityId]), JSON.stringify({ clues, learnedAliasIds: learned, entityId, matterIds, createdMatters }), "assignment", nowIso());
  return [await analysisReply(db, ws, entityId, matterIds, asgId, { saved, translations, docs, newAlerts, prefix, trShown, docShown, userId, startedAt })];
}

function askWhichMatter(db: DB, userId: string, msgs: MsgRow[], entityId: string, clues: Clue[], matters: MatterRow[]): OutgoingReply[] {
  const existing = openPending(db, userId);
  if (existing) db.prepare(`UPDATE pending_groups SET status = 'skipped' WHERE id = ?`).run(existing.id);
  db.prepare(`INSERT INTO pending_groups (id, user_id, message_ids, candidate_ids, clues_json, awaiting, menu_sent_at, status) VALUES (?,?,?,?,?,?,?,'open')`)
    .run(newId("pg"), userId, JSON.stringify(msgs.map((m) => m.id)), JSON.stringify(matters.map((m) => m.id)), JSON.stringify({ clues, entityId } satisfies PendingState), "matter_choice", nowIso());
  const e = getEntity(db, entityId)!;
  return [{ kind: "menu", text: `This is from ${entityLabel(e)}. Which of their matters is it about?`, buttons: [...matters.map((m) => ({ id: `mat:${m.id}`, label: `${MATTER_KINDS[m.kind].icon} ${m.title}` })), { id: "mat:new", label: "➕ Something new" }] }];
}

async function analysisReply(db: DB, ws: string, entityId: string, matterIds: string[], asgId: string, o: { saved: FactRow[]; translations: TextExtraction[]; docs: DocumentExtraction[]; newAlerts: AlertRow[]; prefix?: string; trShown?: boolean[]; docShown?: boolean[]; userId?: string; startedAt?: string }): Promise<OutgoingReply> {
  const p = entityProfile(db, entityId)!;
  const e = p.entity;
  const matters = matterIds.map((id) => getMatter(db, id)!).filter(Boolean);
  const relevant = (a: AlertRow) => a.entity_id === entityId || (a.matter_id && matterIds.includes(a.matter_id));
  const fresh = o.newAlerts.filter(relevant);
  const stillOpen = matterIds.flatMap((id) => openAlerts(db, { matterId: id })).concat(openAlerts(db, { entityId })).filter((a, i, all) => a.severity === "red" && !fresh.some((n) => n.id === a.id) && all.findIndex((x) => x.id === a.id) === i);
  const facts = matterIds.flatMap((id) => db.prepare(`SELECT * FROM facts WHERE matter_id = ? AND status NOT IN ('superseded','rejected') ORDER BY stated_at, id`).all(id) as FactRow[]);
  const isSupplier = e.kind === "supplier";
  const missingLicense = isSupplier && !db.prepare(`SELECT 1 FROM documents WHERE entity_id = ? AND doc_type = 'business_license'`).get(entityId);
  const openTasks = matterIds.flatMap((id) => listTasks(db, ws, { matterId: id, status: "open" })).filter((t) => t.who !== "counterparty").slice(0, 4).map((t) => `${t.what}${t.due_at ? ` — due ${fmtDay(t.due_at)}` : ""}`);
  const d = await draftReply(db, {
    counterparty: entityLabel(e), counterpartyKind: e.kind, matterTitle: matters.map((m) => m.title).join(", ") || null, alerts: fresh.length ? fresh : stillOpen, facts,
    translations: o.translations, summaries: o.docs.map((x) => `${x.title}: ${x.summary}`), contactName: p.contacts[0]?.name ?? null, missingLicense, openTasks,
  });
  for (const ex of d.extra_alerts) {
    const info = db.prepare(`INSERT INTO alerts (workspace_id, entity_id, matter_id, severity, code, title, detail, evidence_fact_ids, dedupe_key, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,'open',?)`)
      .run(ws, entityId, matterIds[0] ?? null, "amber", "AI_NOTE", ex.title, ex.detail, "[]", `AI_NOTE:${asgId}:${ex.title}`, nowIso());
    fresh.push({ id: Number(info.lastInsertRowid), workspace_id: ws, entity_id: entityId, matter_id: matterIds[0] ?? null, severity: "amber", code: "AI_NOTE", title: ex.title, detail: ex.detail, evidence_fact_ids: "[]", dedupe_key: "", status: "open", created_at: nowIso(), resolved_at: null });
  }

  const where = matters.length ? ` · ${matters.map((m) => `${MATTER_KINDS[m.kind].icon} ${m.title}`).join(", ")}` : "";
  const parts = [`${o.prefix ? o.prefix + "\n" : ""}📁 Filed under: ${entityLabel(e)}${where}`];
  o.docs.forEach((x, i) => { if (x.summary && !o.docShown?.[i]) parts.push(`📄 ${x.title} — ${x.summary}`); });
  o.translations.forEach((t, i) => { const f = formatTranslation(t, { translation: !o.trShown?.[i] }); if (f) parts.push(f); });
  if (d.summary_en) parts.push(d.summary_en);
  if (fresh.length) parts.push(formatAlerts(fresh));
  else if (stillOpen.length) parts.push(`Still open:\n${formatAlerts(stillOpen)}`);
  const consistent = consistentTerms(facts);
  if (consistent) parts.push(consistent);
  if (!o.docs.length) {
    const key = o.saved.filter((f) => ["unit_price", "incoterm", "lead_time_days", "moq", "order_qty", "deposit_pct", "rent_amount", "security_deposit", "amount_due"].includes(f.key));
    if (key.length) parts.push(`📝 Noted: ${[...new Map(key.map((f) => [f.key, `${factLabel(f.key).replace(/ \(.*\)/, "").toLowerCase()} ${formatValue(f.key, parseValue(f.value_json))}`])).values()].join(" · ")}`);
  }
  // every date that came in with these items (promises, deadlines, renewals from an expiry date…) is a calendar event
  const dated = o.startedAt && matterIds.length
    ? (db.prepare(`SELECT what, due_at FROM tasks WHERE workspace_id = ? AND status = 'open' AND due_at IS NOT NULL AND created_at >= ? AND matter_id IN (${matterIds.map(() => "?").join(",")}) ORDER BY due_at`).all(ws, o.startedAt, ...matterIds) as { what: string; due_at: string }[])
    : [];
  const undated = o.translations.flatMap((t) => t.tasks).concat(o.docs.flatMap((x) => x.tasks)).filter((t) => !t.due);
  const tracked = [...dated.map((t) => `${t.what} (${fmtDay(t.due_at)})`), ...undated.map((t) => t.what)];
  const subscribed = !!o.userId && calendarSubscribed(db, o.userId);
  if (tracked.length) parts.push(`⏰ Tracked: ${tracked.join("; ")}${dated.length && subscribed ? `\n📅 Already in your iPhone calendar, with reminders.` : ""}`);
  // never nudge a payment while a red flag is open on this counterparty
  const redOpen = [...fresh, ...stillOpen].some((a) => a.severity === "red");
  // applies to the model's suggestions too: no "pay the deposit" while the payee or the amount is in doubt
  const isPayment = (t: string) => /\b(pay|paying|payment|deposit|transfer|wire)\b|付款|转账|押金|定金/i.test(t);
  const steps = [
    ...(redOpen ? [canReplyTo(e.kind) ? "Don't pay or sign until the red flags are cleared — send the reply below." : "Don't pay until the red flags are cleared."] : []),
    ...(d.next_steps.length ? d.next_steps : openTasks).filter((t) => !(redOpen && isPayment(t))),
  ];
  if (steps.length) parts.push(`👉 Next:\n${steps.slice(0, 3).map((s) => `• ${s}`).join("\n")}`);
  if (missingLicense) parts.push(`⚠️ ${e.label} hasn't sent a business license yet.`);
  if (canReplyTo(e.kind) && d.reply_zh) parts.push(`💬 Suggested reply (copy and send):\n${d.reply_zh}`);
  parts.push(detailsLine(matters.length === 1 ? "m" : "e", matters.length === 1 ? matters[0].id : entityId));
  const linkable = canReplyTo(e.kind) && matters.some((m) => termChoices(db, m.id).length || missingDocs(db, m).length);
  return {
    kind: "menu", text: parts.join("\n\n"), prompt: "Anything to fix?",
    buttons: [...(dated.length && !subscribed ? [{ id: "cal:add", label: "📅 Add to iPhone calendar" }] : []), ...analysisButtons(asgId, { link: linkable })],
    ...(canReplyTo(e.kind) && d.reply_zh ? { copy: { label: COPY_LABEL, text: d.reply_zh } } : {}),
  };
}

async function resolvePendingWithEntity(db: DB, ws: string, pend: PendingRow, entityId: string, prefix?: string, matterId?: string): Promise<OutgoingReply[]> {
  const st = JSON.parse(pend.clues_json || "{}") as PendingState;
  const msgs = loadMsgs(db, JSON.parse(pend.message_ids));
  db.prepare(`UPDATE pending_groups SET status = 'resolved' WHERE id = ?`).run(pend.id);
  if (st.moveFrom) {
    const moved = unassign(db, msgs, st.moveFrom.assignmentId);
    const replies = await assign(db, ws, pend.user_id, loadMsgs(db, msgs.map((m) => m.id)), entityId, st.clues ?? [], "user_choice", `↪️ Moved from ${moved}.`, matterId);
    return replies;
  }
  return assign(db, ws, pend.user_id, msgs, entityId, st.clues ?? [], "user_choice", prefix, matterId);
}

/** Undo an assignment: derived facts, tasks, aliases and empty new matters go; raw messages and documents stay. */
function unassign(db: DB, msgs: MsgRow[], assignmentId: string): string {
  const from = msgs[0]?.entity_id ? getEntity(db, msgs[0].entity_id) : undefined;
  const ids = msgs.map((m) => m.id);
  const q = ids.map(() => "?").join(",");
  const a = db.prepare(`SELECT clues_json FROM pending_groups WHERE id = ?`).get(assignmentId) as { clues_json: string } | undefined;
  const st = a ? (JSON.parse(a.clues_json) as { learnedAliasIds?: number[]; createdMatters?: string[] }) : {};
  db.transaction(() => {
    const docIds = (db.prepare(`SELECT id FROM documents WHERE message_id IN (${q})`).all(...ids) as { id: string }[]).map((d) => d.id);
    db.prepare(`DELETE FROM facts WHERE source_message_id IN (${q})`).run(...ids);
    db.prepare(`DELETE FROM tasks WHERE source_message_id IN (${q})`).run(...ids);
    for (const d of docIds) db.prepare(`DELETE FROM tasks WHERE source_document_id = ? OR source_rule = ?`).run(d, `renewal:${d}`);
    db.prepare(`UPDATE documents SET entity_id = NULL, matter_id = NULL WHERE message_id IN (${q})`).run(...ids);
    db.prepare(`UPDATE messages SET entity_id = NULL, matter_id = NULL, status = 'pending' WHERE id IN (${q})`).run(...ids);
    if (st.learnedAliasIds?.length) db.prepare(`DELETE FROM entity_aliases WHERE id IN (${st.learnedAliasIds.map(() => "?").join(",")})`).run(...st.learnedAliasIds);
    for (const mid of st.createdMatters ?? [])
      if (!db.prepare(`SELECT 1 FROM messages WHERE matter_id = ? UNION SELECT 1 FROM facts WHERE matter_id = ?`).get(mid, mid)) db.prepare(`DELETE FROM matters WHERE id = ?`).run(mid);
    if (from && !db.prepare(`SELECT 1 FROM documents WHERE entity_id = ? AND doc_type = 'business_license'`).get(from.id)) {
      const movedLicense = docIds.length && db.prepare(`SELECT 1 FROM documents WHERE id IN (${docIds.map(() => "?").join(",")}) AND doc_type = 'business_license'`).get(...docIds);
      if (movedLicense) db.prepare(`UPDATE entities SET credit_code = NULL, registry_status = 'unknown' WHERE id = ?`).run(from.id);
    }
  })();
  return from ? entityLabel(from) : "the previous place";
}

// ── menu taps (prefixes: ent: mat: chg: agr: int:, and sup: from blueprint §5.8) ──
async function handleMenu(db: DB, ws: string, userId: string, menuId: string): Promise<OutgoingReply[]> {
  const [rawPrefix, ...rest] = menuId.split(":");
  const prefix = rawPrefix === "sup" ? "ent" : rawPrefix;
  const arg = rest.join(":");
  const pend = openPending(db, userId);

  if (prefix === "ent") {
    if (!pend || pend.awaiting !== "entity_choice") return [{ kind: "text", text: "That question has already been answered." }];
    if (arg === "skip") {
      db.prepare(`UPDATE pending_groups SET status = 'skipped' WHERE id = ?`).run(pend.id);
      for (const id of JSON.parse(pend.message_ids) as string[]) db.prepare(`UPDATE messages SET status = 'skipped' WHERE id = ? AND status = 'pending'`).run(id);
      return [{ kind: "text", text: "OK — not saved. The translation above is all I keep." }];
    }
    if (arg === "new") {
      const st = JSON.parse(pend.clues_json) as PendingState;
      if (st.newName) {
        const named = st.clues.filter((c) => c.strong && c.kind === "legal_name");
        const zh = named.find((c) => /[一-鿿]/.test(c.value))?.value, en = named.find((c) => !/[一-鿿]/.test(c.value))?.value;
        const kind = st.newKind ?? kindForRole(named[0]?.role, named[0]?.partyKind);
        const e = createEntity(db, ws, { kind, display_name: en ?? st.newName, legal_name_zh: zh ?? null, legal_name_en: en ?? null });
        return resolvePendingWithEntity(db, ws, pend, e.id, `➕ Created ${entityLabel(e)} (${ENTITY_KINDS[kind].label.toLowerCase()}).`);
      }
      db.prepare(`UPDATE pending_groups SET awaiting = 'new_entity_name' WHERE id = ?`).run(pend.id);
      return [{ kind: "text", text: "What do you want to call them? (e.g. \"Guangzhou DEF\")" }];
    }
    if (!getEntity(db, arg) || getEntity(db, arg)!.workspace_id !== ws) return [{ kind: "text", text: "I don't know that contact any more. Pick another one." }];
    return resolvePendingWithEntity(db, ws, pend, arg);
  }

  if (prefix === "mat") {
    if (!pend || pend.awaiting !== "matter_choice") return [{ kind: "text", text: "That question has already been answered." }];
    const st = JSON.parse(pend.clues_json) as PendingState;
    const e = getEntity(db, st.entityId!)!;
    let matterId = arg;
    if (arg === "new") {
      const first = extractedOf(loadMsgs(db, JSON.parse(pend.message_ids))[0]);
      matterId = createMatter(db, ws, { kind: matterKindFor(first, e.kind), entityId: e.id, entityName: e.display_name, subject: subjectOf(first) }).id;
    }
    return resolvePendingWithEntity(db, ws, pend, e.id, undefined, matterId);
  }

  if (prefix === "chg") {
    const asg = db.prepare(`SELECT * FROM pending_groups WHERE id = ? AND awaiting = 'assignment'`).get(arg) as PendingRow | undefined;
    if (!asg) return [{ kind: "text", text: "I can't find that item any more." }];
    const msgs = loadMsgs(db, JSON.parse(asg.message_ids));
    const current = msgs[0]?.entity_id;
    if (pend) db.prepare(`UPDATE pending_groups SET status = 'skipped' WHERE id = ?`).run(pend.id); // never two menus
    const others = listEntities(db, ws).filter((e) => e.id !== current);
    db.prepare(`INSERT INTO pending_groups (id, user_id, message_ids, candidate_ids, clues_json, awaiting, menu_sent_at, status) VALUES (?,?,?,?,?,?,?,'open')`)
      .run(newId("pg"), userId, asg.message_ids, JSON.stringify(others.map((e) => e.id)), JSON.stringify({ clues: JSON.parse(asg.clues_json).clues ?? [], moveFrom: { assignmentId: asg.id } } satisfies PendingState), "entity_choice", nowIso());
    return [{ kind: "menu", text: `Who should these ${describeItems(msgs)} go to?`, buttons: [...others.slice(0, 4).map((e) => ({ id: `ent:${e.id}`, label: entityLabel(e) })), { id: "ent:new", label: "➕ Someone new" }, { id: "ent:skip", label: "🚫 Don't save" }] }];
  }

  if (prefix === "agr") return markAgreed(db, ws, arg);

  if (prefix === "cal") return [calendarReply(db, userId)];

  if (prefix === "tdel") {
    const t = db.prepare(`SELECT what FROM tasks WHERE id = ? AND workspace_id = ? AND status = 'open'`).get(Number(arg), ws) as { what: string } | undefined;
    if (!t) return [{ kind: "text", text: "Already removed." }];
    db.prepare(`UPDATE tasks SET status = 'cancelled' WHERE id = ?`).run(Number(arg));
    return [{ kind: "text", text: `↩️ Removed from your calendar: ${t.what}` }];
  }

  if (prefix === "zh") {
    // the clean Chinese bubble: nothing but the text to forward
    const d = db.prepare(`SELECT text_original FROM messages WHERE id = ? AND workspace_id = ? AND direction = 'out'`).get(arg, ws) as { text_original: string } | undefined;
    return d ? [{ kind: "text", text: d.text_original, copy: { label: COPY_LABEL, text: d.text_original } }] : [{ kind: "text", text: "I can't find that reply any more." }];
  }

  if (prefix === "lnk") {
    // lnk:<assignment id> (from an analysis) or lnk:m:<matter id> (from the /link menu)
    let matterId: string | undefined;
    if (arg.startsWith("m:")) matterId = arg.slice(2);
    else {
      const asg = db.prepare(`SELECT clues_json FROM pending_groups WHERE id = ? AND awaiting = 'assignment'`).get(arg) as { clues_json: string } | undefined;
      matterId = asg ? (JSON.parse(asg.clues_json).matterIds as string[] | undefined)?.find((id) => { const m = getMatter(db, id); return m && canReplyTo(m.entity_id ? getEntity(db, m.entity_id)?.kind : null); }) : undefined;
    }
    const m = matterId ? getMatter(db, matterId) : undefined;
    if (!m || m.workspace_id !== ws) return [{ kind: "text", text: "I can't find that matter any more." }];
    return confirmLinkReplies(db, userId, m.id);
  }

  if (prefix === "int") {
    if (!pend || pend.awaiting !== "intent_choice") return [{ kind: "text", text: "That question has already been answered." }];
    db.prepare(`UPDATE pending_groups SET status = 'resolved' WHERE id = ?`).run(pend.id);
    const msgs = loadMsgs(db, JSON.parse(pend.message_ids));
    if (arg === "question") { setStatus(db, msgs, "question", "skipped"); return [answerReply((await ask(db, ws, msgs.map((m) => m.text_original).join("\n"))).text)]; }
    setStatus(db, msgs, "content", "pending");
    return processContent(db, ws, userId, msgs);
  }
  return [{ kind: "text", text: "I didn't understand that button." }];
}

/** D5: a term is "agreed" only when the user says so. Terms that are evidence of an open alert are skipped. */
function markAgreed(db: DB, ws: string, assignmentId: string): OutgoingReply[] {
  const asg = db.prepare(`SELECT * FROM pending_groups WHERE id = ? AND awaiting = 'assignment'`).get(assignmentId) as PendingRow | undefined;
  if (!asg) return [{ kind: "text", text: "Nothing to mark as agreed." }];
  const ids = JSON.parse(asg.message_ids) as string[];
  const flagged = new Set(openAlerts(db, { workspaceId: ws }).flatMap((a) => JSON.parse(a.evidence_fact_ids || "[]") as number[]));
  const negotiable = ["unit_price", "moq", "order_qty", "incoterm", "port", "lead_time_days", "payment_terms", "deposit_pct", "product_model", "tooling_fee", "sample_fee", "rent_amount", "security_deposit", "rent_due_day", "salary_amount", "total_amount"];
  const facts = (db.prepare(`SELECT * FROM facts WHERE source_message_id IN (${ids.map(() => "?").join(",")}) AND status = 'proposed'`).all(...ids) as FactRow[]).filter((f) => negotiable.includes(f.key));
  const ok = facts.filter((f) => !flagged.has(f.id));
  for (const f of ok) {
    db.prepare(`UPDATE facts SET status = 'proposed' WHERE matter_id IS ? AND key = ? AND status = 'agreed'`).run(f.matter_id, f.key); // one agreed value per key
    db.prepare(`UPDATE facts SET status = 'agreed' WHERE id = ?`).run(f.id);
  }
  const skipped = facts.length - ok.length;
  if (!ok.length) return [{ kind: "text", text: skipped ? "Nothing marked: every term here is part of an open red flag. Clear those first." : "No negotiable terms in that item." }];
  return [{ kind: "text", text: `✅ Marked as agreed: ${ok.map((f) => `${factLabel(f.key).replace(/ \(.*\)/, "").toLowerCase()} ${formatValue(f.key, parseValue(f.value_json))}`).join(" · ")}${skipped ? `\n(${skipped} term${skipped > 1 ? "s" : ""} with an open red flag left as proposed.)` : ""}` }];
}

// ── quick commands (§8.3) ──
async function handleCommand(db: DB, ws: string, userId: string, cmd: string, raw: string): Promise<OutgoingReply[]> {
  if (cmd === "/suppliers" || cmd === "/contacts") {
    const kinds = cmd === "/suppliers" ? (["supplier"] as EntityKind[]) : undefined;
    const ents = listEntities(db, ws, { kinds });
    if (!ents.length) return [{ kind: "text", text: "Nobody yet." }];
    return [{ kind: "text", text: ents.map((e) => {
      const n = openAlerts(db, { entityId: e.id }).length;
      return `${ENTITY_KINDS[e.kind].icon} ${entityLabel(e)}${n ? ` · ${n} open alert${n > 1 ? "s" : ""}` : ""}`;
    }).join("\n") }];
  }
  if (cmd === "/flags" || cmd === "/alerts") {
    const all = openAlerts(db, { workspaceId: ws });
    return [{ kind: "text", text: all.length ? all.slice(0, 12).map((a) => `${a.severity === "red" ? "🔴" : "🟡"} ${a.title}`).join("\n") : "✅ No open alerts." }];
  }
  if (cmd === "/today" || cmd === "/deadlines") {
    ensureRecurring(db, ws);
    const tasks = listTasks(db, ws, { status: "open", withinDays: cmd === "/today" ? 7 : 45 });
    const pending = (db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE workspace_id = ? AND status = 'pending' AND intent = 'content'`).get(ws) as { n: number }).n;
    const t0 = today();
    const lines = tasks.map((t) => `${t.due_at! < t0 ? "❗" : "⏰"} ${t.due_at === t0 ? "Today" : fmtDay(t.due_at!)} — ${t.what}${t.entity_label ? ` (${t.entity_label})` : ""}${t.due_at! < t0 ? " · LATE" : ""}`);
    if (pending) lines.push(`📥 ${pending} item${pending > 1 ? "s" : ""} waiting to be filed (web app → Inbox).`);
    return [{ kind: "text", text: lines.length ? lines.join("\n") : "Nothing due in the coming days." }];
  }
  if (cmd === "/link" || cmd === "/confirm") {
    const options = listMatters(db, ws, { status: ["open", "waiting"] }).filter((m) => m.entity_id && canReplyTo(getEntity(db, m.entity_id)?.kind) && (termChoices(db, m.id).length || missingDocs(db, m).length));
    if (!options.length) return [{ kind: "text", text: "No open matter with terms or missing documents to send yet. Forward a quote or a proforma first." }];
    if (options.length === 1) return confirmLinkReplies(db, userId, options[0].id);
    return [{ kind: "menu", text: "Which one should they confirm?", buttons: options.slice(0, 5).map((m) => ({ id: `lnk:m:${m.id}`, label: `${MATTER_KINDS[m.kind].icon} ${m.title}${m.entity_id ? ` – ${getEntity(db, m.entity_id)?.display_name ?? ""}` : ""}` })) }];
  }
  if (cmd === "/calendar" || cmd === "/cal") return [calendarReply(db, userId)];
  const sellerN = raw.match(/^\/seller\s*(\d+)/i);
  if (sellerN) return [{ kind: "text", text: (await ask(db, ws, `What are the current terms and open issues of Seller ${sellerN[1]}?`)).text }];
  if (cmd === "agreed") {
    const last = db.prepare(`SELECT id FROM pending_groups WHERE user_id = ? AND awaiting = 'assignment' ORDER BY menu_sent_at DESC LIMIT 1`).get(userId) as { id: string } | undefined;
    return last ? markAgreed(db, ws, last.id) : [{ kind: "text", text: "Nothing to mark as agreed yet." }];
  }
  return [{ kind: "text", text: "Commands: /today · /deadlines · /calendar · /link · /alerts · /contacts · /suppliers · /seller1 · agreed" }];
}

/** "Put it in my calendar": read the date (rules, then the model), save it as a task, say exactly what was saved.
 *  A follow-up without a date ("can we put the meeting on my calendar?") takes it from the message just before. */
async function reminderReplies(db: DB, ws: string, userId: string, text: string, msgs: MsgRow[]): Promise<OutgoingReply[]> {
  let source = text;
  let draft = await readReminder(text);
  if (!draft) {
    const prev = db.prepare(`SELECT id, text_original FROM messages WHERE user_id = ? AND direction = 'in' AND kind IN ('text','voice') AND id NOT IN (${msgs.map(() => "?").join(",")}) AND received_at >= ? AND text_original IS NOT NULL ORDER BY received_at DESC LIMIT 1`)
      .get(userId, ...msgs.map((m) => m.id), new Date(Date.now() - 20 * 60_000).toISOString()) as { id: string; text_original: string } | undefined;
    const done = prev && (db.prepare(`SELECT what, due_at FROM tasks WHERE source_message_id = ? AND status = 'open'`).get(prev.id) as { what: string; due_at: string } | undefined);
    if (done) return [{ kind: "text", text: `📅 Already added: ${done.what} (${fmtDay(done.due_at)}).${calendarSubscribed(db, userId) ? "" : " Send /calendar to see it in your iPhone calendar."}` }];
    if (prev) { draft = await readReminder(prev.text_original); source = prev.text_original; }
  }
  if (!draft) return [{ kind: "text", text: "📅 Which day? Write it like: \"Meeting with Seller 1 on Dec 25 at 3pm\" or \"Remind me to pay the deposit on Friday\"." }];
  const saved = saveReminder(db, ws, draft, source, msgs[0]?.id ?? null);
  const what = (db.prepare(`SELECT what FROM tasks WHERE id = ?`).get(saved.taskId) as { what: string }).what;
  const day = new Date(`${draft.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const subscribed = calendarSubscribed(db, userId);
  return [{
    kind: "menu",
    text: `📅 Added: ${what}\n🗓 ${day}${draft.time ? ` · ${draft.time}` : ""}\n${subscribed ? "It shows up in your iPhone calendar within the hour, with reminders." : "Saved in Deadlines. To see it in your iPhone calendar too, tap below once."}`,
    prompt: "Wrong date? Undo and send it again.",
    buttons: [...(subscribed ? [] : [{ id: "cal:add", label: "📅 Add to iPhone calendar" }]), { id: `tdel:${saved.taskId}`, label: "↩️ Undo" }],
  }];
}

/** Subscribe once and every date Memini finds lands in the iPhone Calendar by itself. WeChat's browser can't add
 *  calendars, so the page asks to switch to Safari — once, not for every date. */
function calendarReply(db: DB, userId: string): OutgoingReply {
  const page = calendarPageUrl(userToken(db, userId, "calendar"));
  if (calendarSubscribed(db, userId))
    return { kind: "text", text: `📅 Your iPhone calendar is already subscribed: every date I find shows up there by itself, with reminders.\n(Another phone? ${page})` };
  return { kind: "text", text: `📅 Put every date I find in your iPhone Calendar — once, and from then on it's automatic, with reminders:\n${page}\n\n1. Open the link, tap ··· (top right) → Open in Safari\n2. Tap "Add to Calendar" → Subscribe → Add` };
}

/** Create a confirmation link and answer with (1) what's on it and (2) the Chinese message to forward, alone. */
function confirmLinkReplies(db: DB, userId: string, matterId: string): OutgoingReply[] {
  try {
    const r = createConfirmLink(db, { userId, matterId });
    const m = getMatter(db, matterId)!;
    const docs = (JSON.parse(r.link.docs_json) as DocType[]).map((d) => DOC_TYPES[d].label);
    const lines = [
      `🔗 Confirmation page for ${r.snapshot.counterparty || "them"} · ${m.title}`,
      r.snapshot.terms.length ? `They'll confirm:\n${r.snapshot.terms.map((t) => `• ${t.en}: ${t.value_en}`).join("\n")}` : "",
      docs.length ? `They can upload: ${docs.join(", ")}` : "",
      `Valid until ${fmtDay(r.link.expires_at.slice(0, 10))}. I'll tell you when they answer.\n👇 Send them the next message on WeChat (long-press → Forward, or Copy).`,
    ].filter(Boolean);
    return [{ kind: "text", text: lines.join("\n\n") }, { kind: "text", text: r.message_zh, copy: { label: COPY_LABEL, text: r.message_zh } }];
  } catch (e) {
    return [{ kind: "text", text: e instanceof Error ? e.message : "Couldn't create the link." }];
  }
}

function welcome(profile: string): OutgoingReply {
  if (profile === "electronics") return { kind: "text", text: SPEC_WELCOME };
  const business = profileOf(profile) === profileOf("china_business");
  return {
    kind: "text",
    text: business
      ? "👋 I'm Memini, your assistant for doing business in China.\n\nForward me anything — supplier messages, contracts, tax notices, your permit, a landlord's chat. I'll translate it, file it under the right matter, check it against what you already have, and track every deadline.\n\nTry: \"What's due this month?\", \"Any problems with my lease?\" or \"Meeting with Seller 1 on Dec 25 at 3pm, put it in my calendar\""
      : "👋 I'm Memini, your China sourcing analyst.\n\nForward me a supplier's message, PDF or business license — I'll translate it, check it against everything they said before, and draft a Chinese reply.\n\nTry: \"What did Seller 2 quote me?\"",
  };
}

// ── web helpers (inbox page) ──
export function listPendingItems(db: DB, ws: string) {
  return db.prepare(`SELECT * FROM messages WHERE workspace_id = ? AND status = 'pending' AND intent = 'content' ORDER BY received_at DESC`).all(ws) as MsgRow[];
}

/** Web "Inbox" picker: file items under a counterparty (existing or new). Works whether or not a WeChat menu is open. */
export async function assignFromWeb(db: DB, ws: string, userId: string, messageIds: string[], target: { entityId?: string; newName?: string; newKind?: EntityKind }): Promise<OutgoingReply[]> {
  const msgs = loadMsgs(db, messageIds).filter((m) => m.status === "pending" && m.workspace_id === ws);
  if (!msgs.length) return [];
  let entityId = target.entityId;
  if (!entityId || entityId === "new") entityId = createEntity(db, ws, { kind: target.newKind ?? "supplier", display_name: target.newName?.trim() || "New contact" }).id;
  else if (getEntity(db, entityId)?.workspace_id !== ws) throw new Error("unknown entity");
  const clues = msgs.flatMap((m) => { const x = extractedOf(m); return x ? cluesOf(m, x) : []; });
  for (const p of db.prepare(`SELECT * FROM pending_groups WHERE status = 'open' AND user_id = ?`).all(userId) as PendingRow[]) {
    const left = (JSON.parse(p.message_ids) as string[]).filter((id) => !messageIds.includes(id));
    if (!left.length) db.prepare(`UPDATE pending_groups SET status = 'resolved' WHERE id = ?`).run(p.id);
    else db.prepare(`UPDATE pending_groups SET message_ids = ? WHERE id = ?`).run(JSON.stringify(left), p.id);
  }
  return assign(db, ws, userId, msgs, entityId, clues, "user_choice");
}

export function skipFromWeb(db: DB, ws: string, messageIds: string[]) {
  for (const id of messageIds) db.prepare(`UPDATE messages SET status = 'skipped' WHERE id = ? AND workspace_id = ?`).run(id, ws);
}

export { matterChecklist };
