import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// The deployment URL is written to .env.local by `npx convex dev`.
loadEnv({ path: ".env.local", quiet: true });

/**
 * Integration tests run against a real Convex deployment, one file at a time so
 * two runs never fight over the same tournament.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
