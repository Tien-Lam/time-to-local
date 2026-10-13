import { test, expect } from "./fixtures";
import { choose, enterZone } from "./choices";

test.use({ actionTimeout: 10_000 });

for (const theme of ["light", "dark"] as const) {
  test(`Aqua ${theme} dropdown feedback follows the field curve`, async ({
    page,
  }, info) => {
    // Capture both fields during hover and press without borrowing the action deadline.
    test.setTimeout(60_000);
    await page.goto("/");
    await page.getByLabel("Appearance", { exact: true }).click();
    await choose(page, "Design", "aqua");
    await choose(page, "Theme", theme);
    await page.getByLabel("Appearance", { exact: true }).click();
    await enterZone(page, "UTC");
    const draft = "April 9, 2026 3:15:30pm in Tokyo";
    await page.getByLabel("Message with a date or time").fill(draft);
    await expect(page.locator(".hero-time")).toHaveText(/6:15:30 am/i);
    await page.getByRole("button", { name: /More options/ }).click();
    for (const field of ["target", "source"] as const) {
      // The menu hides its trigger from the accessibility tree while pressed.
      // Keep the measurement scoped to the input-owned DOM control.
      const button = page
        .locator(`#${field}-zone`)
        .locator("..")
        .locator(".choice-toggle");
      await expect(button).toBeVisible();
      await button.hover();
      const contour = () =>
        button.evaluate((element) => {
          const input = element.parentElement!.querySelector("input")!;
          const surface = getComputedStyle(input);
          const highlight = getComputedStyle(element);
          return {
            hovered: element.matches(":hover"),
            pressed:
              element.matches(":active") ||
              element.getAttribute("data-pressed") === "true",
            right: parseFloat(highlight.borderTopRightRadius),
            expectedRight:
              parseFloat(surface.borderTopRightRadius) -
              parseFloat(surface.borderRightWidth),
            height: element.getBoundingClientRect().height,
          };
        });
      await page.screenshot({
        path: info.outputPath(`${theme}-${field}-hover.png`),
      });
      const hover = await contour();
      expect(hover.hovered).toBe(true);
      expect(hover.height).toBeGreaterThanOrEqual(44);
      expect(hover.right).toBeCloseTo(hover.expectedRight, 2);
      await page.mouse.down();
      try {
        const pressed = await contour();
        expect(pressed.pressed).toBe(true);
        await page.screenshot({
          path: info.outputPath(`${theme}-${field}-pressed.png`),
        });
        expect(pressed.right).toBeCloseTo(pressed.expectedRight, 2);
      } finally {
        await page.mouse.up();
      }
      await expect(page.locator(`#${field}-zone`)).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await page.locator(`#${field}-zone`).press("Escape");
      await expect(page.locator(`#${field}-zone`)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(page.getByLabel("Message with a date or time")).toHaveValue(
        draft,
      );
      await expect(page.locator(".hero-time")).toHaveText(/6:15:30 am/i);
    }
  });
}
