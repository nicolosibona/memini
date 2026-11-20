// `npm run test:live` — real AI calls with the keys in .env.local (blueprint §17.11, §19.7 bake-off).
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { tsconfigPaths: true, alias: { "server-only": fileURLToPath(new URL("./tests/empty.ts", import.meta.url)) } },
  test: { environment: "node", include: ["tests/live/**/*.live.test.ts"], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
});
