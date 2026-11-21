import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "imapflow"],
  // lets CI / a second build run without touching the dev server's .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
