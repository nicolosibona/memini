// UI primitives. One visual language: hairline borders, white cards on warm paper, one accent (seal red),
// status colours only where they carry meaning.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-medium text-muted mb-1.5 flex items-center gap-1.5">{eyebrow}</div>}
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-sm text-muted mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-card border border-line rounded-[10px] ${className}`}>{children}</div>;
}

export function Section({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mb-8 ${className}`}>
      <div className="flex items-baseline justify-between mb-2.5">
        <h2 className="text-[13px] font-semibold text-ink-2 uppercase tracking-[0.04em]">{title}</h2>
        {right && <div className="text-xs text-muted">{right}</div>}
      </div>
      {children}
    </section>
  );
}

type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "brand";
const TONE: Record<Tone, string> = {
  neutral: "bg-line-2 text-ink-2", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", info: "bg-info-soft text-info", brand: "bg-brand-soft text-brand-dark",
};
export function Pill({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${TONE[tone]} ${className}`}>{children}</span>;
}

export function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "neutral" }) {
  const c = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", neutral: "bg-faint" }[tone];
  return <span className={`inline-block size-2 rounded-full shrink-0 ${c}`} />;
}

const TRUST = { red: ["bad", "Red flags"], amber: ["warn", "Check"], green: ["ok", "Clear"], grey: ["neutral", "No data"] } as const;
export function TrustPill({ trust }: { trust: keyof typeof TRUST }) {
  const [tone, label] = TRUST[trust];
  return <Pill tone={tone}><Dot tone={tone} />{label}</Pill>;
}
export const severityTone = (s: string) => (s === "red" ? "bad" : s === "amber" ? "warn" : "info") as "bad" | "warn" | "info";

export function Empty({ children, icon = "check" }: { children: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 px-4 text-sm text-muted gap-2">
      <Icon name={icon} className="size-5 text-faint" />
      <div>{children}</div>
    </div>
  );
}

export function Button({ href, children, variant = "primary", icon }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; icon?: string }) {
  const cls = variant === "primary"
    ? "bg-ink text-white hover:bg-ink-2 border-ink"
    : "bg-card text-ink hover:bg-hover border-line";
  return (
    <Link href={href} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${cls}`}>
      {icon && <Icon name={icon} className="size-3.5" />}
      {children}
    </Link>
  );
}

export function Row({ href, children, className = "" }: { href?: string; children: ReactNode; className?: string }) {
  const cls = `flex items-center gap-3 px-4 py-2.5 text-sm ${href ? "hover:bg-hover transition-colors" : ""} ${className}`;
  return href ? <Link href={href} className={cls}>{children}</Link> : <div className={cls}>{children}</div>;
}

export function Stat({ label, value, tone = "neutral", href }: { label: string; value: ReactNode; tone?: "neutral" | "bad" | "warn" | "ok"; href?: string }) {
  const color = { neutral: "text-ink", bad: "text-bad", warn: "text-warn", ok: "text-ok" }[tone];
  const inner = (
    <Card className={`px-4 py-3 h-full ${href ? "hover:border-faint transition-colors" : ""}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-semibold tabular mt-0.5 ${color}`}>{value}</div>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs text-muted tabular">
      <div className="h-1.5 w-16 rounded-full bg-line overflow-hidden"><div className={`h-full rounded-full ${pct === 100 ? "bg-ok" : "bg-ink-2"}`} style={{ width: `${pct}%` }} /></div>
      {done}/{total}
    </div>
  );
}

export function fmtDate(iso: string | null | undefined, opts: { year?: boolean } = {}) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(opts.year ? { year: "numeric" } : {}) });
}

/** "in 5 days", "today", "3 days late" */
export function relDay(iso: string | null | undefined) {
  if (!iso) return "";
  const t = new Date(new Date().toISOString().slice(0, 10)).getTime();
  const d = Math.round((new Date(iso.slice(0, 10)).getTime() - t) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days late`;
}
