import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/e2e",
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  // Every spec runs on Chromium. WebKit and Firefox run smoke.spec.ts only (spec 2026-11-23 section 11, item 13).
  // WebKit caps a screenshot at 32,767 device px; the 360 px landing is over half that until the redesign shortens it.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"], deviceScaleFactor: 1 }, testMatch: /smoke\.spec\.ts$/ },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: /smoke\.spec\.ts$/ },
  ],
  webServer: {
    // -n: never touch the clipboard; -L: quiet. Serves the static export from `npm run build`.
    command: `npx serve -L -n --no-port-switching -l ${PORT} out`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
