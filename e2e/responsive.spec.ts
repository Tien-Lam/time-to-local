import { test, expect } from "./fixtures";
import { choose, enterZone } from "./choices";

test("a phone exposes the result shortcut while optional defaults stay collapsed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "chronoshift.preferences.v1",
      JSON.stringify({ target: "UTC" }),
    );
  });
  await page.goto("/");
  const input = page.getByLabel("Message with a date or time");
  const shortcut = page.getByRole("button", { name: "View result" });
  const options = page.getByRole("button", { name: /More options/ });
  await expect(shortcut).toBeHidden();
  await expect(options).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".message-defaults")).toHaveCount(0);
  const message = "April 9, 2026 3:15:30pm in Tokyo";
  await input.fill(message);
  await expect(page.locator(".hero-time")).toHaveText(/6:15:30 am/i);
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  const bounds = await shortcut.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await shortcut.click();
  await expect(page.locator("#result-title")).toBeFocused();
  await expect(page.locator(".hero-time")).toBeInViewport();
  await expect(input).toHaveValue(message);
  await expect(options).toHaveAttribute("aria-expanded", "false");
  // A failed interpretation is still discoverable through the same shortcut.
  await input.fill("no time in this message");
  await expect(page.getByRole("alert")).toContainText("No time found");
  await shortcut.focus();
  await shortcut.press("Enter");
  await expect(page.locator("#result-title")).toBeFocused();
  await expect(page.getByRole("alert")).toBeInViewport();
  await input.fill("");
  await expect(shortcut).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
  await input.fill(message);
  await expect(page.locator(".hero-time")).toHaveText(/6:15:30 am/i);
  await expect(shortcut).toBeHidden();
});

test("reflows across cover screens, phones, tablets and desktops without losing work", async ({
  page,
}) => {
  await page.goto("/");
  await enterZone(page, "Pacific/Chatham");
  const message = "April 9, 2026 3:15:30pm in Tokyo";
  await page.getByLabel("Message with a date or time").fill(message);
  await expect(page.locator(".hero-time")).toBeVisible();
  const result = await page.locator(".hero-time").innerText();
  await page.getByRole("button", { name: /More options/ }).click();
  for (const [width, height] of [
    [280, 653],
    [320, 568],
    [390, 844],
    [740, 360],
    [673, 841],
    [820, 1180],
    [884, 1104],
    [1280, 720],
    [1920, 1080],
    [640, 360],
  ]) {
    await test.step(`${width} × ${height}`, async () => {
      await page.setViewportSize({ width, height });
      await expect(page.getByLabel("Message with a date or time")).toHaveValue(
        message,
      );
      await expect(page.locator(".hero-time")).toHaveText(result);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      const input = await page.locator(".input-panel").boundingBox();
      const output = await page.locator(".result-panel").boundingBox();
      expect(input).not.toBeNull();
      expect(output).not.toBeNull();
      if (width <= 740)
        expect(output!.y).toBeGreaterThanOrEqual(input!.y + input!.height - 1);
      if (width >= 820)
        expect(output!.x).toBeGreaterThanOrEqual(input!.x + input!.width - 1);
      await page
        .getByRole("button", { name: /^Copy / })
        .scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: /^Copy / })).toBeVisible();
    });
  }
  await enterZone(page, "UTC");
  await expect(page.locator(".hero-time")).toHaveText(/6:15:30 am/i);
  await page.getByRole("button", { name: /More options/ }).click();
  await page.getByLabel("Appearance", { exact: true }).click();
  await choose(page, "Theme", "light");
  await page.getByLabel("Appearance", { exact: true }).click();
  for (const width of [280, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByLabel("Message with a date or time")).toHaveValue(
      message,
    );
    await expect(page.locator(".hero-time")).toHaveText(/6:15:30 am/i);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const input = await page.locator(".input-panel").boundingBox();
    const output = await page.locator(".result-panel").boundingBox();
    if (width < 820)
      expect(output!.y).toBeGreaterThanOrEqual(input!.y + input!.height - 1);
    else expect(output!.x).toBeGreaterThanOrEqual(input!.x + input!.width - 1);
    if (width === 390) {
      expect((await page.locator(".hero-time").boundingBox())!.y).toBeLessThan(
        844,
      );
    }
  }
});

test("touch-sized controls and keyboard navigation remain usable in a short viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto("/");
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toBeVisible();
  for (const locator of [
    page.getByLabel("Convert to"),
    page.getByLabel("Message with a date or time"),
    page.getByRole("button", { name: /^Copy / }),
  ]) {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
    const bounds = await locator.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
  }
  await page.getByRole("button", { name: "Keep Time to Local handy" }).click();
  await expect(
    page.getByRole("heading", { name: "Use it anytime" }),
  ).toBeVisible();
});
