// SQLite memory — generic model (blueprint §4 generalized):
//   entities (any counterparty, including yourself) · matters (cases) · documents · facts · tasks (deadlines) · alerts
// Tests call openDb(":memory:"); the app uses getDb() (DB_PATH, default ./storage/memini.db).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

export const DEMO_WORKSPACE = "ws_demo";
export const DEMO_USER = "usr_demo";
const SCHEMA_VERSION = 2;

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
`;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  const v = db.pragma("user_version", { simple: true }) as number;
  if (v !== SCHEMA_VERSION) {
    // hackathon: no production data yet → rebuild on schema change (keeps WeChat cursor/token)
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index_%' AND name != 'wecom_state'`).all() as { name: string }[];
    for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
  db.exec(SCHEMA);
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
