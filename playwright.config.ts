import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// The dev server needs NEXT_PUBLIC_CONVEX_URL, which `npx convex dev` writes here.
loadEnv({ path: ".env.local", quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3100);
// localhost, not 127.0.0.1: the Next dev server rejects the HMR websocket
// handshake on the bare IP, and with that socket dead the client bundle never
// executes, so the page renders but never hydrates and every click is inert.
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * End-to-end tests drive a real browser against a real Next.js server and a
 * real Convex deployment. Nothing is mocked: a test that says a score reached
 * the public scoreboard means the score genuinely made the round trip.
 *
 * Every spec creates its own tournament, so specs never collide and can run in
 * parallel. Only Chromium runs by default — the app is plain React with no
 * engine-specific code, and a second engine triples the wall clock for very
 * little. CI adds WebKit via `E2E_ALL_BROWSERS=1` to catch Safari-only layout
 * faults, since a large share of the players opening a scoreboard are on iOS.
 */
const allBrowsers = process.env.E2E_ALL_BROWSERS === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  // A cold Turbopack compile of a route can take a while on the first hit.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The organiser console is used on a phone at the desk far more often than
    // on a laptop, so one project runs the whole suite at phone width.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    ...(allBrowsers ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }] : []),
  ],

  webServer: {
    command: `node node_modules/next/dist/bin/next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
