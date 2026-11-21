"use client";
// The "Connect WeChat" QR: a one-time contact link for the 微信客服 account (valid 10 minutes),
// plus a 6-digit fallback code. Opens full screen for showing it on a projector.
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "./Icon";
import { btnCls } from "./ui";

type Link = { url: string; code: string; exp: number };

export function WeChatQR({ enabled, linked }: { enabled: boolean; linked: boolean }) {
  const [link, setLink] = useState<Link | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [big, setBig] = useState(false);

  const make = useCallback(async () => {
    if (!enabled) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/link/wechat", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setLink({ url: j.url, code: j.code, exp: Date.now() + 10 * 60000 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, [enabled]);

  useEffect(() => { void make(); }, [make]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setBig(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [big]);

  const left = link ? Math.max(0, link.exp - now) : 0;
  const expired = !!link && left === 0;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

  if (!enabled) {
    return (
      <div className="aspect-square w-full max-w-[300px] mx-auto rounded-3xl border border-dashed border-line grid place-items-center text-center p-8">
        <div>
          <Icon name="qr" className="size-8 text-faint mx-auto" />
          <p className="text-[14px] text-muted mt-3">The QR code appears once the WeChat keys are set on the server.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div className={`rounded-3xl bg-white p-5 border border-line transition-opacity ${expired || busy ? "opacity-30" : ""}`}>
          {link ? <QRCodeSVG value={link.url} size={240} level="M" marginSize={0} fgColor="#1a1917" /> : <div className="size-[240px] rounded-xl bg-line-2 animate-pulse" />}
        </div>
        {link && !expired && !busy && (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center size-12 rounded-xl bg-white">
            <span className="grid place-items-center size-10 rounded-[9px] bg-wechat text-white"><Icon name="wechat" className="size-6" /></span>
          </span>
        )}
        {expired && (
          <button onClick={() => void make()} className={`${btnCls("primary")} absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`}>
            <Icon name="refresh" className="size-4" />New code
          </button>
        )}
      </div>

      {err ? (
        <p className="text-[13.5px] text-bad mt-4 text-center max-w-[300px]">{err}</p>
      ) : link && !expired ? (
        <div className="mt-5 text-center">
          <div className="text-[13px] text-muted">Or send this code in the chat</div>
          <div className="font-mono text-[28px] tracking-[0.2em] tabular mt-1">{link.code}</div>
          <div className="text-[12.5px] text-faint mt-1 tabular">Expires in {mmss}</div>
        </div>
      ) : null}

      <div className="flex gap-2 mt-5">
        <button onClick={() => void make()} disabled={busy} className={btnCls("secondary", "sm")}><Icon name="refresh" className="size-3.5" />Refresh</button>
        <button onClick={() => setBig(true)} disabled={!link || expired} className={btnCls("secondary", "sm")}><Icon name="expand" className="size-3.5" />Full screen</button>
      </div>
      {linked && <p className="text-[13px] text-muted mt-4 text-center max-w-[300px]">Your WeChat is already connected. Scanning again links another WeChat account in its place.</p>}

      {big && link && (
        <div className="fixed inset-0 z-50 bg-paper grid place-items-center p-6 rise" onClick={() => setBig(false)} role="dialog" aria-label="WeChat QR code">
          <div className="text-center">
            <div className="display text-[44px] leading-tight">Scan to talk to Memini</div>
            <p className="text-[16px] text-muted mt-2">Open WeChat → Scan. Then forward anything you want remembered.</p>
            <div className="inline-block rounded-[32px] bg-white p-8 border border-line mt-8">
              <QRCodeSVG value={link.url} size={360} level="M" marginSize={0} fgColor="#1a1917" />
            </div>
            <div className="font-mono text-[32px] tracking-[0.2em] mt-6 tabular">{link.code}</div>
            <button onClick={() => setBig(false)} className={`${btnCls("secondary")} mt-6`}><Icon name="x" className="size-4" />Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
