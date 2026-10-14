import { chromium, expect, test } from "@playwright/test";
import { verifyProductionFixtures } from "./engine-fixtures";
import { enterZone } from "./choices";

test("the compatibility Temporal implementation preserves exact conversions after offline reopen", async ({
  browserName,
  isMobile,
  baseURL,
}) => {
  test.skip(
    browserName !== "chromium" || isMobile,
    "This check uses Chromium's engine-wide Temporal feature flag.",
  );
  // Two complete fixture passes, their exact assertions and offline UI recovery.
  test.setTimeout(90_000);
  const browser = await chromium.launch({
    args: ["--js-flags=--no-harmony-temporal"],
  });
  try {
    const context = await browser.newContext({
      locale: "en-AU",
      timezoneId: "Australia/Sydney",
    });
    context.setDefaultTimeout(10_000);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(baseURL!);
    expect(
      await page.evaluate(
        () =>
          typeof (globalThis as typeof globalThis & { Temporal?: unknown })
            .Temporal,
      ),
    ).toBe("undefined");
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
    await verifyProductionFixtures(page);
    expect(pageErrors).toEqual([]);
    await page.close();
    await context.setOffline(true);
    const reopened = await context.newPage();
    reopened.on("pageerror", (error) => pageErrors.push(error.message));
    await reopened.goto(baseURL!);
    await expect(
      reopened.locator('main[data-offline-ready="true"]'),
    ).toBeVisible();
    await verifyProductionFixtures(reopened);
    await enterZone(reopened, "+05:45");
    await reopened
      .getByLabel("Message with a date or time")
      .fill("April 9, 2026 3pm UTC");
    await expect(reopened.locator(".hero-time")).toHaveText(/8:45 pm/i);
    await expect(reopened.locator(".result-date")).toContainText("9 Apr 2026");
    await expect(reopened.locator(".result-zone")).toContainText("UTC+05:45");
    expect(pageErrors).toEqual([]);
    await context.close();
  } finally {
    await browser.close();
  }
});
