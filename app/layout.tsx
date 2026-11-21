import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts are self-hosted (app/fonts): no request to Google, so they load in mainland China too.
const geist = localFont({ src: "./fonts/Geist-Variable.woff2", variable: "--font-geist", weight: "100 900", display: "swap" });
const geistMono = localFont({ src: "./fonts/GeistMono-Variable.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });
const instrument = localFont({
  src: [{ path: "./fonts/instrument-serif-latin-400-normal.woff2", style: "normal" }, { path: "./fonts/instrument-serif-latin-400-italic.woff2", style: "italic" }],
  variable: "--font-instrument", weight: "400", display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Memini", template: "%s · Memini" },
  description: "Spec-exact translation and negotiation for electronic components sourced from China, with bilingual verification sheets sent to suppliers on WeChat.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f6f2" };
export const dynamic = "force-dynamic";

// The root only sets fonts and the ground. The workspace chrome lives in (app)/layout; the pages opened by
// counterparties inside WeChat ((public)/…) get none of it.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}>
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
