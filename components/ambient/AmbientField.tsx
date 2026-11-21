"use client";
// The signature living element: a quiet canvas of drifting motes in warm light.
// Pure 2D canvas, ~35–55 particles, retina-crisp, paused when the tab is hidden or the stage is off-screen,
// and a single still frame under prefers-reduced-motion.
//
// It listens for three window events so the page can answer the user:
//   memini:focus  {on}   composer focused  → the light brightens a little
//   memini:drag   {on}   a file is over the window → motes gather toward the centre
//   memini:pulse         something arrived (WeChat, RFQ reply) → a calm ripple moves through
import { useEffect, useRef } from "react";

type Palette = "day" | "night";
type RGB = [number, number, number];
type Mote = {
  x: number; y: number; vx: number; vy: number; r: number; depth: number; rgb: RGB; a: number;
  phase: number; wob: number; orb: boolean; ox: number; oy: number;
};
type Ripple = { x: number; y: number; t: number };

// translucent ink, terracotta / amber, pale mineral sage and warm pearl (day);  starlight and apricot dust (night)
const DAY: { rgb: RGB; a: [number, number]; weight: number }[] = [
  { rgb: [22, 21, 19], a: [0.08, 0.18], weight: 0.38 },
  { rgb: [210, 63, 46], a: [0.18, 0.3], weight: 0.14 },
  { rgb: [63, 111, 209], a: [0.2, 0.32], weight: 0.18 },
  { rgb: [132, 164, 148], a: [0.15, 0.25], weight: 0.18 },
  { rgb: [205, 195, 176], a: [0.18, 0.25], weight: 0.12 },
];
const NIGHT: { rgb: RGB; a: [number, number]; weight: number }[] = [
  { rgb: [255, 247, 232], a: [0.25, 0.6], weight: 0.55 },
  { rgb: [240, 170, 110], a: [0.2, 0.45], weight: 0.25 },
  { rgb: [150, 170, 255], a: [0.18, 0.4], weight: 0.2 },
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function pick(palette: Palette): { rgb: RGB; a: number } {
  const set = palette === "night" ? NIGHT : DAY;
  let n = Math.random();
  for (const c of set) { if ((n -= c.weight) <= 0) return { rgb: c.rgb, a: rand(c.a[0], c.a[1]) }; }
  return { rgb: set[0].rgb, a: set[0].a[0] };
}

export function AmbientField({ palette = "day", density = 1, className = "" }: { palette?: Palette; density?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const night = palette === "night";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, dpr = 1;
    const motes: Mote[] = [];
    const ripples: Ripple[] = [];
    let raf = 0, last = 0, running = false, visible = true;
    let energy = 0, energyTarget = 0, gather = 0, gatherTarget = 0;
    const pointer = { x: 0, y: 0, active: false, px: 0, py: 0 }; // px/py: smoothed offset from centre, -1…1
    let rect = canvas.getBoundingClientRect();

    const make = (): Mote => {
      const c = pick(palette);
      const orb = night ? false : Math.random() < 0.34;
      const r = night ? rand(0.5, 1.6) : orb ? rand(3, 6) : rand(1.5, 3);
      const speed = night ? rand(2, 7) : rand(5, 15);
      const ang = rand(0, Math.PI * 2);
      return { x: rand(0, w), y: rand(0, h), vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed * 0.6 - (night ? 0 : 1.5), r, depth: rand(0.35, 1), rgb: c.rgb, a: c.a, phase: rand(0, 6.28), wob: rand(0.15, 0.4), orb, ox: 0, oy: 0 };
    };

    const resize = () => {
      const box = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(box.width)); h = Math.max(1, Math.round(box.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rect = canvas.getBoundingClientRect();
      const target = Math.round(Math.min(55, Math.max(night ? 22 : 30, (w * h) / (night ? 5200 : 17000))) * density);
      if (motes.length > target) motes.length = target;
      while (motes.length < target) motes.push(make());
      for (const m of motes) { m.x = Math.min(m.x, w); m.y = Math.min(m.y, h); }
      if (!running) draw(0, 0);
    };

    const draw = (t: number, dt: number) => {
      ctx.clearRect(0, 0, w, h);
      energy += (energyTarget - energy) * Math.min(1, dt * 2.2);
      gather += (gatherTarget - gather) * Math.min(1, dt * 2);
      pointer.px += ((pointer.active ? (pointer.x / w - 0.5) * 2 : 0) - pointer.px) * Math.min(1, dt * 2.4);
      pointer.py += ((pointer.active ? (pointer.y / h - 0.5) * 2 : 0) - pointer.py) * Math.min(1, dt * 2.4);
      const R = 130;

      for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].t += dt; if (ripples[i].t > 2.2) ripples.splice(i, 1); }

      for (const m of motes) {
        // slow heading drift, so paths curve instead of running straight
        m.x += (m.vx + Math.sin(t * m.wob + m.phase) * 6) * dt * (1 + energy * 0.6);
        m.y += (m.vy + Math.cos(t * m.wob * 0.8 + m.phase) * 4) * dt * (1 + energy * 0.6);
        if (m.x < -20) m.x = w + 20; else if (m.x > w + 20) m.x = -20;
        if (m.y < -20) m.y = h + 20; else if (m.y > h + 20) m.y = -20;

        let tx = 0, ty = 0;
        if (pointer.active) { // magnetic parting: motes step aside around the cursor
          const dx = m.x - pointer.x, dy = m.y - pointer.y, d = Math.hypot(dx, dy);
          if (d < R && d > 0.01) { const f = (1 - d / R) ** 2 * 42 * m.depth; tx += (dx / d) * f; ty += (dy / d) * f; }
        }
        for (const rp of ripples) { // a ripple nudges what it passes
          const rad = rp.t * 340, dx = m.x - rp.x, dy = m.y - rp.y, d = Math.hypot(dx, dy);
          const band = Math.abs(d - rad);
          if (band < 46 && d > 0.01) { const f = (1 - band / 46) * 16 * (1 - rp.t / 2.2) * m.depth; tx += (dx / d) * f; ty += (dy / d) * f; }
        }
        if (gather > 0.01) { tx += (w / 2 - m.x) * 0.06 * gather; ty += (h * 0.55 - m.y) * 0.06 * gather; }
        m.ox += (tx - m.ox) * Math.min(1, dt * 4.5);
        m.oy += (ty - m.oy) * Math.min(1, dt * 4.5);

        const x = m.x + m.ox - pointer.px * 16 * m.depth;
        const y = m.y + m.oy - pointer.py * 11 * m.depth;
        const alpha = Math.min(1, m.a * (1 + energy * 0.45 + gather * 0.3) * (0.82 + Math.sin(t * 0.7 + m.phase) * 0.18));
        const [r, g, b] = m.rgb;
        if (m.orb) {
          const gr = ctx.createRadialGradient(x, y, 0, x, y, m.r * 1.9);
          gr.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
          gr.addColorStop(0.55, `rgba(${r},${g},${b},${alpha * 0.55})`);
          gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(x, y, m.r * 1.9, 0, 6.2832); ctx.fill();
        } else {
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.beginPath(); ctx.arc(x, y, m.r, 0, 6.2832); ctx.fill();
        }
      }

      for (const rp of ripples) { // the ripple itself: one soft warm ring
        const a = (1 - rp.t / 2.2) * (night ? 0.22 : 0.2);
        ctx.strokeStyle = night ? `rgba(255,214,170,${a})` : `rgba(63,111,209,${a})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.t * 340, 0, 6.2832); ctx.stroke();
      }
    };

    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      draw(now / 1000, dt);
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (running || reduced || !visible || document.hidden) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX - rect.left; pointer.y = e.clientY - rect.top;
      pointer.active = pointer.x > -80 && pointer.x < w + 80 && pointer.y > -80 && pointer.y < h + 80;
    };
    const onLeave = () => { pointer.active = false; };
    const onFocus = (e: Event) => { energyTarget = (e as CustomEvent<{ on: boolean }>).detail?.on ? 1 : 0; };
    const onDrag = (e: Event) => { const on = !!(e as CustomEvent<{ on: boolean }>).detail?.on; gatherTarget = on ? 1 : 0; energyTarget = on ? 1.4 : 0; };
    const onPulse = () => { ripples.push({ x: w / 2, y: h * 0.62, t: 0 }); };
    const onVis = () => (document.hidden ? stop() : start());
    const onScroll = () => { rect = canvas.getBoundingClientRect(); };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement ?? canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); }, { threshold: 0 });
    io.observe(canvas);
    resize();
    if (!reduced) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("memini:focus", onFocus);
      window.addEventListener("memini:drag", onDrag);
      window.addEventListener("memini:pulse", onPulse);
    }
    document.addEventListener("visibilitychange", onVis);
    start();

    return () => {
      stop(); ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("memini:focus", onFocus);
      window.removeEventListener("memini:drag", onDrag);
      window.removeEventListener("memini:pulse", onPulse);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [palette, density]);

  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 ${className}`} />;
}
