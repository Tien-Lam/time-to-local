import type { Page } from "@playwright/test";
import { test, expect, disconnect } from "./fixtures";
import { enterZone } from "./choices";

async function ready(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("data-app-ready", "true");
  await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
}

async function fill(page: Page, text: string) {
  await ready(page);
  const input = page.getByLabel("Message with a date or time");
  await input.fill(text);
  await expect(input).toHaveValue(text);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "chronoshift.preferences.v1",
      JSON.stringify({
        target: "UTC",
        source: "UTC",
        hourCycle: "24",
      }),
    );
  });
});

test("heading siblings, explicit override, target edit and fresh record keep their own dates", async ({
  page,
}) => {
  await page.goto("/");
  const text =
    "May 14, 2026\n- 08:00 UTC first\n- 09:00 UTC on May 18, 2026 override\n- 10:00 UTC sibling";
  await fill(page, text);
  await expect(page.locator(".hero-time")).toHaveText([
    "08:00",
    "09:00",
    "10:00",
  ]);
  await expect(page.locator(".result-date")).toHaveText([
    "Thu, 14 May 2026",
    "Mon, 18 May 2026",
    "Thu, 14 May 2026",
  ]);
  await expect(page.locator(".range-label")).toHaveCount(0);
  await expect(page.locator(".source-label")).toHaveText(["UTC", "UTC", "UTC"]);
  await expect(
    page.locator(".result").nth(0).locator(".assumption"),
  ).toHaveText("Date from message context: 2026-05-14");
  await expect(
    page.locator(".result").nth(2).locator(".assumption"),
  ).toHaveText("Date from message context: 2026-05-14");
  await enterZone(page, "Asia/Tokyo");
  await expect(page.getByLabel("Message with a date or time")).toHaveValue(
    text,
  );
  await expect(page.locator(".hero-time")).toHaveText([
    "17:00",
    "18:00",
    "19:00",
  ]);
  await expect(page.locator(".result-date")).toHaveText([
    "Thu, 14 May 2026",
    "Mon, 18 May 2026",
    "Thu, 14 May 2026",
  ]);
  await expect(page.locator(".source-label")).toHaveText(["UTC", "UTC", "UTC"]);
  await fill(page, "dAtE: 16 May 2026\nTitle: Planning\ntImE: 09:50 UTC");
  await expect(page.locator(".hero-time")).toHaveText("18:50");
  await expect(page.locator(".result-date")).toHaveText("Sat, 16 May 2026");
  await expect(page.locator(".assumption")).toHaveText(
    "Date from message context: 2026-05-16",
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByLabel("Message with a date or time")).toHaveValue("");
  await expect(page.locator(".hero-time")).toHaveCount(0);
  await fill(page, "May 20, 2026\n- 12:25 UTC replacement");
  await expect(page.locator(".hero-time")).toHaveText("21:25");
  await expect(page.locator(".result-date")).toHaveText("Wed, 20 May 2026");
});

test("a late duplicate invalidates the record instead of preserving a partial date owner", async ({
  page,
}) => {
  await page.goto("/");
  await fill(page, "08:40 UTC");
  await expect(page.locator(".hero-time")).toHaveText("08:40");
  const referenceDate = await page.locator(".result-date").innerText();
  await fill(page, "Date: May 14, 2026\nTime: 08:40 UTC\nDate: May 16, 2026");
  await expect(page.locator(".hero-time")).toHaveText("08:40");
  await expect(page.locator(".result-date")).toHaveText(referenceDate);
  await expect(page.locator(".assumption")).toHaveCount(2);
  await expect(page.locator(".assumption").nth(0)).toHaveText(/^Date assumed:/);
  await expect(page.locator(".assumption").nth(1)).toHaveText(
    /^Reference date used:/,
  );
  await expect(page.locator(".range-label")).toHaveCount(0);
});

test("a qualified Time range and linked list labels preserve the stated date", async ({
  page,
}) => {
  await page.goto("/");
  const record = "Date: March 8, 2026\nTime: 09:00 in London to 10:30 in Paris";
  await fill(page, record);
  await expect(page.locator(".hero-time")).toHaveText(["09:00", "09:30"]);
  await expect(page.locator(".result-date")).toHaveText([
    "Sun, 8 Mar 2026",
    "Sun, 8 Mar 2026",
  ]);
  await expect(page.locator(".source-label")).toHaveText(["London", "Paris"]);
  await expect(page.locator(".range-label")).toHaveCount(2);
  await expect(page.locator(".assumption")).toHaveText([
    "Date from message context: 2026-03-08",
    "Date from message context: 2026-03-08",
  ]);
  const linked =
    "March 8, 2026\n- 09:00 UTC [Agenda 🧭](https://example.invalid/March-9-2026)\n- 10:00 UTC https://example.invalid/15:00";
  await fill(page, linked);
  await expect(page.locator(".hero-time")).toHaveText(["09:00", "10:00"]);
  await expect(page.locator(".result-date")).toHaveText([
    "Sun, 8 Mar 2026",
    "Sun, 8 Mar 2026",
  ]);
  await expect(page.locator(".range-label")).toHaveCount(0);
  await expect(page.locator(".assumption")).toHaveText([
    "Date from message context: 2026-03-08",
    "Date from message context: 2026-03-08",
  ]);
});

test("a cached offline reopen accepts new heading and record input with exact dates", async ({
  page,
  context,
  origin,
}) => {
  await page.goto("/");
  await fill(page, "May 14, 2026\n- 09:10 UTC first\n- 11:40 UTC second");
  await expect(page.locator(".hero-time")).toHaveText(["09:10", "11:40"]);
  await expect(page.locator(".range-label")).toHaveCount(0);
  await page.close();
  await disconnect(context, origin);
  const reopened = await context.newPage();
  await reopened.goto("/");
  await ready(reopened);
  await expect(reopened.getByLabel("Message with a date or time")).toHaveValue(
    "",
  );
  await fill(reopened, "May 14, 2026\n- 09:10 UTC first\n- 11:40 UTC second");
  await expect(reopened.locator(".hero-time")).toHaveText(["09:10", "11:40"]);
  await expect(reopened.locator(".result-date")).toHaveText([
    "Thu, 14 May 2026",
    "Thu, 14 May 2026",
  ]);
  await expect(reopened.locator(".range-label")).toHaveCount(0);
  await fill(reopened, "Date: May 16, 2026\nTime: 09:50 UTC");
  await expect(reopened.locator(".hero-time")).toHaveText("09:50");
  await expect(reopened.locator(".result-date")).toHaveText("Sat, 16 May 2026");
  await expect(reopened.locator(".assumption")).toHaveText(
    "Date from message context: 2026-05-16",
  );
});

test("DEVELOPMENT harmless month titles and vague activities preserve source and copied context", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          (window as any).__repairCopied = value;
        },
      },
    });
  });
  await page.goto("/");
  await fill(
    page,
    "August 19, 2026\n- 08:15 UTC: Morning briefing\n- 09:25 UTC evening lab",
  );
  await expect(page.locator(".hero-time")).toHaveText(["08:15", "09:25"]);
  await expect(page.locator(".result-date")).toHaveText([
    "Wed, 19 Aug 2026",
    "Wed, 19 Aug 2026",
  ]);
  await expect(page.locator(".range-label")).toHaveCount(0);
  await page.locator(".result .copy-button").first().click();
  const copied = await page.evaluate(
    () => (window as any).__repairCopied as string,
  );
  expect(copied).toContain("08:15 UTC");
  expect(copied).toContain("Date from message context: 2026-08-19");
  expect(copied).not.toContain("Morning briefing");
  await fill(
    page,
    "Date: August 19, 2026\nTitle: September planning\nTime: noon UTC",
  );
  await expect(page.locator(".hero-time")).toHaveText("12:00");
  await expect(page.locator(".result-date")).toHaveText("Wed, 19 Aug 2026");
  await expect(page.locator(".assumption")).toHaveText(
    "Date from message context: 2026-08-19",
  );
  await fill(page, "> August 19, 2026 at midnight UTC");
  await expect(page.locator(".hero-time")).toHaveText("00:00");
  await expect(page.locator(".result-date")).toHaveText("Wed, 19 Aug 2026");
  await expect(page.locator(".assumption")).toHaveCount(0);
});

test("DEVELOPMENT repeated ranges preserve two endpoints and an independent shared point after offline reopen", async ({
  page,
  context,
  origin,
}) => {
  await page.goto("/");
  const text =
    "August 19, 2026\n- 08:15-09:25 UTC first\n- 08:15 UTC independent\n- 08:15-09:25 UTC repeat";
  await fill(page, text);
  await expect(page.locator(".hero-time")).toHaveText([
    "08:15",
    "09:25",
    "08:15",
  ]);
  await expect(page.locator(".range-label")).toHaveText(["From", "To"]);
  await expect(
    page.locator(".assumption").filter({ hasText: "Mentioned 2 times" }),
  ).toHaveCount(2);
  await page.close();
  await disconnect(context, origin);
  const reopened = await context.newPage();
  await reopened.goto("/");
  await ready(reopened);
  await fill(reopened, text);
  await expect(reopened.locator(".hero-time")).toHaveText([
    "08:15",
    "09:25",
    "08:15",
  ]);
  await expect(reopened.locator(".result-date")).toHaveText([
    "Wed, 19 Aug 2026",
    "Wed, 19 Aug 2026",
    "Wed, 19 Aug 2026",
  ]);
  await expect(reopened.locator(".range-label")).toHaveText(["From", "To"]);
  await expect(
    reopened.locator(".assumption").filter({ hasText: "Mentioned 2 times" }),
  ).toHaveCount(2);
});
