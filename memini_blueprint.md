# Memini — Final Blueprint

*Product renamed from ChopCheck to Memini on 2026-11-21 (D1). The scope also widened from sourcing to doing business in China: contacts, matters, documents, deadlines (see README).*

*Version 3 (final, ready to build) — 2026-11-20.*
*Replaces every earlier version: the "WeChat Deal & Trust Copilot" blueprint, "Supplier Identification" spec v1, and blueprint v2.*

**How to read this document**
- §1–§3: what we build and how it fits together.
- §4–§9: detailed specs (memory, supplier identification, WeChat, audit, assistant, web app).
- §10–§12: code layout, extraction schemas, security.
- §13: **WeChat setup, step by step** (do this first).
- §14–§15: build plan and demo.
- §16: **open product decisions** (each has a default so nobody is blocked).
- §17: things we can only confirm by testing against the real WeChat API and the API gateway.
- §19: **which AI model for which step**, costs, and how to split the API keys.

Markers used throughout: **[VERIFY]** = must be confirmed with a real test (listed again in §17). **[OPEN]** = product decision still open (listed in §16, with the default we build until decided).

---

## 1. Product

**One line:** your bilingual China sourcing analyst. It remembers every promise, checks every document, and protects you before you wire money. You use it from a web app or straight from WeChat.

**Problem:** discovery tools (e.g. Accio) help foreign buyers *find* suppliers. After that, the negotiation moves to WeChat: Mandarin voice notes, Chinese PDFs, business licenses, certificates, bank details, polite phrases that actually mean "no". This is where buyers lose money, and no tool covers it.

**Product = one brain, two surfaces:**

```text
   ┌──────────────────────────┐            ┌──────────────────────────┐
   │         WEB APP          │            │    WECHAT BOT (微信客服)    │
   │ bulk-upload documents,   │            │ forward supplier messages,│
   │ see everything, compare, │            │ photos, PDFs; ask any     │
   │ correct, ask questions   │            │ question; get Chinese     │
   │                          │            │ reply drafts              │
   └────────────┬─────────────┘            └─────────────┬────────────┘
                └──────────────┬─────────────────────────┘
                               ▼
        ┌──────────────────────────────────────────────────┐
        │ CORE: Ingest → Intent → Supplier → Facts → Audit  │
        │       → Reply      +      Q&A Assistant           │
        └──────────────────────────┬───────────────────────┘
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │ STRUCTURED MEMORY (single source of truth)        │
        │ suppliers · aliases · documents · messages ·      │
        │ FACTS · red flags · commitments · pending groups  │
        └──────────────────────────────────────────────────┘
```

Anything that comes in on one surface is immediately visible on the other. The same question gets the same answer on WeChat and in the web app.

### What the user can do
1. **Forward** to the bot anything a supplier sends (text, photos, PDFs, merged chats; voice notes: see §6.4) → translation, cultural subtext, cross-document audit, a ready-to-send Chinese reply.
2. **Ask** anything about their business, on WeChat or in the web app:
   - "What did Seller 2 quote me for 1,000 units?"
   - "Which charger supplier has the shortest lead time?"
   - "Any open issues with ABC before I pay the deposit?"
   - "What did Lisa promise me last week?"
   - "Write me a polite follow-up in Chinese about the sample."
3. **Upload** documents in bulk in the web app → classified, assigned to suppliers, analyzed.
4. **See** all suppliers side by side: terms with history, document checklist, red flags, timeline, items "To be assigned".
5. **Correct** anything (wrong supplier, badly extracted fact, false alarm). Memory learns from corrections.

**What the bot never does:** message suppliers on its own, make payments, give legal advice. It drafts; the user sends.

---

## 2. Design principles

1. **Never guess the supplier.** If it isn't certain, ask (menu on WeChat, picker in the web app).
2. **Every fact has a source.** Nothing enters memory without: originating message/document, original quote, date, who said it.
3. **Never overwrite.** A new price sits next to the old one. "Current terms" is a computed view.
4. **Deterministic where possible, LLM where needed.** Comparing Incoterms, prices, names, credit codes, dates = code (unit-tested). Translation, subtext, extraction from images, natural-language answers = LLM.
5. **Answers cite sources.** "Agreed price: USD 4.20 (voice note, Nov 18)."
6. **The channel is swappable.** The core doesn't know if input came from WeChat, the web app or the simulator.
7. **The demo never dead-ends.** Every LLM call has a timeout and a saved fallback answer for the demo data.

---

## 3. Architecture

```text
[User's personal WeChat]
   │ forward / question / menu tap
   ▼
[WeCom 微信客服] ──callback (event only)──► POST /api/wecom/callback
                                            │ verify signature + AES-decrypt
                                            │ reply "success" at once
                                            ▼ (background, Next.js after())
                                    sync_msg(cursor, token) → messages
                                            │
[Web app] ── POST /api/ingest (upload) ─────┤
[Web app] ── POST /api/ask    (chat) ───────┤
[Simulator] ── POST /api/sim ───────────────┤
                                            ▼
┌───────────────────────────────── CORE ─────────────────────────────────┐
│ 1. Ingest: store raw, download media (media/get), dedupe by msgid       │
│ 2. Group: 6 s debounce per user → one "group"                           │
│ 3. Normalize: voice→ASR · image/PDF→vision extraction · text cleanup    │
│ 4. Intent: content / question / command / menu tap (§6.5)               │
│ 5a. Content → supplier resolution (§5) → facts (§4.5) → audit (§7)      │
│     → reply (§6.6)                                                      │
│ 5b. Question → assistant with tools over memory (§8) → reply            │
└────────────────────────────────────┬───────────────────────────────────┘
                                     ▼
                     [SQLite + FTS5]   [disk: storage/files]
                                     │
                                     ▼
                  send_msg (text / msgmenu / link to web app)
```

The server must be a **long-running Node process** (`next start` on a VPS), not serverless: the debounce timers, the `sync_msg` cursor and WeCom's trusted IP all assume one fixed machine.

### Stack

| Layer | Choice | Notes |
|---|---|---|
| App + API | **Next.js 15** (App Router, route handlers), TypeScript, Tailwind | Already scaffolded in this repo. |
| Validation | **Zod** | Every LLM output validated. |
| LLM | `lib/adapters/llm.ts` (kept from the old repo) + a `gateway` provider for our API keys; model per step from env vars | **[OPEN] D8**, recommendation in **§19**. Extend with: PDF input, multiple images, tool use. |
| Speech-to-text | `scribe_v2` or `qwen3-omni-flash` via the gateway | **[OPEN] D9**, see §19.3. Convert AMR/SILK → WAV with ffmpeg first. |
| Database | **SQLite** via `better-sqlite3`, **FTS5** (trigram tokenizer, works for Chinese) | One file. Later: Postgres + pgvector. |
| Files | `storage/files/` on the server (git-ignored) | |
| WeCom crypto | Node `crypto`: SHA1 signature + AES-256-CBC, ~60 lines | Unit-test it with WeCom's sample vectors. |
| Hosting | **One VPS with a static public IP**, `next start` behind Caddy | Required by WeCom's trusted IP (§13). **Decided (D10):** Tencent Cloud Lighthouse Singapore (Ubuntu 24.04 LTS). |

---

## 4. Structured memory (the heart of the product)

### 4.1 Three layers
1. **Raw:** every message, file and transcript exactly as received. Never modified.
2. **Facts:** atomic claims extracted from raw, each with source and quote. E.g. *unit price = USD 4.20, said by Seller 1, voice note Nov 18, quote "每个4.2美金"*.
3. **Views:** computed from facts: current terms, document checklist, open flags, timeline, comparison table.

The assistant answers mainly from **facts** (precise, citable) and falls back to **full-text search** over raw.

### 4.2 Schema (SQLite)

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT,
  own_company_names TEXT,        -- JSON: the user's own company names, EXCLUDED from supplier matching
  reply_language TEXT DEFAULT 'en',   -- [OPEN] D2
  created_at TEXT
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  email TEXT,
  wecom_external_userid TEXT UNIQUE,  -- set by WeChat linking (§6.3)
  created_at TEXT
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,                -- e.g. sup_shenzhen_abc
  workspace_id TEXT REFERENCES workspaces(id),
  label TEXT,                         -- "Seller 1"
  display_name TEXT,                  -- "Shenzhen ABC Tech"
  legal_name_zh TEXT,                 -- 深圳市ABC科技有限公司
  legal_name_en TEXT,
  credit_code TEXT,                   -- 统一社会信用代码: the strongest key
  registry_status TEXT,               -- 存续 / 在业 / 注销 / 吊销 / unknown
  registry_checked_at TEXT,
  last_activity_at TEXT,
  created_at TEXT
);
CREATE UNIQUE INDEX ux_sup_code ON suppliers(workspace_id, credit_code) WHERE credit_code IS NOT NULL;

CREATE TABLE supplier_aliases (       -- clues that identify a supplier
  id INTEGER PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  kind TEXT,        -- 'credit_code' | 'legal_name' | 'name_variant' | 'wechat_nickname' | 'chat_title'
  value_raw TEXT,
  value_norm TEXT,  -- normalized (§5.3)
  strength TEXT,    -- 'strong' (code, legal name, name variant) | 'weak' (nickname, chat title)
  source TEXT,      -- 'document' | 'user_choice' | 'manual'
  times_confirmed INTEGER DEFAULT 1,
  created_at TEXT
);
CREATE INDEX ix_alias_norm ON supplier_aliases(value_norm);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  name TEXT, role TEXT, wechat_nickname TEXT, phone TEXT
);

CREATE TABLE deals (                  -- [OPEN] D4: hackathon = one default deal per supplier
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  product TEXT,
  status TEXT,      -- 'negotiating' | 'sample' | 'order' | 'closed' | 'lost'
  created_at TEXT
);

CREATE TABLE messages (               -- raw layer
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  channel TEXT,             -- 'wecom' | 'web_upload' | 'web_chat' | 'sim'
  external_msgid TEXT UNIQUE,   -- WeCom msgid, for dedupe
  group_id TEXT,
  direction TEXT,           -- 'in' | 'out'
  kind TEXT,                -- 'text' | 'voice' | 'image' | 'file' | 'merged' | 'menu_click' | 'event'
  intent TEXT,              -- 'content' | 'question' | 'command' | 'menu_reply'
  original_author TEXT,     -- author nickname inside a merged_msg, if present
  text_original TEXT,       -- text or transcript, original language
  text_translated TEXT,
  file_path TEXT,
  supplier_id TEXT,         -- NULL until assigned
  status TEXT,              -- 'pending' | 'assigned' | 'skipped'
  received_at TEXT
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES messages(id),
  supplier_id TEXT,
  deal_id TEXT,
  doc_type TEXT,    -- 'business_license' | 'proforma_invoice' | 'quotation' | 'certificate' | 'bank_details' | 'contract' | 'other'
  extracted_json TEXT,
  doc_date TEXT,
  file_path TEXT,
  created_at TEXT
);

CREATE TABLE facts (                  -- THE CORE
  id INTEGER PRIMARY KEY,
  workspace_id TEXT,
  supplier_id TEXT,
  deal_id TEXT,
  key TEXT,                 -- closed vocabulary (§4.3)
  value_json TEXT,          -- {"amount":4.2,"currency":"USD"}
  said_by TEXT,             -- 'supplier' | 'buyer' | 'document' | 'registry' | 'user_report'
  source_type TEXT,         -- 'voice' | 'chat' | 'pi' | 'quotation' | 'license' | 'cert' | 'bank' | 'registry' | 'manual'
  source_message_id TEXT,
  source_document_id TEXT,
  quote_original TEXT,
  quote_translated TEXT,
  stated_at TEXT,
  status TEXT,              -- 'proposed' | 'agreed' | 'superseded' | 'disputed' | 'rejected'
  confidence REAL,
  created_at TEXT
);
CREATE INDEX ix_facts ON facts(supplier_id, key, stated_at);

CREATE TABLE red_flags (
  id INTEGER PRIMARY KEY,
  supplier_id TEXT,
  deal_id TEXT,
  severity TEXT,            -- 'red' | 'amber' | 'info'
  code TEXT,                -- §7.1
  title TEXT,
  detail TEXT,
  evidence_fact_ids TEXT,   -- JSON
  status TEXT,              -- 'open' | 'resolved' | 'dismissed'
  created_at TEXT,
  resolved_at TEXT
);

CREATE TABLE commitments (
  id INTEGER PRIMARY KEY,
  supplier_id TEXT,
  who TEXT,                 -- 'supplier' | 'buyer'
  what TEXT,
  due_at TEXT,
  source_message_id TEXT,
  status TEXT               -- 'open' | 'done' | 'late'
);

CREATE TABLE pending_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  message_ids TEXT,         -- JSON
  candidate_ids TEXT,       -- JSON, ordered best first
  clues_json TEXT,          -- names/codes/nicknames found; learned after the choice
  awaiting TEXT,            -- 'supplier_choice' | 'new_supplier_name' | 'intent_choice'
  menu_sent_at TEXT,
  status TEXT               -- 'open' | 'resolved' | 'skipped'
);

CREATE VIRTUAL TABLE search_index USING fts5(ref_type, ref_id, supplier_id, text, tokenize = 'trigram');

CREATE TABLE wecom_state (k TEXT PRIMARY KEY, v TEXT);  -- sync_msg cursor, access_token + expiry, send counters

CREATE TABLE llm_calls (              -- cost and latency tracking (§19.5)
  id INTEGER PRIMARY KEY,
  step TEXT,                -- 'intent' | 'extract' | 'analyze' | 'draft' | 'assistant' | 'asr'
  model TEXT,
  input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
  est_cost_usd REAL,
  ms INTEGER,
  source TEXT,              -- 'live' | 'fallback' | 'mock'
  created_at TEXT
);
```

### 4.3 Fact vocabulary (closed keys)
The LLM may only use these keys (Zod enum). Closed keys make comparisons reliable.

| Group | Keys |
|---|---|
| Price | `unit_price`, `price_tier`, `tooling_fee`, `sample_fee`, `other_fee`, `currency` |
| Quantity | `moq`, `order_qty` |
| Delivery | `incoterm`, `port`, `lead_time_days`, `sample_lead_time_days`, `ship_date` |
| Payment | `payment_terms`, `deposit_pct`, `bank_beneficiary_name`, `bank_account_country`, `bank_name` |
| Product | `product_model`, `spec_item`, `packaging`, `warranty` |
| Company | `legal_name_zh`, `legal_name_en`, `credit_code`, `legal_rep`, `reg_capital`, `business_scope`, `license_address` |
| Certificate | `cert_type`, `cert_holder`, `cert_model`, `cert_lab`, `cert_number`, `cert_expiry` |

Dated promises go to `commitments`. Everything else stays searchable in raw text.

### 4.4 Views
- **Current terms:** per key, the latest `agreed` fact, else the latest `proposed`. Older values shown as history.
- **Document checklist:** license, proforma, required certificates, bank details, registry check.
- **Trust indicator:** computed from open red/amber flags, missing documents, registry status. **[OPEN] D6** (score vs traffic light).
- **Timeline:** messages, documents, fact changes, flags, in time order.

### 4.5 How a fact enters memory
1. Extraction returns candidate facts (Zod), each with `quote_original`.
2. **Quote check:** the quote must actually appear in the source text/transcript (fuzzy match). Otherwise discarded. This blocks most LLM inventions.
3. Compare with the latest fact for the same supplier + key:
   - same value → saved (a confirmation);
   - different, and both come from conversation (chat/voice) → the new one becomes `proposed`, the old one `superseded` (the negotiation moved on);
   - different, the new one comes from a **document** and the old one from **conversation** (or vice versa) → nothing is superseded; both stay and a **red flag** is raised (§7).
4. When a value becomes `agreed`: **[OPEN] D5.** Default: only when the user says so (button "Mark as agreed", "agreed" on WeChat, or the web app).

---

## 5. Supplier identification

### 5.1 Principle
The bot **never guesses** the supplier. If the content doesn't identify it with certainty, the bot **always** asks (a `msgmenu` on WeChat, a picker in the web app) before saving anything to a supplier profile.
Why: one fact saved under the wrong supplier makes the cross-document audit useless, and the audit is the core feature.

### 5.2 Fields that identify a supplier, and fields that don't

| Used for matching | NOT used for matching (audit only) |
|---|---|
| Credit code on the **business license** | **Beneficiary** in bank details |
| Company name on the **business license** | **Holder, lab, manufacturer** on certificates |
| **Seller** (seller / 卖方 / 供方) on proforma or quotation, and its credit code | **Buyer** on the proforma (= the user; always excluded via `own_company_names`) |
| Letterhead / company seal (公章) on quotations and contracts | Forwarders, banks, ports |
| Learned nicknames and chat titles — **weak clue only** | |

Extraction returns separate fields (`seller_name`, `seller_credit_code`, `buyer_name`, `beneficiary_name`, `cert_holder`, `cert_lab`). Only `seller_*` and license fields go into matching.

### 5.3 Normalization and aliases
- **Credit code:** 18 characters, uppercase, no spaces. Validate the **check digit** (GB 32100-2015). Invalid → misread (re-extract once) or fake (red flag `CREDIT_CODE_INVALID`).
- **Names:** strip legal suffixes (有限公司, 有限责任公司, 股份有限公司, Co., Ltd., Limited, Inc.), city prefixes (深圳市 → 深圳), punctuation, spaces; lowercase.
- Each supplier has **many aliases** (Chinese legal name, English name, variants). Every menu choice adds the clues found as new aliases.

### 5.4 What the bot knows from each kind of message
- **Single forward (逐条转发):** looks like the user wrote it. No original sender.
- **Merged chat forward (合并转发, `merged_msg`):** a title and each author's WeChat nickname **[VERIFY]**. A nickname ("Lisa 🌸 Sales") is not a company name.
- **Plain text, transcribed voice:** almost never contains the company name.

### 5.5 When the supplier is "certain" (no menu)
Only if one of these holds **and** nothing else in the group points to a different supplier:
1. The **credit code** (license or proforma seller) matches exactly **one** saved supplier.
2. The **normalized name** (license or seller) matches a **strong** alias of exactly **one** supplier.

The reply then says: "📁 Saved to: Seller 1 – Shenzhen ABC Tech" with a **[Change supplier]** button (§5.12).

A previously learned **nickname or chat title is not enough on its own**: it puts that supplier first in the menu ("I think this is Seller 1, confirm?"). **[OPEN] D3:** whether a nickname confirmed ≥2 times for one supplier, and never for another, should count as certain. Default: no.

### 5.6 When the menu is shown (every other case)
- No name or code found.
- A name that matches **no** saved supplier (probably new, but still ask).
- A name that matches **several** suppliers, or only **partly** ("ABC Tech" vs "ABC Technology Co.").
- A nickname / chat title never seen, or linked to several suppliers.
- Recent context suggests a supplier but nothing in the content proves it (context only orders the menu).
- **Conflict inside one group:** e.g. license = ABC, proforma = XYZ. Save nothing, show the menu, and warn: "⚠️ The license belongs to ABC but the proforma is issued by XYZ — possibly a middleman or a mistake." After the choice the conflict stays as an amber flag (`SELLER_LICENSE_MISMATCH`).

### 5.7 The menu
```text
I received 1 voice note and 1 photo, but I can't find the company name.
Which supplier is this from?
[Seller 1 – Shenzhen ABC Tech]   ← most likely first
[Seller 2 – Ningbo XYZ]
[➕ New supplier]
[❌ Don't save, translation only]
```
- At most 3–4 suppliers, ordered by likelihood, then recent activity.
- "New supplier" and "Don't save" are always present.
- If the bot has a guess it says so ("I think this is Seller 1 — the last one you talked to. Confirm?") and puts it first.
- **One menu per group** (6 s debounce): 4 forwarded messages without a name → one question.
- **Mixed group** (some certain, some not): **one** reply: analysis of the certain items first, menu for the uncertain ones at the end.

### 5.8 API format
```json
{
  "touser": "<external_userid>",
  "open_kfid": "<open_kfid>",
  "msgtype": "msgmenu",
  "msgmenu": {
    "head_content": "Which supplier is this from?",
    "list": [
      {"type": "click", "click": {"id": "sup:sup_shenzhen_abc", "content": "Seller 1 – Shenzhen ABC Tech"}},
      {"type": "click", "click": {"id": "sup:sup_ningbo_xyz",  "content": "Seller 2 – Ningbo XYZ"}},
      {"type": "click", "click": {"id": "sup:new",              "content": "➕ New supplier"}},
      {"type": "click", "click": {"id": "sup:skip",             "content": "❌ Don't save"}}
    ],
    "tail_content": ""
  }
}
```
A tap arrives as a `text` message carrying `menu_id` (e.g. `sup:sup_shenzhen_abc`) **[VERIFY]**. A tap counts as a user message, so it should reset the send counter **[VERIFY]**.
Button id prefixes: `sup:` choose supplier · `chg:` change supplier · `agr:` mark as agreed · `int:` content or question (§6.5).

### 5.9 While waiting for the answer
- Uncertain messages stay **pending** (`pending_groups`) and are saved to no profile.
- Translation and subtext can already be computed. The **audit runs only after the choice** (it needs a profile to compare against).
- After the tap: link messages → run audit → send the full reply (summary + flags + Chinese reply + web link).
- If the user sends something else instead of tapping, the menu stays valid. New uncertain messages join the **same** pending group (no second menu).
- No answer ever → items stay in the web app under **"To be assigned"**.

### 5.10 "New supplier"
- Name found in a document → create the supplier with that name: "Created Seller 3 – Guangzhou DEF Co."
- No name → ask "What do you want to call it?"; the next free-text reply is taken as the name (`awaiting = 'new_supplier_name'`), not as a question.

### 5.11 Learning
After each choice, store clues as aliases of the chosen supplier: name and code → **strong**; nickname and chat title → **weak** (increment `times_confirmed` when repeated). If a weak alias is later chosen for a different supplier, it becomes ambiguous and is no longer offered first.

### 5.12 Correction
- Every reply with an automatic save is sent as a **`msgmenu`**: the reply text goes in `head_content`, plus a **[Change supplier]** button (`chg:<group_id>`). If `head_content` is too short for the full reply **[VERIFY]**, send two messages: the full text, then a small menu with only the button.
- Changing the supplier **moves** messages, documents, facts and learned aliases, closes flags raised on the wrong profile, and **re-runs** the audit on the right one.
- In the web app, every document and fact has a "Move to…" action.

---

## 6. WeChat bot behaviour

(Account setup and API plumbing: §13.)

### 6.1 Message types handled
| Incoming | Handling |
|---|---|
| `text` | Intent classification (§6.5) |
| `text` with `menu_id` | Menu answer |
| `image` | Download → vision extraction (document or photo) |
| `file` (PDF, etc.) | Download → document extraction **[VERIFY]** that files forwarded from personal WeChat arrive |
| `voice` | Download (AMR) → WAV → ASR → then treated as text |
| `merged_msg` | Each item becomes a message with `original_author`; media inside may or may not be downloadable **[VERIFY]** |
| `event: enter_session` | Linking (§6.3) + welcome |
| anything else | Polite "I can't read this type yet" |

### 6.2 Send budget
After the user's last message, about **48 hours and up to ~5 messages** **[VERIFY]**. Rules:
- one reply per group (two at most);
- never more than one menu pending per user;
- no proactive WeChat reminders; reminders go to the web app/email (**[OPEN] D13**);
- track the counter in `wecom_state`; if the budget is exhausted, the reply waits in the web app and the next user message triggers "I have 1 update for you".

### 6.3 Linking WeChat to a web app account
1. Web app "Connect WeChat" shows a QR code of the 微信客服 contact link with a one-time `scene` value.
2. User scans → chat opens → `enter_session` event with `scene_param` **[VERIFY]**.
3. Server binds `external_userid` ↔ user; welcome message with 3 examples.
Fallback: the user types a 6-digit code shown in the web app.
Hackathon shortcut: one fixed demo user, no linking (**[OPEN] D11**).

### 6.4 Voice notes (WeChat limitation)
Individual voice notes **cannot be forwarded**, and in a merged forward they appear as "[语音]" without audio. Supported paths:
1. User long-presses → **转文字** (convert to text) → forwards/copies the text → treated as supplier text.
2. User sends **their own voice note** to the bot ("Lisa says 4.2 dollars FOB, 15 days") → ASR → stored as `said_by = 'user_report'`, lower confidence.
3. Saving the voice note to Favorites (收藏) and sending it from there **[VERIFY]**.

### 6.5 Forwarded content or a question?
A single forward looks like the user typed it, so each group gets an intent:

| Signal | Intent |
|---|---|
| `merged_msg`, image, file | content |
| Mostly **Chinese**, supplier tone (报价, 交期, 亲, 老板…) | content |
| User's language, phrased as a question/request ("how much…", "who…", "write me…") | question |
| Starts with a command (`/suppliers`, `/flags`, `/today`, "agreed") | command |
| Has `menu_id` | menu answer |
| `awaiting = 'new_supplier_name'` | supplier name |
| Voice | transcribe, then apply the rules above |

Low confidence → small menu "Is this from a supplier, or a question for me?" [📥 From supplier] [❓ My question]. **[OPEN] D7:** ask vs. pick the more likely intent and offer a switch button. Default: ask.

### 6.6 Reply formats
**Analyzed content** (one `msgmenu`):
```text
📁 Seller 1 – Shenzhen ABC Tech · Proforma PI-2026-118

🔴 2 RED FLAGS
1. Incoterm changed: EXW on the proforma, but the Nov 18 voice note said FOB Shenzhen.
2. Wire beneficiary (深圳市鑫达贸易有限公司) is NOT the company on the license.
   → Don't pay until this is cleared up.

✅ Consistent: price USD 4.20 · MOQ 500 · lead time 15 days

💬 Suggested reply (copy and send):
王经理您好，PI上的贸易条款写的是EXW，但我们11月18日确认的是FOB深圳，麻烦修改一下。
另外收款账户名称和营业执照上的公司名称不一致，请提供贵司对公账户，谢谢！

🔗 Details: https://<app>/s/<token>
[Change supplier] [Mark as agreed]
```
**Answer to a question** (plain text, with sources):
```text
Seller 2 (Ningbo XYZ) quoted USD 3.95/unit for 1,000 units, FOB Ningbo,
25-day lead time (merged chat, Nov 12).
Seller 1 is at USD 4.20 with 15 days (voice note, Nov 18).
⚠️ Seller 2 hasn't sent a business license yet.
```
How much goes into WeChat vs. behind the link: **[OPEN] D14.**

---

## 7. Audit engine

### 7.1 Deterministic checks (pure functions, unit-tested)

| Code | Check | Severity |
|---|---|---|
| `INCOTERM_CHANGED` | Document Incoterm ≠ latest conversation Incoterm | 🔴 |
| `PRICE_CHANGED` | Unit price differs > 0.5% | 🔴 |
| `PAYMENT_TERMS_CHANGED` | Higher deposit / different terms | 🔴 |
| `MOQ_CHANGED` | Different MOQ | 🟡 |
| `LEAD_TIME_CHANGED` | Longer lead time | 🟡 |
| `NEW_FEE` | Fee never mentioned before (tooling, sample, packaging) | 🟡 |
| `BENEFICIARY_MISMATCH` | Normalized beneficiary ≠ license name | 🔴 |
| `PERSONAL_ACCOUNT` | Beneficiary looks like a person (2–4 Chinese characters, no 公司) | 🔴 |
| `OFFSHORE_ACCOUNT` | Overseas / HK account for a mainland company | 🟡 |
| `SELLER_LICENSE_MISMATCH` | Proforma seller ≠ license company | 🟡 |
| `CREDIT_CODE_INVALID` | Bad check digit | 🔴 |
| `REGISTRY_INACTIVE` | Registry status not 存续/在业 | 🔴 |
| `REGISTRY_NAME_MISMATCH` | Registry name ≠ license name for the same code | 🔴 |
| `SCOPE_MISMATCH` | Business scope lacks manufacturing of the product (possible middleman) | 🟡 |
| `CERT_HOLDER_MISMATCH` | Certificate holder ≠ supplier | 🟡 |
| `CERT_MODEL_MISMATCH` | Certificate model ≠ negotiated model | 🟡 |
| `CERT_EXPIRED` | Expired (🔴) or expiring within 60 days (🟡) | 🔴/🟡 |
| `COMMITMENT_LATE` | Supplier commitment past due | 🟡 |

Each flag stores `evidence_fact_ids`, so the web app shows both original quotes side by side.

### 7.2 LLM analysis
- **Translation + cultural subtext:** e.g. 我们尽量安排 ("we'll try" → likely delay), 问题不大 ("not a big problem" → there is one), 再商量 ("let's discuss later" → polite no), "from" prices.
- **Chinese reply draft:** polite, firm, citing exact dates and numbers from the facts.
- **Anything the rules miss:** amber flag with an explanation.

### 7.3 Registry check
- Hackathon: `lib/adapters/registry.ts` reading a curated `data/registry.json` with the demo companies (code, name, status, scope).
- Production: Qichacha/Tianyancha pay-as-you-go API behind the same adapter.
- Always (free): credit-code check digit.

---

## 8. Assistant (questions about memory)

### 8.1 Tools
An LLM with tools that read memory; it never receives the whole database.

| Tool | Returns |
|---|---|
| `list_suppliers(filter?)` | Suppliers with label, status, trust, last activity |
| `get_supplier_profile(supplier)` | Current terms, checklist, open flags, contacts |
| `get_fact_history(supplier, key)` | All values over time, with source and quote |
| `compare_suppliers(suppliers[], keys[])` | Comparison table |
| `search_memory(query, supplier?)` | FTS5 over messages, transcripts, documents |
| `get_timeline(supplier, from?, to?)` | Events in order |
| `list_commitments(status?)` | Open / late commitments |
| `draft_message(supplier, intent)` | Chinese draft based on facts |
| `mark_agreed(fact_id)`, `resolve_flag(flag_id)` | Actions — always confirmed by the user via a menu/button first |

Supplier references in questions ("ABC", "Lisa", "the Ningbo one") resolve through the alias table; if ambiguous, the assistant asks.

Implementation note: `lib/adapters/llm.ts` currently does single-shot JSON calls. Tool use needs a small loop (call → tool calls → results → final answer), max ~5 rounds, for whichever provider is chosen (D8). Fallback if time is short: a "router" call that picks one or two tools, then one answer call.

### 8.2 Answer rules
- Use only what the tools return. If missing: "I don't have that yet" + what to upload.
- Always cite the source (type + date).
- Surface relevant open flags unprompted ("before paying the deposit, note…").
- WeChat: short, with a web link for details.

### 8.3 Quick commands (WeChat)
`/suppliers` · `/flags` · `/today` · `/seller1` · `agreed` (after an analysis).

---

## 9. Web app

| Page | Content |
|---|---|
| `/` Home | Supplier cards (trust + flags), "To be assigned", commitments due, latest events; upload bar always visible |
| `/upload` | Drag & drop (PDF, images, audio, chat exports). Per file: detected type, proposed supplier (same rules as §5, picker instead of menu), extracted facts preview, flags |
| `/inbox` | "To be assigned": pending groups + supplier picker |
| `/suppliers` | Comparison table: price, MOQ, Incoterm, lead time, payment, trust, documents |
| `/suppliers/[id]` | Profile: names (ZH/EN), credit code, registry status; **current terms with history** (click a value → source + quote); checklist; flags with side-by-side evidence; timeline; contacts; original files |
| `/documents/[id]` | Original next to extracted fields; editing a field creates a `manual` fact |
| `/ask` | Assistant chat (same brain as WeChat), clickable sources |
| `/settings` | Own company names, reply language, Connect WeChat (QR) |
| `/sim` | **WeChat simulator**: chat window calling the same core, rendering `msgmenu` as buttons. Dev tool + demo plan B |
| `/s/[token]` | Mobile supplier page opened from WeChat links (signed, expiring token) |

---

## 10. Code layout and internal API

### 10.1 Repo state
The repo contains a Next.js 15 + Tailwind + Vitest + ESLint scaffold, the `app/globals.css` theme, and `lib/adapters/llm.ts` (Qwen/Claude switch with Zod validation, timeout, fallback). Everything else in §10.2 is still to be built.

### 10.2 Files to create
```text
app/api/wecom/callback/route.ts   GET verify · POST event → sync_msg → core
app/api/ingest/route.ts           web upload (multipart)
app/api/sim/route.ts              simulator message
app/api/ask/route.ts              web assistant
app/api/pending/[id]/assign/route.ts
app/api/suppliers/route.ts, app/api/suppliers/[id]/route.ts
app/api/facts/[id]/route.ts, app/api/flags/[id]/route.ts
app/api/link/wechat/route.ts      one-time scene token for the QR

lib/db.ts                  better-sqlite3 + migrations (schema §4.2)
lib/core/ingest.ts         raw storage, dedupe, grouping (debounce)
lib/core/intent.ts         §6.5
lib/core/normalize.ts      names, credit code + check digit
lib/core/resolveSupplier.ts §5
lib/core/extract.ts        classifier + per-type extractors (§11)
lib/core/facts.ts          §4.5
lib/core/audit.ts          §7.1 rules
lib/core/reply.ts          WeChat/web reply composition, send budget
lib/core/assistant.ts      §8 tool loop
lib/channels/wecom.ts      crypto, access_token cache, sync_msg, send_msg, media/get
lib/channels/sim.ts
lib/adapters/llm.ts        (kept) + PDF, multi-image, tool use
lib/adapters/asr.ts
lib/adapters/registry.ts
data/registry.json         demo registry
data/demo/                 demo documents with planted traps
tests/normalize.test.ts  tests/resolveSupplier.test.ts  tests/audit.test.ts  tests/wecomCrypto.test.ts
```

### 10.3 The one core function
Every channel calls the same entry point, so the simulator, upload and WeChat behave identically:
```ts
handleIncoming({ userId, channel, items: IncomingItem[] }): Promise<OutgoingReply[]>
// IncomingItem = { kind, text?, filePath?, menuId?, originalAuthor?, externalMsgId?, receivedAt }
// OutgoingReply = { kind: 'text' | 'menu', text, buttons?: { id, label }[] }
```

---

## 11. Extraction schemas (Zod)

1. **Classifier:** `{ doc_type, language, confidence }`.
2. **Business license:** `legal_name_zh`, `credit_code`, `legal_rep`, `reg_capital`, `established`, `business_scope`, `address`, `has_official_seal`.
3. **Proforma / quotation:** `seller{name, credit_code, address}`, `buyer_name`, `pi_number`, `date`, `items[{model, qty, unit_price, currency}]`, `incoterm`, `port`, `lead_time_days`, `payment_terms`, `deposit_pct`, `fees[{type, amount}]`, `bank{beneficiary_name, bank_name, account_country, swift}`.
4. **Certificate:** `cert_type`, `cert_number`, `holder`, `manufacturer`, `models[]`, `lab`, `issue_date`, `expiry_date`.
5. **Bank details:** same as `bank` above.
6. **Text / transcript:** `translation`, `subtext[{phrase, meaning, risk}]`, `facts[{key, value, quote_original}]`, `commitments[{who, what, due}]`.

Shared rules: every extracted value carries its `quote_original`; unreadable → `null`, never invented; amounts as numbers + currency; dates ISO.

Multi-page PDFs: send pages as images (render with a PDF library) or as a PDF if the chosen provider supports it (D8).

---

## 12. Security and privacy
- Licenses and bank details stay on the server (`storage/`, git-ignored), never in logs.
- Every query filtered by `workspace_id`.
- Links sent over WeChat use signed, expiring tokens.
- Secrets only in `.env.local`.
- The bot flags risk; it doesn't give legal advice. Replies about payments say "verify before paying".
- **[OPEN] D15:** data retention and deletion policy.

---

## 13. WeChat setup — step by step

### 13.1 What it takes
- **No formal approval.** 微信客服 is not a Mini Program or Official Account, so there is no Tencent review to wait for. An **unverified WeCom (企业微信) account** is enough for the hackathon.
- **Limits of an unverified account** (from community sources, not official docs):
  - about **100 customers in total** for 微信客服;
  - at most **10 customer-service accounts** (official error code 95027).
  
  Both are plenty for a demo. Don't hard-code these numbers.
- **Who registers:** a team member whose personal WeChat has real-name verification (实名). Registration may need a mainland (+86) phone number.
- **A VPS with a static public IP.** This is the only real requirement, because of the trusted IP rule below.

### 13.2 The tricky part: trusted IP and callback URL
Self-built apps created in recent years can only call the API (`sync_msg`, `send_msg`, …) from a **trusted IP (企业可信IP)**. Without it you get error **60020** / "not allow to access from your ip". To unlock the trusted IP setting, WeCom first requires **one** of:
1. a **trusted domain** with ICP filing (备案) **owned by the same entity as the WeCom account**. With an unverified account this is effectively impossible; or
2. a **verified callback URL** (接收消息服务器), i.e. your server passes WeCom's URL check.

So we use option 2. According to the WeCom developer community, **unverified accounts can use an IP-address URL** (e.g. `http://1.2.3.4/api/wecom/callback`) instead of a domain, which avoids the ICP problem. This comes from community answers, not official docs, and at least one developer reports it as still unresolved → **[VERIFY] first thing**. Default serverless domains (e.g. CloudBase) have been reported to fail with **-50025**, another reason to use a VPS.

### 13.3 Steps (owner: person A, timebox below)
| # | Step | Time |
|---|---|---|
| 1 | Register WeCom (unverified). Note the **CorpID**. | 10 min |
| 2 | Start a VPS with a static IP; install Node 22 + ffmpeg; deploy the app (`next start`); open port 80 (and 443 if using a domain). | 30 min |
| 3 | WeCom admin → **App Management → create a self-built app** → note **AgentId** and **Secret**. | 10 min |
| 4 | In the app → **Receive messages → set API receiving**: URL = `http://<VPS-IP>/api/wecom/callback`, generate **Token** and **EncodingAESKey**. Save → WeCom sends a GET with `msg_signature`, `timestamp`, `nonce`, `echostr`; the server verifies the signature, AES-decrypts `echostr` and returns the plain text. Use WeCom's online callback test tool to debug. | 1–2 h (most errors happen here) |
| 5 | In the app → **Enterprise trusted IP** → add the VPS IP. | 5 min |
| 6 | WeCom admin → **微信客服** → create a customer-service account (name + avatar) → note **open_kfid** (also available via API `kf/account/list`). | 10 min |
| 7 | 微信客服 → **API** → select our self-built app as the **app that can call the API** (可调用接口的应用). From now on, 微信客服 events go to our callback. | 5 min |
| 8 | Get the contact link (`kf/add_contact_way` or the admin panel) → QR code → scan with a personal WeChat → send "hi". | 10 min |
| 9 | Server receives the event `kf_msg_or_event` with a `Token` → calls `sync_msg` with that token + the stored `cursor` → reads the text → `send_msg` replies. | 1 h |
| 10 | Acceptance tests from §17: `msgmenu` + tap format, merged forward contents, file forward, voice format, `head_content` length, send budget. | 1 h |

Expected total: **3–5 hours** to a working "hi → reply". The rest of the product doesn't depend on WeChat and is built in parallel on the simulator.

**Timebox:** if the callback URL isn't verified by **noon of day 1**, the simulator `/sim` becomes the main demo channel, and WeChat keeps going in the background (or is shown as a recording if it works later).

### 13.4 API plumbing notes
- `access_token`: `gettoken?corpid=…&corpsecret=<app secret>`, valid ~2 h, cache it and refresh early.
- The callback only **notifies**. Messages are pulled with `sync_msg` (`cursor`, `token`, `limit`, `open_kfid`); store `next_cursor` after every pull; loop while `has_more`.
- Answer the callback with `success` immediately; process in the background (Next.js `after()`), because WeCom retries slow callbacks → dedupe by `msgid`.
- Media: `media/get?media_id=…` right away (media ids expire after a few days).
- Errors to recognize: **60020** (IP not trusted), **95027** (account limit, unverified), **-50025** (callback domain rejected).

---

## 14. Build plan (24–48 h)

### 14.1 Team (4 people; adjust)
- **A — WeChat:** §13, `lib/channels/wecom.ts`, crypto tests, then the simulator.
- **B — Core & memory:** `lib/db.ts`, normalize, resolveSupplier, facts, audit + tests.
- **C — AI:** extractors, intent, ASR, subtext, Chinese drafts, assistant tool loop, fallbacks.
- **D — Web app & demo:** pages, demo documents with traps, `data/registry.json`, demo script, backup video.

### 14.2 Phases
| Hours | Goal | Done when |
|---|---|---|
| 0–3 | WeChat gate (§13) · DB schema · `handleIncoming` stub · demo documents | We know if WeChat works; simulator echoes through the core |
| 3–10 | Ingest → extraction → facts; supplier resolution with menu | Forwarding a license creates/recognizes a supplier |
| 10–18 | Audit rules + full reply | Both traps caught, Chinese draft produced |
| 18–26 | Assistant with tools; supplier profile + comparison pages | "Who's cheapest?" answers with sources |
| 26–34 | Upload, "To be assigned", [Change supplier] | Full flow on both surfaces |
| 34–42 | Polish, fallbacks, rehearsals | Demo runs 5 times in a row without errors |
| 42–48 | Backup video, slides, buffer | — |

**Cut first if late:** quick commands → QR linking (use a fixed user) → nickname learning → bulk upload (one file at a time) → live registry (dataset only).
**Never cut:** facts with sources, the "Which supplier?" menu, the two red flags, the Chinese reply, one assistant question.

### 14.3 Demo data
- **Seller 1 – Shenzhen ABC Tech:** valid license (credit code with a correct check digit), proforma with **EXW** instead of FOB and a **different beneficiary** (a trading company), valid CE certificate.
- **Seller 2 – Ningbo XYZ:** cheaper quote, longer lead time, no license yet.
- A Chinese text with no company name (to trigger the menu), as if converted with 转文字.
- All companies fictional; credit codes generated with valid check digits.

---

## 15. Demo script (~2.5 min)
1. **Context (15 s):** "Buyers sourcing from China negotiate on WeChat: Chinese voice notes, PDFs, licenses. That's where money gets lost."
2. **No name → menu (30 s):** forward Lisa's transcribed message ("4.2 dollars, FOB Shenzhen, 15 days") → translation + subtext → **"Which supplier is this from?"** → one tap on Seller 1 → "📁 Saved." *Proof it never mixes up suppliers.*
3. **Documents with traps (45 s):** forward license + proforma → **2 red flags** (EXW vs FOB; beneficiary ≠ license) + Chinese reply ready to copy.
4. **Free question (25 s):** "Is Seller 1 or Seller 2 the better deal?" → numbers with sources + "Seller 2 hasn't sent a license".
5. **Web app (30 s):** tap the link → Seller 1 profile: click EXW → voice note and proforma quotes side by side; comparison with Seller 2; bulk upload.
6. **Close (15 s):** roadmap + business model.

**Plan B:** same scene in `/sim` + recorded video of the real bot.

---

## 16. Open product decisions

Each has a **default** we build until the team decides, so nothing is blocked.

| # | Decision | Options | Default for the build |
|---|---|---|---|
| D1 | Product name | — | **Decided: Memini** (Latin "I remember"; renamed from ChopCheck on 2026-11-21 — alternatives in §16.1) |
| D2 | Reply language (explanations, not the Chinese drafts) | Always English · user's language (auto-detect) · set in settings | English, `reply_language` field ready |
| D3 | Can a learned nickname make the supplier "certain"? | Never · after ≥2 confirmations and no conflicts | Never (always menu, nickname first) |
| D4 | Deals per supplier | One · several (per product) | One default deal; schema supports several |
| D5 | When is a term "agreed"? | Only when the user confirms · auto when both sides repeat it · auto from a signed PI | Only on user confirmation |
| D6 | Trust indicator | 0–100 score · traffic light · none (flags only) | Traffic light (simpler to explain, harder to argue with) |
| D7 | Uncertain intent (content vs question) | Ask with a menu · guess + "switch" button | Ask |
| D8 | Model per step | See §19.3 | Haiku 5.5 for intent; Opus 5.5 (effort low) for extraction, analysis, drafts, assistant; decided by the bake-off (§19.7) |
| D9 | Speech-to-text | `scribe_v2` · `qwen3-omni-flash` | `scribe_v2`, if the gateway exposes audio |
| D10 | Server location | Singapore VPS (no ICP, reaches Qwen + WeCom + Claude/OpenAI/Gemini without geo-blocks) · Hong Kong (geo-blocked by Claude/OpenAI/Gemini) · mainland (needs ICP for domains) | **Decided:** Singapore (Tencent Cloud Lighthouse, Ubuntu 24.04 LTS, 2 vCPU / 8 GB RAM) |
| D11 | Accounts for the hackathon | Single fixed demo user · real login + QR linking | Single user; linking only if time allows |
| D12 | Team use | One user per workspace · several teammates share a workspace | One user; schema already has workspaces |
| D13 | Reminders (late samples, expiring certificates) | Web app only · email · WeChat when the user next writes | Web app badge + "I have 1 update" on next WeChat message |
| D14 | WeChat reply length | Full analysis in WeChat · short summary + link | Full flags + draft in WeChat, details behind link |
| D15 | Data retention | Keep forever · user-controlled deletion · auto-expire | User can delete a supplier and all its data |
| D16 | Git hosting | — | **Decided:** private GitHub repo `memini` |
| D17 | Link to discovery (e.g. Accio) | Ignore · roadmap slide · import a supplier from a link | Roadmap slide |
| D18 | Business model to pitch | Freemium + paid "last mile" services · per-deal fee · subscription | Freemium + paid services (factory video visit, bilingual contracts, escrow) |

### 16.1 Name ideas (D1)
Check domains, App Store and trademarks before deciding; we haven't checked availability.

| Name | Meaning | Why it works | Watch out |
|---|---|---|---|
| **Memini** | Latin for "I remember" | The core promise: it remembers every price, promise, document and deadline; short, works in English and Italian; no well-known product with this exact name found (quick web search only) | Says nothing about China on its own → the red seal 印 logo and a tagline ("your China business memory") carry that |
| **ChopCheck** | A "chop" is the Chinese company seal (公章) stamped on every license, PI and contract | Says exactly what it does (checks the documents) and sounds like an insider term | Means little to people who never sourced in China (fine: they aren't the users) |
| **Laoban** (老板) | "Boss": what Chinese suppliers call the buyer in every chat | Instant recognition for the target users; puts the user in charge | Generic word, hard to trademark alone → "Laoban AI" |
| **WeVet** | WeChat + vet (check a supplier) | Short, says where and what | Close to "WeChat" branding; may look like a Tencent product |
| **Zhenjia** (真假) | "Real or fake" | The trust promise in two syllables; good tagline: "Zhenjia — know what's real before you pay" | Hard to pronounce for non-Chinese speakers |
| **Guanxi** (关系) | Relationships / connections, the famous concept of doing business in China | Universally known among China traders | Many existing companies use it |
| **Tingdong** (听懂) | "To understand what you hear" | Fits the voice notes and subtext decoder | Less about trust and protection |

**Chosen: Memini** (2026-11-21), replacing ChopCheck once the scope widened beyond checking supplier documents. Also considered: Paperpilot, Red Seal, RedMemo, DealMemo, Memchop, Memento (too common), Memofy (taken). Domains, App Store names and trademarks for Memini still to check.

---

## 17. Verify with real tests (first hours)
1. Callback URL as a bare **IP** is accepted for an unverified account; trusted IP can then be set (§13.2).
2. Format of a `msgmenu` tap (`menu_id` in a `text` message).
3. Maximum length of `msgmenu.head_content`.
4. Exact send budget (~48 h, ~5 messages) and whether a menu tap resets it.
5. `merged_msg` contents: title, author nicknames, whether media inside can be downloaded.
6. PDFs/files forwarded from personal WeChat to 微信客服 arrive as `file`.
7. Voice format received (AMR vs SILK) and ASR quality on colloquial Mandarin.
8. `scene_param` delivered in `enter_session` for QR linking.
9. Forwarding a voice note via Favorites (收藏).
10. Unverified-account limits in practice (customers, accounts).
11. API gateway: endpoint type (Anthropic / OpenAI compatible), passthrough of PDFs, tools, structured outputs, effort, audio; reachability from the VPS; per-key limits and prices (§19.1).

---

## 18. Roadmap after the hackathon
1. **Zero-forward mode** for verified businesses: WeCom conversation archiving (会话内容存档) → automatic ingestion.
2. **Live registry** (Qichacha/Tianyancha) + monitoring (status, legal rep, lawsuits).
3. **Reminders** (samples, payments, certificate expiry).
4. **Semantic search** (embeddings, pgvector) as documents grow.
5. **Integrations:** discovery (Accio and similar tools), orders (Shopify).
6. **Paid "last mile" services:** live video factory walkthroughs, bilingual NNN contracts, milestone escrow / RMB payments.

---

## 19. AI models and API budget

This section is the reference for choosing models when we wire up each step. It keeps the choice open (D8, D9) but says what we'd pick and why.

### 19.1 What we have
- **Our own AI subscriptions** → use them for **coding** (Claude Code, etc.). They never touch the product.
- **API keys:** 4 people, each can create up to 3 keys, **$300 per person** (assumption: $1,200 total; if it's $300 *per key*, the budget is even larger and nothing below changes).
- The model list (Claude, OpenAI, Gemini, Qwen, DeepSeek, Kimi, GLM, ElevenLabs, …) suggests **one gateway that routes to many providers**. **[VERIFY]** in the first hour:
  1. Is the endpoint **Anthropic-compatible** (`/v1/messages`), **OpenAI-compatible** (`/v1/chat/completions`), or both?
  2. Does it pass through: images, **PDF documents**, **tool use**, **JSON schema / structured outputs**, `output_config.effort`, audio upload?
  3. Is it reachable from the VPS (Singapore)?
  4. Per-key spending limits and a usage page?
  5. Price list for non-Claude models (we only know Claude's prices for sure, below).
- **Privacy:** the gateway sees every document we send (licenses, bank details). Fine for fictional demo data; for real users this is a production decision.

### 19.2 Known prices (Claude, first-party list prices per 1M tokens)
| Model | Input | Output | Use it for |
|---|---|---|---|
| `claude-fable-5-2` | $8 | $40 | Not at runtime: slow long turns, priciest. Only for an offline "second opinion" if ever. |
| `claude-opus-5-5` | $4 | $20 | **Default for anything that needs judgment**: extraction from messy Chinese documents, audit explanation, Chinese drafts, assistant. |
| `claude-sonnet-5-5` | $2 | $10 | Same jobs at half the price, if Opus is too slow for WeChat's 3–5 s feel. |
| `claude-haiku-5-5` | $0.10 | $0.50 | Tiny, fast jobs: intent classification, language detection, "is this a document?" |

Gateway prices may differ from these list prices. Older Claude models (3.x, 4.x) bring nothing here; skip them.

### 19.3 Recommended model per task

| Step | Recommended | Alternatives to test | Settings / notes |
|---|---|---|---|
| Intent (§6.5), doc-type classifier | `claude-haiku-5-5` | `gemini-3.5-flash-lite`, `qwen-flash` | effort `low`; must answer in < 1 s |
| Document extraction (license, PI, certificate, bank slip, photos) | `claude-opus-5-5` | `claude-sonnet-5-5`; OCR pre-pass with `qwen-vl-ocr` or `deepseek-ocr` for blurry scans | effort `low`; structured output (Zod schema); PDFs sent as documents if the gateway allows, else page images |
| Translation + cultural subtext | `claude-opus-5-5` | `qwen3-max`, `deepseek-v4-pro`, `kimi-k3.1-pro` | effort `low`–`medium` |
| Chinese reply draft | `claude-opus-5-5` | `qwen3-max`, `deepseek-v4-pro`, `glm-5.3` | **A/B test**: a Chinese-speaking teammate rates naturalness of 5 drafts per model; Chinese-native models may sound more natural |
| Assistant with tools (§8) | `claude-opus-5-5` | `claude-sonnet-5-5` | effort `low` on WeChat (latency), `medium` in the web app |
| Voice → text (§6.4) | `scribe_v2` (ElevenLabs) | `qwen3-omni-flash` | Convert AMR → WAV first; test colloquial Mandarin |
| Demo documents (licenses, PIs with traps) | **No image model.** Build them as HTML templates → PDF/PNG | — | Image models garble Chinese text; templates give exact control over the traps. Mark them clearly as fictional. |

Claude API details that matter for the code (current models):
- On Opus 5.5 thinking can't be turned off; control cost and latency with `output_config.effort`, and **set it explicitly**: the default is `medium`.
- Forced `tool_choice` (`any` / `tool`) returns a 400 on Opus 5.5 and Sonnet 5.5. Use `auto` + `strict: true` tools, or structured outputs for JSON.
- Always check `stop_reason` (`refusal`, `max_tokens`) before reading the answer; the existing adapter already does this for refusals.
- Keep system prompts static so **prompt caching** works (repeated system prompt + schema at ~10% of the input price).

### 19.4 What it will cost (rough, Opus 5.5 list prices, thinking at `low`)

| Operation | Tokens (in / out) | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|---|
| Intent classification | 1.5k / 0.1k | — | — | ~$0.0002 |
| Extract one document | ~6k / 1.5k | ~$0.05 | ~$0.03 | ~$0.001 |
| Analysis + subtext + Chinese draft | ~4k / 1.5k | ~$0.05 | ~$0.02 | — |
| Assistant question (≈3 tool rounds) | ~20k / 1.5k | ~$0.11 | ~$0.06 | — |
| **One forwarded document, end to end** | | **~$0.10** | ~$0.05 | |

→ 1,000 end-to-end document runs ≈ **$100** on Opus. Development + testing + rehearsals for the whole hackathon: estimated **$150–300**. The budget is **not** the constraint; **latency and quality are**. Don't downgrade models to save money; downgrade only where measured latency hurts the WeChat experience.

### 19.5 Key plan
| Key | Who / where | Purpose |
|---|---|---|
| `demo-prod` | Only on the VPS, never on laptops | The live bot and the demo. Keep ≥ $100 untouched for rehearsals and the stage. |
| `dev-A` … `dev-D` | One per person | Local development and tests |
| `spare` | Not distributed | Replacement if a key leaks or hits its limit |

Rules:
- `LLM_PROVIDER=mock` by default for UI work; real calls only when working on AI steps.
- Log every call in `llm_calls` (§4.2): model, tokens, estimated cost, ms. Show total spend in `/settings`.
- Run the demo pipeline once on real models, save the answers as the fallback fixtures (§2.7), and rehearse mostly on those.

### 19.6 Wiring it into the code
- `lib/adapters/llm.ts` already switches providers. Add a **`gateway`** provider:
  - if the gateway is **Anthropic-compatible** → official Anthropic SDK with `baseURL` set to the gateway (keeps structured outputs, effort, PDFs, tools);
  - if it is **only OpenAI-compatible** → the existing OpenAI-SDK path with the gateway's `baseURL`, for every model, accepting that some Claude features may not pass through.
- Model per step comes from env vars, so switching after the bake-off is a config change, not a code change:
  `MODEL_INTENT`, `MODEL_EXTRACT`, `MODEL_ANALYZE`, `MODEL_DRAFT`, `MODEL_ASSISTANT`, `MODEL_ASR`.

### 19.7 How we decide (1-hour bake-off, hour 10–12)
1. Test set: the 5 demo documents + 5 Chinese supplier texts + 5 assistant questions, each with the expected answer.
2. Run 2–3 candidates per step (from §19.3).
3. Pick by: **correct fields / caught traps first**, then **latency** (WeChat target < 8 s end to end), then cost.
4. Chinese drafts: rated blind by a Chinese-speaking teammate.
5. Write the result into §16 (D8, D9) and the env vars.

---

## Sources for §13 (community, not official — re-check during setup)
- [WeCom community: unverified accounts, CloudBase callback -50025, IP-based URL](https://developer.work.weixin.qq.com/community/question/detail?content_id=16916771411689177386)
- [CSDN: error 60020 and the trusted-IP prerequisite](https://blog.csdn.net/weixin_44698992/article/details/140289480)
- [GitHub issue: unverified account blocked at the trusted-IP step](https://github.com/gcy2016/AI_Corp/issues/56)
- [CSDN: connecting 微信客服 to a chatbot](https://blog.csdn.net/qq_39678643/article/details/147630661)
- [Official 微信客服 API error codes (95027)](https://kf.weixin.qq.com/api/doc/path/94291)
- [100-customer limit for unverified accounts](https://moreqifu.com/blog/a/5)
- [微信客服 setup guide](https://www.wescrm.com/siyuzhishiku/weixinyunying/9926.html)
