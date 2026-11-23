"use client";
// The user's language (what the supplier's Chinese is translated into). Same setting as /lang in the WeChat bot.
import { useTransition } from "react";
import { useRouter } from "next/navigation";

export type LangOption = { code: string; label: string; full: boolean };

/** `variant="chip"`: the small pill on Today ("🇮🇹 Italiano ⇄ 中文"); `"field"`: the Settings control. */
export function LanguagePicker({ value, options, variant = "chip" }: { value: string; options: LangOption[]; variant?: "chip" | "field" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (code: string) => start(async () => {
    const r = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reply_language: code }) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error ?? "Failed");
    router.refresh();
  });
  const full = options.filter((o) => o.full), ai = options.filter((o) => !o.full);
  const select = (
    <select
      aria-label="Your language"
      value={value}
      disabled={pending}
      onChange={(e) => set(e.target.value)}
      className={variant === "chip"
        ? "appearance-none bg-transparent pr-1 text-[12px] text-ink-2 cursor-pointer focus-visible:outline-none disabled:opacity-60"
        : "w-full sm:w-72 rounded-xl border border-line bg-card px-3 h-10 text-[14px] text-ink cursor-pointer disabled:opacity-60"}
    >
      <optgroup label="Bot, sheet and translations">
        {full.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      </optgroup>
      <optgroup label="Translations by AI (bot in English)">
        {ai.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
      </optgroup>
    </select>
  );
  if (variant === "field") return select;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-card/70 pl-2.5 pr-2 h-6 text-[12px] text-ink-2">
      <span className="size-1.5 rounded-full bg-brand" />Electronics spec check ·{select}⇄ 中文
    </span>
  );
}
