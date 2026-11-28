# Memini

Bilingual assistant for foreigners doing business in China — a web app + a WeChat (微信客服) bot sharing one structured memory.
It started as a sourcing tool (suppliers, quotes, proformas) and is now generic: **contacts, matters, documents, facts, deadlines, checks**,
scoped by a workspace **profile** ("Sourcing buyer" or "Doing business in China").

See the [product blueprint](memini_blueprint.md) and [roadmap](ROADMAP.md). See also the [Shanghai Impact Hackathon organizer feedback](docs/hackathon-feedback.md).

## Run it

```bash
export PATH=~/.local/node/bin:$PATH   # Node 22 lives here on Nicolò's Mac
npm install
cp .env.example .env.local            # LLM_PROVIDER=mock works with no key
npm run dev                           # http://localhost:3000
npm test                              # 50+ unit + end-to-end tests, no AI needed
npm run test:live                     # real AI calls vs. golden answers (needs keys, costs a few cents)
```

The app seeds demo data on first run. Switch profile and reload demo data in **Settings**.

## How it is organized

| Concept | What it is | Where |
|---|---|---|
| **Contact** (entity) | Anyone you deal with: supplier, landlord, tax office, accountant, bank — and yourself / your company | `lib/core/entities.ts` |
| **Matter** | A case such as a product purchase, residence permit renewal, lease, or tax filing. Each kind has a playbook with a document checklist. | `lib/core/matters.ts`, `lib/core/domain.ts` |
| **Document** | Anything forwarded/uploaded, read by AI into parties + facts + dated tasks | `lib/core/extract.ts` |
| **Fact** | One value with its source and quote (price, rent, deadline, expiry…). Never overwritten | `lib/core/facts.ts` |
| **Task** | Every date: their promises, official deadlines, renewals derived from expiry dates, recurring rent | `lib/core/tasks.ts` |
| **Alert** | Deterministic checks: document vs chat (price, Incoterm, rent…), payee ≠ company, personal accounts, registry, expiring documents, missing paperwork, overdue | `lib/core/audit.ts` |

`lib/core/domain.ts` is the registry: adding a new kind of bureaucracy = a matter kind + its document types + fact keys there; no schema change.

Flow (`lib/core/ingest.ts`, the one entry point for WeChat and the web chat on Home):
**extract → who is it from?** (certain only from a license/contract/notice identifier, otherwise a menu — never guessed)
**→ which matter?** (by document type + product/subject; ambiguous → menu) **→ facts + tasks → audit → reply** (alerts, next steps, Chinese draft).

Suppliers are compared **only within the same product** (`/compare`): two quotes for the 65W charger are comparable, a charger and a cutting board are not.

## AI (tomorrow: connect the keys)

1. Fill `.env.local`: `LLM_PROVIDER=gateway`, `GATEWAY_BASE_URL`, `GATEWAY_API_KEY`, `GATEWAY_API_STYLE` (`anthropic` if the gateway serves `/v1/messages`, else `openai`).
   For Claude directly: `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`.
2. `npm run test:live` — checks the gateway passes structured outputs, images, tool use (§17.11) and that every demo document is read as expected. A fallback counts as a failure there. It prints latency and cost per step.
3. Try other models per step with `MODEL_INTENT`, `MODEL_EXTRACT`, `MODEL_ANALYZE`, `MODEL_DRAFT`, `MODEL_ASSISTANT` and re-run (§19.7 bake-off).
4. Without a model (or if a call fails/times out) every step falls back to rules + saved answers for the demo files, so nothing dead-ends.

## WeChat setup — checklist

See blueprint §13 for background. Code side is done (`lib/channels/wecom*.ts`, `app/api/wecom/callback`); what's left is accounts, a server and verification.

1. **Register WeCom (企业微信)** with a real-name-verified personal WeChat (may need a +86 number). Note the **CorpID** (My company → Company info).
2. **Server with a static public IP** (Singapore VPS — Tencent Cloud Lighthouse, Ubuntu 24.04 LTS, 2 vCPU / 8 GB RAM, ports 22/80/443 open in the provider's firewall, SSH key login). Then, from this folder on your laptop:

   ```bash
   scripts/deploy.sh ubuntu@<server-ip>          # add DOMAIN=your.domain for HTTPS
   ```

   It copies the code (no GitHub needed), installs Node 22, ffmpeg, pm2 and Caddy, sets the firewall, creates the server's `.env.local` (AI off until you add keys), builds, starts ONE pm2 process behind Caddy on port 80, schedules a daily backup of `storage/`, and checks `/api/health`. Re-run it to deploy updates; after editing `.env.local` on the server run `bash ~/memini/scripts/server-setup.sh`.
3. **Self-built app**: WeCom admin → App Management → Create app → note **AgentId** and **Secret** → `WECOM_AGENT_ID`, `WECOM_APP_SECRET`.
4. **Receive messages (API接收)** in the app: URL `http://<VPS-IP>/api/wecom/callback` (or your domain), click *random* for **Token** and **EncodingAESKey** → put them in `.env.local` as `WECOM_CALLBACK_TOKEN`, `WECOM_ENCODING_AES_KEY`, restart the server, then click Save in WeCom. The server answers the GET check (signature + AES decrypt). If it fails: check the server logs and WeCom's online callback tester. [VERIFY §17.1: a bare IP URL is accepted for unverified accounts]
5. **Trusted IP (企业可信IP)** in the app → add the VPS IP (otherwise API calls fail with 60020).
6. **微信客服**: WeCom admin → 微信客服 → create an account (name + avatar) → note **open_kfid** → `WECOM_OPEN_KFID`.
7. 微信客服 → **API** → choose our self-built app as the app that can call the API. From now on, customer messages trigger our callback.
8. Set `APP_BASE_URL` to the public URL (links sent in WeChat) and a random `LINK_SECRET`. Restart.
9. In the web app → Settings → **Connect WeChat** shows a QR code; scan it with a personal WeChat → chat opens → send "hi" → you get the welcome. (Fallback: type the 6-digit code shown.)
10. **Acceptance tests (§17)**, by forwarding real things: a `msgmenu` tap arrives with `menu_id`; max `head_content` length (`WECOM_MENU_HEAD_MAX`); send budget (~5 messages / 48 h, `WECOM_SEND_BUDGET`); merged chat contents (author nicknames, media); PDFs forwarded from personal WeChat arrive as `file`; voice format (AMR/SILK) + ASR quality (`ELEVENLABS_API_KEY`). Note results in the blueprint and adjust the env values.

Errors you may see: **60020** IP not trusted (step 5) · **95027** account limit (unverified company) · **-50025** callback domain rejected (use the VPS IP) · **42001** token expired (auto-refreshed).

## Where things are

| Path | What |
|---|---|
| `lib/core/` | domain registry, ingest pipeline, entities, matters, facts, tasks, audit, extraction, replies, assistant |
| `lib/channels/` | WeCom crypto (unit-tested), access_token, `sync_msg`, media download, 6 s debounce, send budget, `msgmenu` |
| `lib/adapters/` | LLM (mock · gateway · anthropic · qwen; model per step; cost log), ASR, company registry |
| `app/` | web app (Home chat + memory, To file, Matters, Deadlines, Compare quotes, Contacts, Documents, WeChat bot, Settings) + API routes; pages refresh live via /api/pulse |
| `data/` | fictional registry with valid credit codes, demo documents with planted traps, golden answers |
| `tests/` | unit + end-to-end flows (`npm test`), live AI suite (`npm run test:live`) |
