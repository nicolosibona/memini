// SQLite memory — generic model (blueprint §4 generalized):
//   entities (any counterparty, including yourself) · matters (cases) · documents · facts · tasks (deadlines) · alerts
// Tests call openDb(":memory:"); the app uses getDb() (DB_PATH, default ./storage/memini.db).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

export const DEMO_WORKSPACE = "ws_demo";
export const DEMO_USER = "usr_demo";
/** Bumped by MIGRATIONS below. Versions before BASELINE_VERSION were hackathon builds and are rebuilt from scratch;
 *  from BASELINE_VERSION on, changes are additive only (new tables, new columns) — production data is never dropped. */
const BASELINE_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT,
  profile TEXT DEFAULT 'china_business',      -- sourcing | china_business (domain.ts PROFILES)
  own_names TEXT,                             -- JSON: your company/people names, never matched as a counterparty
  reply_language TEXT DEFAULT 'en', created_at TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, workspace_id TEXT, email TEXT, wecom_external_userid TEXT UNIQUE, created_at TEXT
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY, workspace_id TEXT, kind TEXT,          -- domain.ts ENTITY_KINDS
  label TEXT, display_name TEXT, legal_name_zh TEXT, legal_name_en TEXT,
  credit_code TEXT, id_number TEXT,                          -- company USCC, or person passport/ID
  registry_status TEXT, registry_checked_at TEXT, notes TEXT, last_activity_at TEXT, created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ent_code ON entities(workspace_id, credit_code) WHERE credit_code IS NOT NULL;
CREATE TABLE IF NOT EXISTS entity_aliases (
  id INTEGER PRIMARY KEY, entity_id TEXT, kind TEXT, value_raw TEXT, value_norm TEXT, strength TEXT, source TEXT,
  times_confirmed INTEGER DEFAULT 1, created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_alias_norm ON entity_aliases(value_norm);
CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, entity_id TEXT, name TEXT, role TEXT, wechat_nickname TEXT, phone TEXT);
CREATE TABLE IF NOT EXISTS matters (
  id TEXT PRIMARY KEY, workspace_id TEXT, kind TEXT,          -- domain.ts MATTER_KINDS
  title TEXT, subject TEXT, subject_norm TEXT,               -- what it is about: product, person, property…; subject_norm groups comparable matters
  status TEXT,                                               -- open | waiting | done | archived
  entity_id TEXT,                                            -- main counterparty (supplier, landlord, tax office…)
  target_date TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, channel TEXT, external_msgid TEXT UNIQUE, group_id TEXT, direction TEXT,
  kind TEXT, intent TEXT, original_author TEXT, text_original TEXT, text_translated TEXT, file_path TEXT,
  entity_id TEXT, matter_id TEXT, status TEXT, received_at TEXT, extracted_json TEXT
);
CREATE INDEX IF NOT EXISTS ix_msg_group ON messages(group_id);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, workspace_id TEXT, message_id TEXT, entity_id TEXT, matter_id TEXT, doc_type TEXT, title TEXT,
  extracted_json TEXT, doc_date TEXT, expires_at TEXT, file_path TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY, workspace_id TEXT, entity_id TEXT, matter_id TEXT, key TEXT, value_json TEXT,
  said_by TEXT,            -- counterparty | me | document | registry | user_report
  source_type TEXT,        -- chat | voice | document | registry | manual
  source_doc_type TEXT, source_message_id TEXT, source_document_id TEXT,
  quote_original TEXT, quote_translated TEXT, stated_at TEXT,
  status TEXT,             -- proposed | agreed | superseded | disputed | rejected
  confidence REAL, created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_facts ON facts(entity_id, key, stated_at);
CREATE INDEX IF NOT EXISTS ix_facts_matter ON facts(matter_id, key);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, workspace_id TEXT, entity_id TEXT, matter_id TEXT,
  kind TEXT, who TEXT, what TEXT, due_at TEXT,
  source_message_id TEXT, source_document_id TEXT, source_rule TEXT,   -- source_rule: derived deadlines (e.g. renewal:<doc id>)
  status TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY, workspace_id TEXT, entity_id TEXT, matter_id TEXT, severity TEXT, code TEXT, title TEXT, detail TEXT,
  evidence_fact_ids TEXT, dedupe_key TEXT, status TEXT, created_at TEXT, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS pending_groups (
  id TEXT PRIMARY KEY, user_id TEXT, message_ids TEXT, candidate_ids TEXT, clues_json TEXT, awaiting TEXT, menu_sent_at TEXT, status TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(ref_type, ref_id, workspace_id, entity_id, matter_id, text, tokenize = 'trigram');
CREATE TABLE IF NOT EXISTS wecom_state (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY, step TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
  est_cost_usd REAL, ms INTEGER, source TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id TEXT PRIMARY KEY, workspace_id TEXT, matter_id TEXT,
  target_price REAL, currency TEXT, target_quantity INTEGER,
  preferred_incoterm TEXT, max_lead_time_days INTEGER, deadline TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS outreach_recipients (
  id TEXT PRIMARY KEY, campaign_id TEXT, contact_id TEXT, token TEXT UNIQUE,
  status TEXT, chinese_message TEXT, filter_reason TEXT, quote_document_id TEXT,
  supplier_matter_id TEXT, submitted_quote_json TEXT, responded_at TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_outreach_campaign ON outreach_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS ix_outreach_token ON outreach_recipients(token);
-- long-lived secret URLs for the user's own feeds: purpose 'calendar' (iOS subscription) | 'email' (forwarding address)
CREATE TABLE IF NOT EXISTS inbound_tokens (
  token TEXT PRIMARY KEY, user_id TEXT, workspace_id TEXT, purpose TEXT, created_at TEXT, revoked_at TEXT, last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_inbound_user ON inbound_tokens(user_id, purpose);
-- a page sent to a counterparty (no login): confirm the terms of a matter and/or upload missing documents
CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, matter_id TEXT, entity_id TEXT,
  terms_json TEXT, terms_hash TEXT, docs_json TEXT, contact_name TEXT,
  status TEXT,             -- open | confirmed | changes_requested | revoked
  created_at TEXT, expires_at TEXT, opened_at TEXT, open_count INTEGER DEFAULT 0, upload_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_share_matter ON share_links(matter_id);
-- what the counterparty answered: append-only (triggers below), with the exact terms shown and their hash
CREATE TABLE IF NOT EXISTS confirmations (
  id INTEGER PRIMARY KEY, link_token TEXT, workspace_id TEXT, matter_id TEXT, entity_id TEXT,
  action TEXT,             -- confirmed | changes_requested | uploaded
  terms_json TEXT, terms_hash TEXT, note TEXT, message_id TEXT, ip TEXT, user_agent TEXT, created_at TEXT
);
-- electronics spec check: one check = our requirement + what the supplier sent, compared line by line (lib/core/spec)
CREATE TABLE IF NOT EXISTS spec_checks (
  id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, title TEXT, part_name TEXT, part_number TEXT, supplier_name TEXT,
  status TEXT,             -- open | closed
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_spec_user ON spec_checks(user_id, status, updated_at);
CREATE TABLE IF NOT EXISTS spec_items (
  id TEXT PRIMARY KEY, check_id TEXT, message_id TEXT, ord INTEGER,
  side TEXT,               -- requirement | supplier
  kind TEXT, title TEXT, author TEXT, file_path TEXT, text_original TEXT, extracted_json TEXT, source TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_spec_items ON spec_items(check_id, ord);
CREATE TRIGGER IF NOT EXISTS confirmations_no_update BEFORE UPDATE ON confirmations BEGIN SELECT RAISE(ABORT, 'confirmations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS confirmations_no_delete BEFORE DELETE ON confirmations
  WHEN (SELECT v FROM wecom_state WHERE k = 'allow_reset') IS NOT 'yes' BEGIN SELECT RAISE(ABORT, 'confirmations are immutable'); END;
`;

/** Additive migrations, applied once each, in order. Never drop or rewrite user data here. */
const MIGRATIONS: ((db: DB) => void)[] = [
  // 3: share links, confirmations, inbound tokens — created by SCHEMA (CREATE IF NOT EXISTS); nothing to alter
  () => {},
  // 4: electronics spec checks (spec_checks, spec_items) — created by SCHEMA; nothing to alter
  () => {},
];
const SCHEMA_VERSION = BASELINE_VERSION + MIGRATIONS.length;

/** ALTER TABLE … ADD COLUMN, only if the column is missing (for future migrations). */
export function ensureColumn(db: DB, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`);
}

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  let v = db.pragma("user_version", { simple: true }) as number;
  if (v > 0 && v < BASELINE_VERSION) {
    // pre-baseline hackathon build: rebuild (keeps WeChat cursor/token)
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index_%' AND name != 'wecom_state'`).all() as { name: string }[];
    for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    v = 0;
  }
  db.exec(SCHEMA);
  if (v === 0) v = BASELINE_VERSION; // fresh database: SCHEMA already has everything up to the baseline
  db.transaction(() => {
    for (let i = v - BASELINE_VERSION; i < MIGRATIONS.length; i++) MIGRATIONS[i](db);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
  seedBase(db);
  return db;
}

/** The fixed demo workspace + user (D11: single user for the hackathon). */
function seedBase(db: DB) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO workspaces (id, name, profile, own_names, reply_language, created_at) VALUES (?, ?, 'china_business', ?, 'en', ?)`).run(
    DEMO_WORKSPACE, "Demo workspace", JSON.stringify(["Nordlys Home Goods ApS", "Nordlys Trading (Shanghai) Co., Ltd.", "诺德利斯（上海）贸易有限公司", "Alex Morgan"]), now,
  );
  db.prepare(`INSERT OR IGNORE INTO users (id, workspace_id, email, created_at) VALUES (?, ?, ?, ?)`).run(DEMO_USER, DEMO_WORKSPACE, "demo@memini.local", now);
}

const g = globalThis as unknown as { __meminiDb?: DB };
export function getDb(): DB {
  if (!g.__meminiDb) g.__meminiDb = openDb(process.env.DB_PATH ?? "./storage/memini.db");
  return g.__meminiDb;
}

export const nowIso = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
/** Calendar dates follow the business's clock (China by default): "by Friday" means Friday in Shanghai. */
export const TZ = process.env.APP_TIMEZONE ?? "Asia/Shanghai";
export const localDate = (iso: string | Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
export const today = () => localDate();
/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date */
export const weekdayOf = (ymd: string) => new Date(`${ymd.slice(0, 10)}T12:00:00Z`).getUTCDay();
export const addDays = (isoDate: string, days: number) => new Date(+new Date(isoDate.slice(0, 10)) + days * 86400000).toISOString().slice(0, 10);
