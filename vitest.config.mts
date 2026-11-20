import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // "server-only" throws outside React Server Components; tests run plain Node
    alias: { "server-only": fileURLToPath(new URL("./tests/empty.ts", import.meta.url)) },
  },
  // tests/live calls real AI models (costs money): run them with `npm run test:live`
  test: { environment: "node", passWithNoTests: true, exclude: [...configDefaults.exclude, "tests/live/**"] },
});
