import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["light", "dark"]) {
  test(`owned Aqua ${theme} catalogue retains accessible parts and narrow controls`, async ({
    page,
  }, info) => {
    await page.goto(`/__gallery/?design=aqua&theme=${theme}`);
    const checkbox = page.getByRole("checkbox", {
      name: "Interactive checkbox",
      exact: true,
    });
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.press("Space");
    await expect(checkbox).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Disabled checkbox", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("checkbox", {
        name: "Disabled checked checkbox",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      page.getByRole("searchbox", { name: "Search field", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Invalid field", exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await page
      .getByRole("button", { name: "Keep current", exact: true })
      .click();
    await expect(page.getByRole("status").last()).toHaveText(
      "Current message retained in the local sample",
    );
    for (const width of [280, 390, 960]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const box of await page
        .locator(".gallery-row button")
        .evaluateAll((buttons) =>
          buttons.map((button) => ({
            width: button.getBoundingClientRect().width,
            height: button.getBoundingClientRect().height,
          })),
        )) {
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeLessThanOrEqual(width);
      }
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      if (width !== 280)
        await page.screenshot({
          path: info.outputPath(`aqua-parts-${theme}-${width}.png`),
          fullPage: true,
        });
    }
  });
}
