"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { btnCls } from "./ui";

export function ProfileForm({ profile, ownNames, profiles }: { profile: string; ownNames: string[]; profiles: { key: string; label: string; description: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [names, setNames] = useState(ownNames.join("\n"));
  const [saved, setSaved] = useState(false);
  const patch = (body: unknown) => start(async () => {
    const r = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error ?? "Failed");
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    router.refresh();
  });
  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label="Workspace profile" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {profiles.map((p) => {
          const on = profile === p.key;
          return (
            <button key={p.key} role="radio" aria-checked={on} disabled={pending} onClick={() => patch({ profile: p.key })}
              className={`press text-left rounded-2xl border p-5 transition-colors disabled:opacity-60 ${on ? "border-ink bg-ivory shadow-[0_0_0_1px_var(--color-ink)]" : "border-line bg-card hover:bg-hover"}`}>
              <div className="flex items-center gap-2.5 text-[14.5px] font-medium text-ink">
                <span className={`size-4 rounded-full border shrink-0 ${on ? "border-[5px] border-ink bg-white" : "border-faint"}`} />{p.label}
              </div>
              <div className="text-[13px] text-muted mt-1.5 leading-relaxed pl-[26px]">{p.description}</div>
            </button>
          );
        })}
      </div>
      <div>
        <label htmlFor="own-names" className="text-[13.5px] font-medium text-ink">Your own company and people</label>
        <p className="text-[12.5px] text-muted mt-0.5 mb-2 leading-relaxed">Never treated as a counterparty (e.g. the buyer on a proforma, the tenant on a lease), and used to file your own passport and permits. One per line.</p>
        <textarea id="own-names" value={names} onChange={(e) => setNames(e.target.value)} rows={4} className="mono w-full rounded-2xl border border-line bg-card px-4 py-3 text-[13.5px] leading-relaxed text-ink placeholder:text-faint focus-visible:border-ink/40" />
        <button disabled={pending} onClick={() => patch({ own_names: names.split("\n") })} className={`${btnCls("primary", "sm")} mt-3`}>{saved ? "Saved" : "Save names"}</button>
      </div>
    </div>
  );
}

export function DemoReset() {
  const router = useRouter();
  const go = async (body: unknown, msg: string) => { if (confirm(msg)) { await fetch("/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); router.refresh(); } };
  return (
    <div className="flex flex-wrap gap-2">
      <button className={btnCls("secondary", "sm")} onClick={() => go({ profile: "china_business" }, "Replace all data with the 'Doing business in China' demo?")}>Load business demo</button>
      <button className={btnCls("secondary", "sm")} onClick={() => go({ profile: "sourcing" }, "Replace all data with the 'Sourcing buyer' demo?")}>Load sourcing demo</button>
      <button className={btnCls("primary", "sm")} onClick={() => go({ profile: "electronics" }, "Start the 'Electronics spec check' demo? All current data is cleared; forward the demo documents to the bot.")}>Start electronics demo</button>
      <button className="press inline-flex items-center justify-center rounded-full border border-bad/30 bg-transparent text-bad h-9 px-4 text-[13px] font-medium hover:bg-bad-soft" onClick={() => go({ empty: true }, "Delete ALL contacts, matters, documents and deadlines? This cannot be undone.")}>Delete all data</button>
    </div>
  );
}
