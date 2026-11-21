"use client";
// "Your deadlines in your phone's calendar": scan with the iPhone camera (opens Safari → Add to Calendar),
// or add on this device, or copy the feed URL. Reset makes the old link stop working.
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CopyButton } from "./CopyButton";
import { Card, btnCls } from "./ui";

type Links = { feed: string; webcal: string; page: string };

export function CalendarCard({ initial }: { initial: Links }) {
  const [links, setLinks] = useState(initial);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    if (!confirm("Reset the calendar link? Calendars subscribed with the old link stop updating; you'll need to add the new one.")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rotate" }) });
      if (r.ok) setLinks(await r.json());
    } finally { setBusy(false); }
  };
  return (
    <Card className="p-6 flex flex-col sm:flex-row gap-6">
      <a href={links.page} target="_blank" rel="noreferrer" className="shrink-0 self-center sm:self-start rounded-2xl border border-line p-3 bg-white" title="Scan with your iPhone camera">
        <QRCodeSVG value={links.page} size={132} level="M" marginSize={0} fgColor="#161513" />
      </a>
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-medium tracking-[-0.01em] text-ink">Your deadlines in the iPhone Calendar</div>
        <p className="text-[13.5px] text-muted mt-1.5 leading-relaxed">
          WeChat can only message you for 48 hours after you last wrote. Your phone&apos;s calendar has no limit: every renewal, payment and promise shows up with reminders and stays in sync.
        </p>
        <ol className="text-[13.5px] text-ink-2 mt-3 space-y-1 list-decimal pl-5">
          <li>Scan the code with the <b className="font-medium text-ink">iPhone camera</b> (not WeChat).</li>
          <li>Tap <b className="font-medium text-ink">Add to Calendar</b> → <b className="font-medium text-ink">Subscribe</b> → <b className="font-medium text-ink">Add</b>.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <a href={links.webcal} className={btnCls("primary", "sm")}>Add on this device</a>
          <CopyButton text={links.feed} label="Copy feed URL" />
          <button type="button" onClick={reset} disabled={busy} className="bracket disabled:opacity-40">Reset link</button>
        </div>
        <p className="text-[12.5px] text-faint mt-3 leading-relaxed">Mac: Calendar → File → New Calendar Subscription → paste the URL. Google Calendar: Other calendars → From URL (refreshes every few hours, blocked in mainland China).</p>
      </div>
    </Card>
  );
}
