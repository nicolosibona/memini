import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChopCheck",
  description: "Bilingual deal copilot for sourcing in China: structured memory, document audit, WeChat bot.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col">
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
