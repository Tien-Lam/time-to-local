import { defineConfig, devices } from "@playwright/test";
const port = process.env.PLAYWRIGHT_PORT || "4174";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/subpath.spec.ts",
  timeout: 30000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
  },
  webServer: {
    command: `PORT=${port} BASE_PATH=/ChronoShift/ bun scripts/serve-web.ts`,
    url: `http://127.0.0.1:${port}/ChronoShift/`,
    reuseExistingServer: false,
  },
});
