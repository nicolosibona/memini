// UI primitives (v3). One visual language: white cards with one hairline on a warm near-white ground,
// near-black ink, one accent (seal vermilion) and status colours only where they carry meaning.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Page frame for every screen but Home: one content width, equal side gutters. */
export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`${narrow ? "max-w-[820px]" : "max-w-[1080px]"} mx-auto px-4 sm:px-8 py-10 sm:py-14`}>{children}</div>;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="enter flex flex-wrap items-end justify-between gap-4 mb-8">
      <div className="min-w-0">
        {eyebrow && <div className="text-[13px] font-medium text-muted mb-2 flex items-center gap-1.5">{eyebrow}</div>}
        <h1 className="display text-[40px] leading-[1.05] text-ink">{title}</h1>
        {description && <p className="text-[15px] leading-relaxed text-muted mt-2 max-w-[60ch]">{description}</p>}
      </div>
      {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-card border border-line rounded-2xl ${className}`}>{children}</div>;
}

export function Section({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mb-10 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {right && <div className="text-[13px] text-muted">{right}</div>}
      </div>
      {children}
    </section>
  );
}

type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "brand" | "wechat";
const TONE: Record<Tone, string> = {
  neutral: "bg-line-2 text-ink-2", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", info: "bg-info-soft text-info", brand: "bg-brand-soft text-brand-dark", wechat: "bg-wechat-soft text-wechat-dark",
};
export function Pill({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-medium whitespace-nowrap ${TONE[tone]} ${className}`}>{children}</span>;
}

export function Dot({ tone, live = false }: { tone: "ok" | "warn" | "bad" | "neutral" | "wechat"; live?: boolean }) {
  const c = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", neutral: "bg-faint", wechat: "bg-wechat" }[tone];
  return <span className={`inline-block size-2 rounded-full shrink-0 ${c} ${live ? "live-dot" : ""}`} />;
}

const TRUST = { red: ["bad", "Red flags"], amber: ["warn", "Check"], green: ["ok", "Clear"], grey: ["neutral", "No data"] } as const;
export function TrustPill({ trust }: { trust: keyof typeof TRUST }) {
  const [tone, label] = TRUST[trust];
  return <Pill tone={tone}><Dot tone={tone} />{label}</Pill>;
}
export const severityTone = (s: string) => (s === "red" ? "bad" : s === "amber" ? "warn" : "info") as "bad" | "warn" | "info";

export function Empty({ children, icon = "check" }: { children: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 text-[14px] text-muted gap-2.5">
      <span className="grid place-items-center size-9 rounded-full bg-line-2"><Icon name={icon} className="size-4 text-muted" /></span>
      <div className="max-w-[44ch]">{children}</div>
    </div>
  );
}

export const BTN = {
  primary: "bg-ink text-white hover:bg-ink-2 border-ink",
  secondary: "bg-card text-ink hover:bg-hover border-line",
  wechat: "bg-wechat text-white hover:bg-wechat-dark border-wechat",
};
export const btnCls = (variant: keyof typeof BTN = "primary", size: "md" | "sm" = "md") =>
  `press inline-flex items-center justify-center gap-2 rounded-full border font-medium transition-colors disabled:opacity-40 ${size === "md" ? "h-10 px-4 text-[14px]" : "h-8 px-3 text-[13px]"} ${BTN[variant]}`;

export function Button({ href, children, variant = "primary", icon }: { href: string; children: ReactNode; variant?: keyof typeof BTN; icon?: string }) {
  return (
    <Link href={href} className={btnCls(variant)}>
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </Link>
  );
}

export function Row({ href, children, className = "" }: { href?: string; children: ReactNode; className?: string }) {
  const cls = `flex items-center gap-3 px-5 py-3 text-[14px] ${href ? "hover:bg-hover transition-colors" : ""} ${className}`;
  return href ? <Link href={href} className={cls}>{children}</Link> : <div className={cls}>{children}</div>;
}

export function Stat({ label, value, tone = "neutral", href }: { label: string; value: ReactNode; tone?: "neutral" | "bad" | "warn" | "ok"; href?: string }) {
  const color = { neutral: "text-ink", bad: "text-bad", warn: "text-warn", ok: "text-ok" }[tone];
  const inner = (
    <Card className={`px-5 py-4 h-full ${href ? "lift" : ""}`}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={`display text-[34px] leading-none tabular mt-2 ${color}`}>{value}</div>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted tabular">
      <div className="h-1.5 w-16 rounded-full bg-line overflow-hidden"><div className={`h-full rounded-full transition-[width] duration-500 ${pct === 100 ? "bg-ok" : "bg-ink"}`} style={{ width: `${pct}%` }} /></div>
      {done}/{total}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink mb-6">
      <Icon name="back" className="size-3.5 transition-transform group-hover:-translate-x-0.5" />{children}
    </Link>
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

/** "just now", "5 min ago", "3 h ago", "Nov 18" */
export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const s = (Date.now() - +new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(iso);
}
