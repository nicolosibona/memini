// Free Email-to-Memini without a domain: the server reads a dedicated mailbox (Gmail with an app password, or QQ Mail
// with an authorization code) over IMAP every IMAP_POLL_SECONDS, delivers each unread email, then marks it read.
// Started once from instrumentation.ts when IMAP_HOST is set. Runs beside the WeChat bot without blocking it.
import "server-only";
import { ImapFlow } from "imapflow";
import { deliverRaw } from "./email";

let started = false;
let running = false;

export function startImapPoller() {
  if (started || !process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASSWORD) return;
  started = true;
  const every = Math.max(20, Number(process.env.IMAP_POLL_SECONDS ?? 60)) * 1000;
  console.log(`[imap] polling ${process.env.IMAP_USER} every ${every / 1000}s`);
  const tick = () => { void pollOnce().catch((e) => console.error("[imap] poll failed:", e instanceof Error ? e.message : e)); };
  setTimeout(tick, 5000);
  setInterval(tick, every).unref();
}

export async function pollOnce(): Promise<number> {
  if (running) return 0; // never two polls at once
  running = true;
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!, port: Number(process.env.IMAP_PORT ?? 993), secure: process.env.IMAP_SECURE !== "0",
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! }, logger: false,
  });
  let n = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(process.env.IMAP_MAILBOX ?? "INBOX");
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of uids.slice(0, 20)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && msg.source) {
          try {
            const r = await deliverRaw(msg.source, { via: "imap", notify: true });
            console.log(`[imap] uid ${uid}: ${r.ok ? `delivered (${r.replies.length} replies)` : `skipped: ${r.reason}`}`);
            n++;
          } catch (e) { console.error(`[imap] uid ${uid} failed:`, e); }
        }
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); // read either way: a refused email isn't retried
      }
    } finally {
      lock.release();
    }
  } finally {
    running = false;
    await client.logout().catch(() => {});
  }
  return n;
}
