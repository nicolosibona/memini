"use client";
// Settings → Email to Memini: the address to forward to (when a mailbox is connected), and a simulator that runs an
// email through the same brain right now — no mailbox, no domain.
import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { ReplyBubble } from "./ReplyBubble";
import { btnCls, Pill } from "./ui";
import type { OutgoingReply } from "@/lib/core/reply";

type Info = { address: string | null; mode: "imap" | "cloudflare" | "off"; token: string };

export function EmailCard({ initial }: { initial: Info }) {
  const [info, setInfo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [replies, setReplies] = useState<OutgoingReply[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const rotate = async () => {
    if (!confirm("Reset the address? Emails sent to the old one will be refused.")) return;
    const r = await fetch("/api/inbound/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rotate" }) });
    if (r.ok) setInfo(await r.json());
  };
  const simulate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true); setErr(null); setReplies([]);
    try {
      const r = await fetch("/api/inbound/email", { method: "POST", body: new FormData(e.currentTarget) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      setReplies(j.replies);
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-line bg-card p-5 text-[14px]">
      <div className="flex items-center gap-2">
        <span className="font-medium">📧 Forward emails to Memini</span>
        {info.mode === "off" ? <Pill tone="warn">No mailbox connected</Pill> : <Pill tone="ok">{info.mode === "imap" ? "Mailbox connected" : "Domain connected"}</Pill>}
      </div>
      <p className="text-[13.5px] text-muted mt-1">PIs, quotes, B/Ls, your accountant&apos;s mails: forward them (or BCC this address) and they go through the same checks as WeChat — a PI by email is compared with what was agreed in the chat.</p>

      {info.address ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-line-2 px-3 py-1.5 text-[13px] break-all">{info.address}</code>
          <CopyButton text={info.address} label="Copy address" />
          <button onClick={rotate} className={btnCls("secondary", "sm")}>Reset</button>
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-ink-2">To get an address, connect a free mailbox on the server (README → <b>Email to Memini</b>). Meanwhile try it here, or drop an <code>.eml</code> file in the Home chat.</p>
      )}

      <details className="mt-4 rounded-xl border border-line">
        <summary className="cursor-pointer px-4 py-2.5 font-medium">Simulate an incoming email</summary>
        <form onSubmit={simulate} className="px-4 pb-4 space-y-2.5">
          <div className="grid sm:grid-cols-2 gap-2.5">
            <input name="from" placeholder="From (e.g. lisa@abc-tech.cn)" className="rounded-lg border border-line px-3 h-9 text-[13px]" />
            <input name="subject" placeholder="Subject (e.g. PI-2026-118 revised)" className="rounded-lg border border-line px-3 h-9 text-[13px]" />
          </div>
          <textarea name="body" rows={5} placeholder={"Paste the email text. A forwarded one works too:\n---------- Forwarded message ---------\nFrom: Lisa <lisa@abc-tech.cn>\n…"} className="w-full rounded-lg border border-line px-3 py-2 text-[13px]" />
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
            <label>Attachments <input type="file" name="files" multiple accept="image/*,application/pdf,.html,.txt" className="ml-1 text-[12.5px]" /></label>
            <label>or an .eml file <input type="file" name="eml" accept=".eml,message/rfc822" className="ml-1 text-[12.5px]" /></label>
          </div>
          {err && <div className="text-[12.5px] text-bad">{err}</div>}
          <button disabled={busy} className={btnCls("primary", "sm")}>{busy ? "Reading…" : "Send to Memini"}</button>
        </form>
        {replies.length > 0 && <div className="px-4 pb-4 space-y-4 border-t border-line-2 pt-4">{replies.map((r, i) => <ReplyBubble key={i} reply={r} />)}</div>}
      </details>
    </div>
  );
}
