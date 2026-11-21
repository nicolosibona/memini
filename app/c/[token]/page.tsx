// The page a counterparty opens from WeChat: confirm the terms in one tap, ask for a change, upload what's missing.
// Built for WeChat's in-app browser on a phone: Chinese first with English underneath, big type and tap targets,
// plain forms (no JavaScript needed), nothing from Memini's own checks or notes.
import { notFound } from "next/navigation";
import { appDb } from "@/lib/server";
import { docSlots, getLink, isExpired, linkHistory, markOpened, type Snapshot } from "@/lib/core/confirm";
import { SupplierUpload } from "@/components/SupplierUpload";

export const dynamic = "force-dynamic";
export const metadata = { title: "请确认 · Please confirm", robots: { index: false } };

const ERR: Record<string, [string, string]> = {
  expired: ["链接已过期，请联系对方重新发送。", "This link has expired. Please ask for a new one."],
  rate: ["操作太频繁，请稍后再试。", "Too many attempts. Please try again in a few minutes."],
  too_big: ["文件太大（最大 15 MB），请换一张照片或压缩后再传。", "File too large (max 15 MB)."],
  type: ["只支持照片（JPG、PNG）和 PDF 文件。", "Only photos (JPG, PNG) and PDF files."],
  limit: ["已达到上传数量上限，请直接发给对方。", "Upload limit reached — please send the rest directly."],
  nofile: ["没有选择文件。", "No file selected."],
  empty: ["请写下需要修改的内容。", "Please write what should change."],
  nothing_to_confirm: ["没有需要确认的条款。", "There are no terms to confirm."],
  bad: ["出错了，请重试。", "Something went wrong — please try again."],
};
const OK: Record<string, [string, string]> = {
  changes: ["✓ 修改意见已发送，对方会尽快回复。", "Your change request was sent."],
  uploaded: ["✓ 文件已收到，谢谢！", "File received — thank you!"],
};

const fmt = (iso: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: process.env.APP_TIMEZONE ?? "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default async function ConfirmPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token } = await params;
  const q = await searchParams;
  const db = await appDb();
  const link = getLink(db, token);
  if (!link) notFound();
  if (!q.ok && !q.err) markOpened(db, token);

  const snap = JSON.parse(link.terms_json) as Snapshot;
  const expired = isExpired(link);
  const history = linkHistory(db, token);
  const confirmed = history.find((h) => h.action === "confirmed");
  const changes = history.filter((h) => h.action === "changes_requested");
  const uploads = history.filter((h) => h.action === "uploaded");
  const slots = docSlots(db, link);
  const hasTerms = snap.terms.length > 0;
  const noun = snap.matter_kind === "lease" ? ["租赁条款", "lease terms"] : snap.matter_kind === "purchase" ? ["订单条款", "order terms"] : ["条款", "terms"];
  const title = !hasTerms ? ["请上传文件", "Please upload documents"] : confirmed ? [`${noun[0]}已确认`, `The ${noun[1]} are confirmed`] : [`请确认${noun[0]}`, `Please confirm the ${noun[1]}`];
  const banner = q.err ? ERR[q.err] ?? ERR.bad : q.ok ? OK[q.ok] : undefined;

  return (
    <div lang="zh-CN" className="max-w-lg mx-auto px-4 pt-5 pb-14 text-ink">
      <div className="flex items-center justify-between text-[13px] text-muted mb-5">
        <span className="flex items-center gap-2">
          <span className="grid place-items-center size-6 rounded-md bg-brand text-white text-[12px] font-[family-name:var(--font-seal)]">印</span>
          Memini
        </span>
        <span>无需注册 · No sign-up</span>
      </div>

      <h1 className="text-[28px] font-bold leading-tight">{title[0]}</h1>
      <p className="text-[15px] text-muted mt-0.5">{title[1]}</p>
      <div className="mt-3 text-[15px] leading-relaxed">
        {snap.buyer && <div><span className="text-muted">来自 From：</span><b>{snap.buyer}</b></div>}
        {(snap.counterparty_zh || snap.counterparty) && <div><span className="text-muted">致 To：</span>{snap.counterparty_zh ?? snap.counterparty}</div>}
      </div>

      {banner && (
        <div className={`mt-4 rounded-2xl px-4 py-3 text-[16px] ${q.err ? "bg-bad-soft text-bad" : "bg-ok-soft text-ok"}`}>
          <div className="font-semibold">{banner[0]}</div><div className="text-[13px] opacity-80">{banner[1]}</div>
        </div>
      )}
      {expired && !q.err && (
        <div className="mt-4 rounded-2xl bg-line-2 px-4 py-3 text-[16px]">
          <div className="font-semibold">链接已过期</div><div className="text-[13px] text-muted">This link has expired. 请联系对方重新发送 · Please ask for a new one.</div>
        </div>
      )}
      {confirmed && (
        <div className="mt-4 rounded-2xl border-2 border-ok bg-ok-soft px-4 py-3.5">
          <div className="text-[20px] font-bold text-ok">✅ 已确认 · Confirmed</div>
          <div className="text-[14px] text-ink-2 mt-0.5">{fmt(confirmed.created_at)} · 谢谢！对方已收到通知。Thank you — they have been notified.</div>
        </div>
      )}

      {hasTerms && (
        <section className="mt-6">
          <h2 className="text-[17px] font-semibold mb-2">{confirmed ? "已确认的条款 · Confirmed terms" : `${noun[0]} · ${noun[1][0].toUpperCase()}${noun[1].slice(1)}`}</h2>
          <div className="rounded-2xl border border-line bg-card divide-y divide-line-2">
            {(snap.subject || snap.matter_title) && (
              <div className="px-4 py-3.5">
                <div className="text-[13px] text-muted">产品 · Item</div>
                <div className="text-[18px] font-semibold">{snap.subject ?? snap.matter_title}</div>
              </div>
            )}
            {snap.terms.map((t) => (
              <div key={t.key} className="px-4 py-3.5 flex items-baseline justify-between gap-4">
                <div className="shrink-0">
                  <div className="text-[16px] text-ink-2">{t.zh}</div>
                  <div className="text-[12px] text-faint">{t.en}</div>
                </div>
                <div className="text-right min-w-0">
                  <div className="text-[19px] font-semibold tabular break-words">{t.value_zh}</div>
                  {t.value_en !== t.value_zh && <div className="text-[13px] text-muted tabular break-words">{t.value_en}</div>}
                </div>
              </div>
            ))}
          </div>

          {!confirmed && !expired && (
            <div className="mt-4 space-y-3">
              <form method="post" action={`/api/c/${token}`} encType="multipart/form-data">
                <input type="hidden" name="action" value="confirm" />
                <button className="press w-full h-[60px] rounded-2xl bg-wechat text-white text-[20px] font-bold shadow-[0_6px_20px_-8px_rgb(7_193_96/0.6)]">
                  ✅ 确认无误 <span className="text-[15px] font-medium opacity-90">· Confirm</span>
                </button>
                <p className="text-[13px] text-muted text-center mt-1.5">点击即表示以上条款正确 · Tapping means the terms above are correct</p>
              </form>
              <details className="rounded-2xl border border-line bg-card" open={q.err === "empty"}>
                <summary className="list-none cursor-pointer px-4 h-14 flex items-center justify-center text-[17px] font-semibold">✏️ 有修改 <span className="text-[14px] font-normal text-muted ml-1.5">· Request a change</span></summary>
                <form method="post" action={`/api/c/${token}`} encType="multipart/form-data" className="px-4 pb-4">
                  <input type="hidden" name="action" value="changes" />
                  <textarea name="note" rows={4} maxLength={1000} required placeholder="请写下需要修改的地方，例如：单价改为4.50美元，交期20天"
                    className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-[16px] leading-relaxed" />
                  <button className="press mt-2.5 w-full h-12 rounded-xl bg-ink text-white text-[17px] font-semibold">提交修改 · Send</button>
                </form>
              </details>
            </div>
          )}
          {changes.length > 0 && (
            <div className="mt-4 rounded-2xl bg-warn-soft px-4 py-3 text-[15px]">
              <div className="font-semibold text-warn">已提交的修改意见 · Change requests sent</div>
              {changes.map((c) => <div key={c.id} className="mt-1.5 text-ink-2">“{c.note}” <span className="text-[12px] text-muted">{fmt(c.created_at)}</span></div>)}
            </div>
          )}
        </section>
      )}

      {slots.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[17px] font-semibold">请上传以下文件</h2>
          <p className="text-[14px] text-muted mb-2">Please upload — 拍照或选择 PDF 都可以 · a photo or a PDF is fine</p>
          <div className="rounded-2xl border border-line bg-card divide-y divide-line-2">
            {slots.map((s) => expired
              ? <div key={s.doc} className="px-4 py-3.5 text-[17px]">{s.zh} <span className="text-[13px] text-muted">{s.en}</span></div>
              : <SupplierUpload key={s.doc} token={token} docZh={s.zh} docEn={s.en} done={s.done} />)}
            {!expired && <SupplierUpload token={token} docZh="其他文件" docEn="Other document" done={false} />}
          </div>
          {uploads.length > 0 && (
            <div className="mt-3 text-[14px] text-muted">
              已收到 · Received: {uploads.map((u) => u.note).join("、")}
            </div>
          )}
        </section>
      )}

      <footer className="mt-10 text-[12.5px] text-faint leading-relaxed">
        本页面由 {snap.buyer || "对方"} 通过 Memini 发送，您的确认和文件只会发给对方。<br />
        Sent by {snap.buyer || "your counterparty"} via Memini. Your answer and files go only to them.
        {confirmed && <><br />确认编号 Ref: {link.terms_hash.slice(0, 12)}</>}
      </footer>
    </div>
  );
}
