"use client";
// One-tap copy that also works where navigator.clipboard doesn't: plain-HTTP pages and WeChat's in-app browser
// (the Clipboard API needs a secure context), via the old execCommand("copy") on a hidden textarea.
import { useState } from "react";

export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px"; // 16px: iOS doesn't zoom
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function CopyButton({ text, label = "Copy", done = "Copied", className = "", onCopied }: { text: string; label?: string; done?: string; className?: string; onCopied?: () => void }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "ok" : "fail");
        if (ok) onCopied?.();
        setTimeout(() => setState("idle"), 1800);
      }}
      className={className || "press inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 h-8 text-[13px] font-medium hover:bg-hover"}
    >
      {state === "ok" ? `✓ ${done}` : state === "fail" ? "Long-press the text to copy" : label}
    </button>
  );
}
