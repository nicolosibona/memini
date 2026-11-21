// Phone page for subscribing to the live calendar. Reached by scanning the QR on /deadlines with the iPhone camera
// (opens in Safari) or from the /calendar command in WeChat (opens in WeChat's browser, which can't add calendars:
// the page says how to switch to Safari).
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { appDb } from "@/lib/server";
import { resolveToken } from "@/lib/core/tokens";
import { calendarFeedUrl, feedTasks, webcalUrl, eventSummary } from "@/lib/core/calendar";
import { CopyButton } from "@/components/CopyButton";
import { fmtDay } from "@/lib/core/facts";
import { today } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add to Calendar", robots: { index: false } };

export default async function CalendarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await appDb();
  const t = resolveToken(db, token, "calendar");
  if (!t) notFound();
  const ua = (await headers()).get("user-agent") ?? "";
  const inWeChat = /MicroMessenger/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const upcoming = feedTasks(db, t.workspace_id).filter((x) => x.status === "open" && x.due_at && x.due_at >= today()).slice(0, 4);
  const feed = calendarFeedUrl(token);

  return (
    <div className="max-w-md mx-auto px-5 pt-6 pb-16 text-[16px] leading-relaxed">
      <div className="flex items-center gap-2 text-[14px] text-muted mb-6">
        <span className="grid place-items-center size-7 rounded-lg bg-brand text-white text-[13px] font-[family-name:var(--font-seal)]">印</span>
        <span className="display text-[20px] text-ink">Memini</span>
      </div>

      <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Your deadlines in the iPhone Calendar</h1>
      <p className="text-ink-2 mt-2">Every renewal, payment and promise Memini tracks, with reminders. It updates by itself.</p>

      {inWeChat && (
        <div className="mt-5 rounded-2xl border-2 border-brand bg-brand-soft p-4">
          <div className="flex items-start gap-3">
            <span className="text-[28px] leading-none">↗︎</span>
            <div>
              <div className="font-semibold text-[17px]">First, open this page in Safari</div>
              <div className="text-ink-2 mt-1">WeChat can&apos;t add calendars. Tap <b>···</b> at the top right, then <b>Open in Safari</b> (在Safari中打开).</div>
            </div>
          </div>
        </div>
      )}

      {!isAndroid && (
        <a href={webcalUrl(token)} className={`press mt-6 flex items-center justify-center gap-2 w-full h-14 rounded-2xl text-[17px] font-semibold ${inWeChat ? "bg-line-2 text-muted" : "bg-ink text-white"}`}>
          📅 Add to Calendar
        </a>
      )}
      {!isAndroid && <p className="text-[14px] text-muted mt-2 text-center">Then tap <b>Subscribe</b> → <b>Add</b>.</p>}

      {upcoming.length > 0 && (
        <div className="mt-7 rounded-2xl border border-line bg-card divide-y divide-line-2">
          <div className="px-4 py-2.5 text-[13px] text-muted">Coming up</div>
          {upcoming.map((x) => (
            <div key={x.id} className="px-4 py-3 flex gap-3">
              <div className="text-[13px] text-muted w-[74px] shrink-0 tabular pt-0.5">{x.due_at!.slice(0, 4) === today().slice(0, 4) ? fmtDay(x.due_at!).replace(/, \d{4}$/, "") : fmtDay(x.due_at!)}</div>
              <div className="text-[15px]">{eventSummary(x)}</div>
            </div>
          ))}
        </div>
      )}

      <details className="mt-7 rounded-2xl border border-line bg-card p-4" open={isAndroid}>
        <summary className="font-medium cursor-pointer">{isAndroid ? "Add it to Google Calendar" : "The button doesn't work?"}</summary>
        {isAndroid ? (
          <ol className="list-decimal pl-5 mt-3 space-y-1.5 text-ink-2 text-[15px]">
            <li>Copy the link below.</li>
            <li>On a computer, open Google Calendar → <b>Other calendars</b> → <b>+</b> → <b>From URL</b>, paste, <b>Add calendar</b>.</li>
            <li>It appears on your phone after the next sync (Google refreshes every few hours).</li>
          </ol>
        ) : (
          <ol className="list-decimal pl-5 mt-3 space-y-1.5 text-ink-2 text-[15px]">
            <li>Copy the link below.</li>
            <li>Open <b>Settings</b> → <b>Calendar</b> → <b>Accounts</b> → <b>Add Account</b> → <b>Other</b>.</li>
            <li>Tap <b>Add Subscribed Calendar</b>, paste the link, tap <b>Next</b> → <b>Save</b>.</li>
          </ol>
        )}
        <div className="mt-3 rounded-xl bg-line-2 px-3 py-2.5 font-mono text-[12.5px] break-all select-all">{feed}</div>
        <div className="mt-2.5"><CopyButton text={feed} label="Copy link" /></div>
      </details>

      <p className="text-[13px] text-faint mt-6">Keep this link private: anyone with it can see your deadlines. You can reset it in Memini → Deadlines.</p>
    </div>
  );
}
