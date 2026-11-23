# Running your own Memini WeChat bot

Memini talks to WeChat users through **微信客服 (WeChat Customer Service)**, operated from a **WeCom (企业微信)** account.
Any personal WeChat can open the chat by scanning a QR code: users install nothing. The code side is done
(`lib/channels/wecom*.ts`, `app/api/wecom/callback`); what you need is the accounts, a server and the verification below.

> The hackathon deployment (server, WeCom account and AI keys) is no longer maintained. The steps below are how it was
> set up, so you can run your own.

## 1. Server

WeChat needs a public URL with a static IP to deliver messages. We used a **Tencent Cloud Lighthouse** VPS in
**Singapore** (Ubuntu 24.04, 2 vCPU): mainland and Hong Kong IPs are blocked by most Western AI APIs, Singapore works
for both WeChat and the AI provider. Open ports 22/80/443 and log in with an SSH key, then from the repository folder:

```bash
scripts/deploy.sh ubuntu@<server-ip>                         # served on http://<server-ip>
DOMAIN=memini.example.com scripts/deploy.sh ubuntu@<server-ip>   # same, with HTTPS (Caddy)
```

The script copies the code over SSH (no GitHub needed), installs Node 22, ffmpeg, pm2 and Caddy, sets the firewall,
creates the server's own `.env.local` (AI off until you add a key), builds, starts one pm2 process behind Caddy,
schedules a daily backup of `storage/` and checks `/api/health`. Re-run it to deploy updates. It never overwrites the
server's `.env.local` or its data; after editing `.env.local` on the server run `bash ~/memini/scripts/server-setup.sh`.

## 2. WeCom and 微信客服

1. **Register WeCom (企业微信)** with a real-name-verified WeChat account (may need a +86 number). Note the **CorpID**
   (My company → Company info) → `WECOM_CORP_ID`.
2. **Create a self-built app**: WeCom admin → App Management → Create app → **AgentId** and **Secret** →
   `WECOM_AGENT_ID`, `WECOM_APP_SECRET`.
3. **Receive messages (API接收)** in that app: URL `http://<server-ip>/api/wecom/callback` (or your domain); click
   *random* for **Token** and **EncodingAESKey** → `WECOM_CALLBACK_TOKEN`, `WECOM_ENCODING_AES_KEY`. Restart the server,
   then click Save in WeCom: the server answers WeCom's signed check.
4. **Trusted IP (企业可信IP)** in the app → add the server IP (otherwise API calls fail with 60020).
5. **微信客服** → create an account (name + avatar) → note its **open_kfid** → `WECOM_OPEN_KFID`.
6. 微信客服 → **API** → choose your self-built app as the app that handles it. From now on, users' messages reach the callback.
7. Set `APP_BASE_URL` to the public URL (used in links sent on WeChat) and a random `LINK_SECRET`. Restart.
8. In the web app open **WeChat** (top right): scan the QR code with a personal WeChat, send "hi" and you get the welcome.

Check `http://<server-ip>/api/health`: it reports the database, whether WeChat is configured and whether the AI key works.

## What we learned about the WeChat API

- **Send budget.** After each user message the bot can send about **5 messages** (error 95001 beyond that). Memini
  counts them (`WECOM_SEND_BUDGET`), keeps what doesn't fit and delivers it with the user's next message
  ("📬 I have 3 updates for you").
- **Bursts.** Forwarding several items arrives as separate messages. They are grouped with a 6-second debounce
  (`WECOM_DEBOUNCE_MS`) and answered once.
- **Buttons.** 微信客服 has no styled buttons; `msgmenu` items (tappable blue lines) are the only choices. Long text goes
  first, then the question with its choices (`WECOM_MENU_HEAD_MAX`).
- **Files.** The bilingual `.xlsx` is uploaded with `media/upload` and sent as a WeChat file; if the upload fails the bot
  points to the web app instead.
- **No Markdown.** WeChat shows `*stars*` literally: replies use plain text and emoji.
- **Voice notes** arrive as AMR/SILK; ffmpeg converts them and ElevenLabs transcribes them (`ELEVENLABS_API_KEY`).

Common errors: **60020** IP not trusted (step 4) · **95001** send limit reached · **95027** account limit (unverified
company) · **-50025** callback domain rejected (use the server IP) · **42001** token expired (refreshed automatically).

## Other channels (optional)

- **iPhone calendar.** Every deadline and appointment is in a subscribable feed (`/api/calendar/<token>.ics`). On
  WeChat send `/calendar` for the link; on the web it's under Deadlines.
- **Email to Memini.** Forwarded emails are read like WeChat items. Without a domain, point the server at a dedicated
  Gmail or QQ Mail inbox over IMAP (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD` = an app password, `EMAIL_INBOUND_ADDRESS`);
  with a domain on Cloudflare, use Email Routing → `scripts/cloudflare-email-worker.js`. See `.env.example`.
