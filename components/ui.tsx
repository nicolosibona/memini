// UI primitives (v4). Bento cards on a warm alabaster ground, hairline borders, near-black pill actions,
// corner-bracket secondary controls, two-tone headlines. Status colours only where they carry meaning.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Content frame: one centered column, room for the floating nav above and the ask dock below. */
export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`${narrow ? "max-w-[880px]" : "max-w-[1240px]"} mx-auto px-4 sm:px-8 pt-28 sm:pt-32 pb-36`}>{children}</div>;
}

/** Two-tone headline: the ink phrase says what this is, the stone phrase says what it's for. */
export function Headline({ lead, rest, className = "" }: { lead: ReactNode; rest?: ReactNode; className?: string }) {
  return (
    <h1 className={`text-[28px] sm:text-[40px] leading-[1.12] font-medium tracking-[-0.03em] text-pretty ${className}`}>
      <span className="text-ink">{lead}</span>
      {rest ? <> <span className="text-stone">{rest}</span></> : null}
    </h1>
  );
}

/** A short paragraph under a headline: the explanation lives here so the two-tone headline stays a phrase. */
export function Lede({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[15px] leading-relaxed text-muted max-w-[62ch] mt-3 ${className}`}>{children}</p>;
}

export function PageHeader({ title, rest, description, actions, eyebrow }: { title: ReactNode; rest?: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="enter flex flex-wrap items-end justify-between gap-x-8 gap-y-4 mb-8">
      <div className="min-w-0 max-w-[780px]">
        {eyebrow && <div className="text-[12.5px] font-medium text-faint mb-3 flex items-center gap-1.5">{eyebrow}</div>}
        <Headline lead={title} rest={rest} />
        {description && <Lede>{description}</Lede>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

type CardTone = "white" | "ivory" | "brand" | "night";
const CARD_TONE: Record<CardTone, string> = {
  white: "bg-card border-line",
  ivory: "bg-ivory border-line",
  brand: "bg-brand-soft/60 border-brand/15",
  night: "bg-night border-white/10 text-white",
};
/** A Bento tile: soft inner light, whisper-thin border, diffused shadow. */
export function Card({ children, className = "", tone = "white" }: { children: ReactNode; className?: string; tone?: CardTone }) {
  return <div className={`${CARD_TONE[tone]} border rounded-3xl shadow-bento ${className}`}>{children}</div>;
}

/** Header strip inside a Bento tile: title, a quiet count, and one bracket action on the right. */
export function CardHead({ title, count, href, action, className = "" }: { title: ReactNode; count?: ReactNode; href?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-6 pt-5 pb-3 ${className}`}>
      <h3 className="text-[15px] font-medium text-ink flex items-center gap-2">
        {title}
        {count != null && count !== "" && <span className="text-[12.5px] font-normal text-faint tabular">{count}</span>}
      </h3>
      {action ?? (href && <BracketLink href={href}>All</BracketLink>)}
    </div>
  );
}

export function Section({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mb-10 ${className}`}>
      <div className="flex items-baseline justify-between gap-3 mb-3 px-1">
        <h2 className="text-[15px] font-medium text-ink">{title}</h2>
        {right && <div className="text-[13px] text-faint">{right}</div>}
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
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap ${TONE[tone]} ${className}`}>{children}</span>;
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
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 text-[14px] text-muted gap-3">
      <span className="grid place-items-center size-10 rounded-full bg-line-2 ring-1 ring-line"><Icon name={icon} className="size-[18px] text-faint" /></span>
      <div className="max-w-[44ch] leading-relaxed">{children}</div>
    </div>
  );
}

export const BTN = {
  primary: "bg-ink text-white hover:bg-ink-2 border-ink",
  secondary: "bg-card/80 text-ink hover:bg-card hover:border-ink/25 border-line",
  wechat: "bg-wechat-dark text-white hover:bg-[#046e36] border-wechat-dark",
  quiet: "bg-transparent text-ink-2 hover:bg-hover border-transparent",
};
export const btnCls = (variant: keyof typeof BTN = "primary", size: "md" | "sm" = "md") =>
  `press inline-flex items-center justify-center gap-2 rounded-full border font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${size === "md" ? "h-11 px-5 text-[14px]" : "h-9 px-4 text-[13px]"} ${BTN[variant]}`;

export function Button({ href, children, variant = "primary", icon }: { href: string; children: ReactNode; variant?: keyof typeof BTN; icon?: string }) {
  return (
    <Link href={href} className={btnCls(variant)}>
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </Link>
  );
}

/** Restrained secondary control: [ label ]. Soft navigation (opens drawers where a drawer exists). */
export function BracketLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="bracket">{children}</Link>;
}

export function Row({ href, children, className = "" }: { href?: string; children: ReactNode; className?: string }) {
  const cls = `flex items-center gap-3 px-6 py-3.5 text-[14px] ${href ? "hover:bg-hover transition-colors" : ""} ${className}`;
  return href ? <Link href={href} className={cls}>{children}</Link> : <div className={cls}>{children}</div>;
}

/** A hero figure: serif numeral over a quiet label. */
export function Figure({ label, value, tone = "neutral", href, hint }: { label: string; value: ReactNode; tone?: "neutral" | "bad" | "warn" | "ok"; href?: string; hint?: ReactNode }) {
  const color = { neutral: "text-ink", bad: "text-bad", warn: "text-warn", ok: "text-ok" }[tone];
  const inner = (
    <Card className={`px-6 py-5 h-full ${href ? "lift" : ""}`}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={`display text-[44px] leading-none tabular mt-3 ${color}`}>{value}</div>
      {hint && <div className="text-[12.5px] text-faint mt-2">{hint}</div>}
    </Card>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted tabular">
      <div className="h-1 w-16 rounded-full bg-line overflow-hidden"><div className={`h-full rounded-full transition-[width] duration-500 ${pct === 100 ? "bg-ok" : "bg-ink"}`} style={{ width: `${pct}%` }} /></div>
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

/** Hairline field styling shared by every form control. */
export const FIELD = "rounded-xl border border-line bg-card px-3.5 h-10 text-[14px] text-ink placeholder:text-faint focus-visible:border-ink/40";

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
