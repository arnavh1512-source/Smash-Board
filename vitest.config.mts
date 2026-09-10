import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Integration tests need the deployment URL that `convex dev` wrote here.
loadEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests need a live Convex deployment, so they are opt-in via
    // `npm run test:integration` rather than part of the default run.
    exclude: ["tests/integration/**"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      // usePin is a React hook over sessionStorage and site.ts is static config;
      // neither carries logic worth a unit test.
      exclude: ["src/lib/usePin.ts", "src/lib/site.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
