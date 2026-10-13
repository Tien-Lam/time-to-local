import { test, expect, disconnect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import {
  choose,
  choiceTrigger,
  enterZone,
  enterReferenceDate,
} from "./choices";

for (const theme of ["light", "dark"] as const) {
  test(`Aqua ${theme} retains precision, reference date and usable menus across design changes`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('main[data-app-ready="true"]')).toBeVisible();
    await enterZone(page, "UTC");
    await page.getByRole("button", { name: /More options/ }).click();
    await enterReferenceDate(page, "2026-04-09");
    await choose(page, "Time format", "24");
    const draft = "Tomorrow at 15:42:18.123 UTC";
    await page.getByLabel("Message with a date or time").fill(draft);
    await expect(page.locator(".hero-time")).toHaveText("15:42:18.123");
    await expect(page.locator(".result-date")).toHaveText(/10 Apr(?:il)? 2026/);
    const result = (await page.locator(".result-group").textContent())!;
    await page.getByLabel("Appearance", { exact: true }).click();
    await choose(page, "Theme", theme);
    await choose(page, "Design", "aqua");
    await expect(page.locator("html")).toHaveAttribute("data-design", "aqua");
    await expect(page.locator(".result-group")).toHaveText(result);
    await expect(choiceTrigger(page, "Design")).toBeFocused();
    await choose(page, "Design", "command");
    await expect(page.locator(".result-group")).toHaveText(result);
    await choose(page, "Design", "aqua");
    await page.getByLabel("Appearance", { exact: true }).click();
    for (const width of [280, 390, 960]) {
      await page.setViewportSize({ width, height: 960 });
      await expect(page.getByLabel("Message with a date or time")).toHaveValue(
        draft,
      );
      await expect(page.locator(".result-group")).toHaveText(result);
      await expect(
        page.locator('#reference-date [data-type="day"]'),
      ).toHaveAttribute("aria-valuenow", "9");
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      const time = await page.locator(".time-number").boundingBox();
      const panel = await page.locator(".result-panel").boundingBox();
      expect(time!.x + time!.width).toBeLessThanOrEqual(
        panel!.x + panel!.width,
      );
      await page
        .getByRole("button", { name: /^Choose reference date/ })
        .click();
      const popup = page.locator(".calendar-popover");
      await expect(popup).toBeVisible();
      const box = (await popup.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(302);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
    }
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await page.getByLabel("Appearance", { exact: true }).click();
    await choose(page, "Theme", "system");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".result-group")).toHaveText(result);
    await page.getByLabel("Appearance", { exact: true }).click();
    await page
      .getByRole("button", { name: "Reset preferences", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-design",
      "command",
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByLabel("Message with a date or time")).toHaveValue(
      draft,
    );
  });
}

test("Aqua persists through offline reopen without persisting the draft", async ({
  page,
  context,
  origin,
}) => {
  await page.goto("/");
  await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
  await enterZone(page, "UTC");
  await page.getByLabel("Appearance", { exact: true }).click();
  await choose(page, "Design", "aqua");
  await choose(page, "Theme", "light");
  await page.getByLabel("Appearance", { exact: true }).click();
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm in Tokyo");
  await expect(page.locator(".hero-time")).toHaveText(/6:00 am/i);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("chronoshift.preferences.v1")!)
            .design,
      ),
    )
    .toBe("aqua");
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain("April");
  await page.close();
  await disconnect(context, origin);
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.locator("html")).toHaveAttribute("data-design", "aqua");
  await expect(reopened.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(reopened.getByLabel("Message with a date or time")).toHaveValue(
    "",
  );
  await reopened
    .getByLabel("Message with a date or time")
    .fill("July 15, 2026 15:00 UTC");
  await expect(reopened.locator(".hero-time")).toHaveText(/3:00 pm/i);
  await reopened.getByRole("link", { name: "About", exact: true }).click();
  await expect(
    reopened.getByRole("heading", { name: "About Time to Local" }),
  ).toBeVisible();
});

test("denied storage keeps Aqua usable for the session", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage denied");
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Appearance", { exact: true }).click();
  await choose(page, "Design", "aqua");
  await expect(page.locator("html")).toHaveAttribute("data-design", "aqua");
  await page.getByLabel("Appearance", { exact: true }).click();
  await enterZone(page, "UTC");
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm in Tokyo");
  await expect(page.locator(".hero-time")).toHaveText(/6:00 am/i);
  await expect(
    page.getByText("Preferences cannot be saved", { exact: false }),
  ).toBeVisible();
});

test("Aqua forced colours retain pressed Copy contrast", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  await page.getByLabel("Appearance", { exact: true }).click();
  await choose(page, "Design", "aqua");
  await page.getByLabel("Appearance", { exact: true }).click();
  await enterZone(page, "UTC");
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm in Tokyo");
  await expect(page.locator(".hero-time")).toHaveText(/6:00 am/i);
  const button = page.locator(".copy-button");
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await expect(button).toHaveAttribute("data-pressed", "true");
    const paint = await button.evaluate((element) => {
      const css = getComputedStyle(element);
      return {
        background: css.backgroundImage,
        shadow: css.boxShadow,
        colour: css.color,
        fill: css.backgroundColor,
      };
    });
    expect(paint.background).toBe("none");
    expect(paint.shadow).toBe("none");
    expect(paint.colour).not.toBe(paint.fill);
  } finally {
    await page.mouse.up();
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`Aqua ${theme} narrow results and menus have no accessibility violations`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.getByLabel("Appearance", { exact: true }).click();
    await choose(page, "Design", "aqua");
    await choose(page, "Theme", theme);
    await page.getByLabel("Appearance", { exact: true }).click();
    await enterZone(page, "UTC");
    await page
      .getByLabel("Message with a date or time")
      .fill("July 15, 2026 3pm CST");
    await expect(
      page.getByText("2 possible interpretations", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 280, height: 960 });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`aqua-${theme}-280.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 960, height: 900 });
    await page.screenshot({
      path: info.outputPath(`aqua-${theme}-960.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Show target timezones", exact: true })
      .click();
    await expect(page.getByRole("listbox")).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          // Audit the open menu itself; the closed-page audit above covers the workspace.
          .include(".choice-popover")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
}
