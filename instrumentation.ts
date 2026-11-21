// Runs once when the Node server starts: background jobs that live beside the request handlers.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.IMAP_HOST) {
    const { startImapPoller } = await import("@/lib/channels/imap");
    startImapPoller(); // Email-to-Memini from a free mailbox (no domain needed)
  }
}
