import { test, expect, disconnect } from "./fixtures";
import { choose, enterZone } from "./choices";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "chronoshift.preferences.v1",
      JSON.stringify({ target: "UTC", hourCycle: "24" }),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).__uxCopied = value;
        },
      },
    });
  });
});

test("ambiguity precedes every result and copy action at desktop and narrow widths", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm CST");
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".live-indicator")).toHaveText(
      "1 time · choose an interpretation",
    );
    await expect(page.locator(".hero-time")).toHaveText(["21:00", "07:00"]);
    const bounds = await page.locator(".result-group").evaluate((group) => {
      const warning = group
        .querySelector(".interpretation-warning")!
        .getBoundingClientRect();
      return {
        bottom: warning.bottom,
        targets: [...group.querySelectorAll(".hero-time,button")].map(
          (node) => node.getBoundingClientRect().top,
        ),
      };
    });
    for (const top of bounds.targets)
      expect(top).toBeGreaterThanOrEqual(bounds.bottom);
    const first = page.locator(".result").first().getByRole("button");
    await expect(first).toHaveAccessibleName(/US Central Standard.*UTC-06:00/);
    await first.click();
    expect(await page.evaluate(() => (window as any).__uxCopied)).toContain(
      "US Central Standard",
    );
  }
});

test("numeric interpretation has a working contextual correction without changing the draft", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("Message with a date or time");
  await input.fill("04/09/2026 3pm UTC");
  await expect(page.locator(".numeric-interpretation")).toContainText(
    "Read as 9 April 2026 · Month/day",
  );
  await page
    .getByRole("button", { name: "Change date order", exact: true })
    .click();
  await expect(page.locator("#date-order")).toBeFocused();
  await choose(page, "Date order in messages", "dmy");
  await expect(page.locator(".numeric-interpretation")).toContainText(
    "Read as 4 September 2026 · Day/month",
  );
  await expect(input).toHaveValue("04/09/2026 3pm UTC");
  await expect(page.locator(".result-date")).toContainText(/4 Sep(?:t)? 2026/);
});

test("DST error and source-picker alternatives guide deliberate recovery", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("Message with a date or time");
  await input.fill("March 8, 2026 2:30am in New York");
  await expect(page.locator(".live-indicator")).toHaveText("Check time");
  await expect(page.getByRole("alert")).toContainText(
    "Edit the time or timezone in your message.",
  );
  await page.getByRole("button", { name: /Message interpretation/ }).click();
  await enterZone(page, "Asia/Tokyo", "Source timezone");
  await expect(page.getByRole("alert")).toContainText("New York");
  await input.fill("March 8, 2026 3:30am in New York");
  await expect(page.locator(".hero-time")).toHaveText("07:30");
  await input.fill("April 9, 2026 3pm");
  const source = page.getByLabel("Source timezone", { exact: true });
  await source.fill("CST");
  await expect(page.locator(".choice-guidance")).toContainText(
    "CST has multiple meanings",
  );
  await expect(source).toHaveAttribute("aria-expanded", "true");
  await expect(source).toHaveAttribute("aria-controls", /.+/);
  const list = page.locator(
    `[id="${await source.getAttribute("aria-controls")}"]`,
  );
  await expect(list.getByRole("option")).toHaveCount(2);
  await list.getByRole("option", { name: "UTC-06:00", exact: true }).click();
  await expect(page.locator(".hero-time")).toHaveText("21:00");
});

test("grouped ranges copy dates and timezone with offline conversion and resize preservation", async ({
  page,
  context,
  origin,
}) => {
  await page.goto("/");
  await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
  await disconnect(context, origin);
  const input = page.getByLabel("Message with a date or time");
  await input.fill("April 9, 2026 11pm-1am UTC");
  await expect(page.locator(".live-indicator")).toHaveText("1 range converted");
  await expect(page.locator(".result-group")).toHaveCount(1);
  await page.getByRole("button", { name: /^Copy range / }).click();
  expect(await page.evaluate(() => (window as any).__uxCopied)).toContain(
    "23:00 · Thu, 9 Apr 2026 · UTC → 01:00 · Fri, 10 Apr 2026 · UTC",
  );
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(input).toHaveValue("April 9, 2026 11pm-1am UTC");
  await expect(page.locator(".hero-time")).toHaveText(["23:00", "01:00"]);
  await input.fill("April 9, 2026 9am-11am CST");
  await expect(page.locator(".live-indicator")).toHaveText(
    "1 range · choose an interpretation",
  );
  await expect(page.getByRole("button", { name: /^Copy range / })).toHaveCount(
    0,
  );
});

test("first-use guidance and contextual reference date coexist with separate preferences", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await expect(
    page.getByText("Results update as you type.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try example", exact: true }).click();
  const input = page.getByLabel("Message with a date or time");
  await expect(input).toHaveValue("April 9, 2026 3pm in Tokyo");
  await expect(page.locator(".hero-time")).toHaveText("06:00");
  await expect(
    page.getByRole("button", { name: "Next example", exact: true }),
  ).toBeVisible();
  await input.fill("Tomorrow at 3pm PT");
  await expect(page.locator(".reference-summary")).toContainText(
    "in Los Angeles",
  );
  await page
    .getByRole("button", { name: "Change reference date", exact: true })
    .click();
  await expect(
    page.locator('#reference-date [role="spinbutton"]').first(),
  ).toBeFocused();
  await expect(page.locator("#time-format")).toBeHidden();
  await choose(page, "Time format", "12");
  await expect(page.locator(".hero-time")).toHaveText(/pm/i);
  await expect(input).toHaveValue("Tomorrow at 3pm PT");
});

test("a delayed first reference editor respects newer message focus and typing", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    serviceWorkers: "block",
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
  });
  let release!: () => void;
  const stalled = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const html = await (await page.request.get(baseURL!)).text();
    const eager = [
      ...html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g),
    ].map((match) => new URL(match[1], baseURL).href);
    let pending = false;
    await page.route(
      /\/assets\/DateChoice-[^/]+\.js(?:\?.*)?$/,
      async (route) => {
        if (!eager.includes(route.request().url())) {
          pending = true;
          await stalled;
        }
        await route.continue();
      },
    );
    await page.goto(baseURL!);
    const input = page.getByLabel("Message with a date or time");
    await input.fill("Tomorrow at 3pm PT");
    await page
      .getByRole("button", { name: "Change reference date", exact: true })
      .click();
    await expect.poll(() => pending).toBe(true);
    await input.click();
    await input.press("End");
    await input.pressSequentially(" please");
    release();
    await expect(
      page.locator('#reference-date [role="spinbutton"]').first(),
    ).toBeVisible();
    await expect(input).toBeFocused();
    await input.pressSequentially("!");
    await expect(input).toHaveValue("Tomorrow at 3pm PT please!");
    await expect(page.locator(".result")).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    release();
    await context.close();
  }
});
