"use client";
// "Needs you" on Today: each flag is one calm line; open it to see the evidence and act without leaving the page.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "../Icon";
import type { AlertView } from "../Detail";

const TONE = { red: "bg-bad", amber: "bg-warn", info: "bg-info" } as const;

export function AttentionList({ alerts }: { alerts: AlertView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const act = (id: number, status: "acknowledged" | "dismissed") => start(async () => {
    const r = await fetch(`/api/alerts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error ?? "Something went wrong");
    setOpen(null);
    router.refresh();
  });
  return (
    <div className="divide-y divide-line @container">
      {alerts.map((a) => {
        const on = open === a.id;
        return (
          <div key={a.id}>
            <button onClick={() => setOpen(on ? null : a.id)} aria-expanded={on} className="w-full flex items-start gap-3 px-6 py-3.5 text-left hover:bg-hover transition-colors">
              <span className={`mt-[7px] size-2 rounded-full shrink-0 ${TONE[a.severity as keyof typeof TONE] ?? "bg-info"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-snug">{a.title}</span>
                {a.context?.label && <span className="block text-[12.5px] text-muted truncate mt-0.5">{a.context.label}</span>}
              </span>
              <Icon name="down" className={`size-4 text-faint mt-0.5 shrink-0 transition-transform ${on ? "rotate-180" : ""}`} />
            </button>
            {on && (
              <div className="px-6 pb-5 pl-[44px] rise">
                {a.detail && <p className="text-[13.5px] leading-relaxed text-ink-2">{a.detail}</p>}
                {a.evidence.length > 0 && (
                  <div className="grid gap-2 mt-3 @md:grid-cols-2">
                    {a.evidence.slice(0, 2).map((e) => (
                      <div key={e.id} className="rounded-2xl bg-ivory border border-line px-3.5 py-2.5 text-[13px]">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-medium tabular">{e.value}</span>
                          <span className="text-[11.5px] text-faint shrink-0">{e.source}</span>
                        </div>
                        {e.quote && e.quote !== e.value && <div className="mt-1 text-muted">“{e.quote}”</div>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-3.5">
                  <button disabled={pending} onClick={() => act(a.id, "acknowledged")} className="press rounded-full border border-line bg-card px-3.5 h-8 text-[12.5px] hover:bg-hover disabled:opacity-50">Cleared up</button>
                  <button disabled={pending} onClick={() => act(a.id, "dismissed")} className="press rounded-full border border-line bg-card px-3.5 h-8 text-[12.5px] hover:bg-hover disabled:opacity-50">False alarm</button>
                  {a.context && <Link href={a.context.href} className="bracket ml-auto">Open</Link>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
