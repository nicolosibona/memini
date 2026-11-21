// The light the motes float in: sunlit pearl, a breath of apricot, a faint mineral mist, and two translucent silk
// ribbons. All CSS/SVG, GPU-composited drift; the canvas on top supplies the particles.
import type { ReactNode } from "react";
import { AmbientField } from "./AmbientField";

export function Mist({ tone = "day" }: { tone?: "day" | "night" }) {
  if (tone === "night") {
    return (
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="silk-a absolute -top-[35%] -left-[10%] w-[75%] h-[120%] rounded-full" style={{ background: "radial-gradient(closest-side, rgb(98 112 220 / 0.38), rgb(98 112 220 / 0))" }} />
        <div className="silk-b absolute -bottom-[45%] -right-[15%] w-[80%] h-[120%] rounded-full" style={{ background: "radial-gradient(closest-side, rgb(236 140 96 / 0.26), rgb(236 140 96 / 0))" }} />
        <div className="silk-a absolute top-[10%] right-[10%] w-[40%] h-[70%] rounded-full" style={{ background: "radial-gradient(closest-side, rgb(120 190 190 / 0.14), rgb(120 190 190 / 0))" }} />
      </div>
    );
  }
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="silk-a absolute -top-[45%] left-[8%] w-[62%] h-[150%] rounded-full" style={{ background: "radial-gradient(closest-side, rgb(186 205 242 / 0.95), rgb(186 205 242 / 0))" }} />
      <div className="silk-b absolute -top-[25%] right-[2%] w-[48%] h-[125%] rounded-full" style={{ background: "radial-gradient(closest-side, rgb(120 156 228 / 0.24), rgb(120 156 228 / 0))" }} />
      <div className="silk-a absolute top-[20%] -left-[8%] w-[40%] h-[100%] rounded-full" style={{ background: "radial-gradient(closest-side, rgb(160 196 186 / 0.24), rgb(160 196 186 / 0))" }} />
    </div>
  );
}

/** Two translucent silk ribbons: thin crescents that drift very slowly. */
export function Silk({ tone = "day", className = "" }: { tone?: "day" | "night"; className?: string }) {
  const a = tone === "night" ? ["#f0aa6e", "#7a8cff"] : ["#3f6fd1", "#6a8fe0"];
  const id = `silk-${tone}`;
  return (
    <svg aria-hidden viewBox="0 0 1200 420" preserveAspectRatio="none" className={`pointer-events-none absolute inset-0 size-full ${className}`}>
      <defs>
        <linearGradient id={`${id}-1`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={a[0]} stopOpacity="0" /><stop offset="0.45" stopColor={a[0]} stopOpacity={tone === "night" ? 0.3 : 0.16} /><stop offset="1" stopColor={a[0]} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-2`} x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor={a[1]} stopOpacity="0" /><stop offset="0.55" stopColor={a[1]} stopOpacity={tone === "night" ? 0.26 : 0.1} /><stop offset="1" stopColor={a[1]} stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="silk-a"><path d="M-40 300 C 240 130 520 360 820 190 C 980 100 1110 150 1260 90 C 1100 230 960 250 800 300 C 520 390 260 210 -40 300 Z" fill={`url(#${id}-1)`} /></g>
      <g className="silk-b"><path d="M-40 360 C 260 250 480 400 760 300 C 960 230 1100 300 1260 220 C 1120 360 940 380 740 390 C 480 410 280 330 -40 360 Z" fill={`url(#${id}-2)`} /></g>
    </svg>
  );
}

/** The upper workspace stage: light + ribbons + motes behind whatever header you put in it. It fades into the page below. */
export function Stage({ children, className = "", height = "" }: { children: ReactNode; className?: string; height?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div aria-hidden className={`absolute inset-x-0 top-0 ${height || "h-full"} pointer-events-none overflow-hidden [mask-image:linear-gradient(to_bottom,black_62%,transparent)]`}>
        <Mist />
        <Silk />
        <AmbientField />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
