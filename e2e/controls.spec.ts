import { test, expect } from "./fixtures";
import {
  choose,
  choiceTrigger,
  enterReferenceDate,
  enterZone,
} from "./choices";
import type { Locator, Page } from "@playwright/test";

async function expectPopup(
  page: Page,
  trigger: Locator,
  width: number,
  matchesTrigger = true,
) {
  const popup = page.locator(".choice-popover:visible");
  await expect(popup).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await popup.boundingBox();
      return !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1;
    })
    .toBe(true);
  const bounds = (await popup.boundingBox())!;
  const control = (await trigger.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(961);
  if (matchesTrigger)
    expect(bounds.width).toBeGreaterThanOrEqual(
      Math.min(control.width, width - 24) - 1,
    );
  const style = await popup.evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      background: css.backgroundColor,
      border: css.borderTopWidth,
      radius: css.borderTopLeftRadius,
      overflow: element.scrollWidth > element.clientWidth,
    };
  });
  expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(style.border).toBe("1px");
  expect(Number.parseFloat(style.radius)).toBeGreaterThanOrEqual(8);
  expect(style.overflow).toBe(false);
  return style.background;
}

async function dismissMenu(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".choice-popover:visible")).toHaveCount(0);
}

test("themed choices align and their opened menus fit every breakpoint without losing work", async ({
  page,
  browserName,
}, info) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const violations: { directive: string; blockedURI: string }[] = [];
    (window as any).__choiceCspViolations = violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push({
        directive: event.effectiveDirective,
        blockedURI: event.blockedURI,
      });
    });
  });
  await page.goto("/");
  const draft = "April 9, 2026 3pm UTC";
  await page.getByLabel("Message with a date or time").fill(draft);
  await enterZone(page, "Pacific/Chatham");
  await expect(page.locator(".hero-time")).toBeVisible();
  const result = await page.locator(".hero-time").innerText();
  await page.getByRole("button", { name: /More options/ }).click();
  await page
    .getByRole("button", { name: "Display preferences", exact: true })
    .click();
  await page.getByLabel("Appearance", { exact: true }).click();
  const backgrounds = new Map<string, string>();
  for (const theme of ["dark", "light"]) {
    await choose(page, "Theme", theme);
    for (const width of [280, 740, 1280]) {
      await test.step(`${theme}, ${width}px`, async () => {
        await page.setViewportSize({ width, height: 960 });
        const dimensions = await page.evaluate(() => {
          return [
            "theme",
            "target-zone",
            "source-zone",
            "reference-date",
            "date-order",
            "time-format",
          ].map((id) => {
            const element = document.getElementById(id)!;
            const css = getComputedStyle(
              element.querySelector(".date-input") || element,
            );
            const bounds = element.getBoundingClientRect();
            const label = (
              id === "reference-date"
                ? element
                    .closest(".date-choice")!
                    .querySelector(".date-choice-label")!
                : document.querySelector(`label[for="${id}"]`)!
            ).getBoundingClientRect();
            return {
              id,
              height: bounds.height,
              inset: css.paddingInlineStart,
              font: css.fontSize,
              lineHeight: css.lineHeight,
              labelDelta: bounds.left - label.left,
            };
          });
        });
        for (const control of dimensions) {
          expect(control.height, control.id).toBe(44);
          expect(control.inset, control.id).toBe("12px");
          expect(control.font, control.id).toBe("16px");
          expect(control.lineHeight, control.id).toBe("24px");
          // The approved target row places its label beside the field above
          // 480px; settings and narrow target labels remain directly above.
          expect(control.labelDelta, control.id).toBe(
            control.id === "target-zone" && width > 480 ? 112 : 0,
          );
        }
        const appearance = (await page
          .locator(".appearance summary")
          .boundingBox())!;
        const panel = (await page.locator(".appearance-fields").boundingBox())!;
        expect(panel.x + panel.width).toBeCloseTo(
          appearance.x + appearance.width,
          1,
        );
        expect(panel.y - appearance.y - appearance.height).toBeCloseTo(8, 1);
        expect(panel.x).toBeGreaterThanOrEqual(0);
        expect(panel.x + panel.width).toBeLessThanOrEqual(width);
        for (const label of [
          "Theme",
          "Date order in messages",
          "Time format",
        ]) {
          const trigger = choiceTrigger(page, label);
          await trigger.click();
          const background = await expectPopup(page, trigger, width);
          if (label === "Theme") {
            backgrounds.set(theme, background);
            // WebKit screenshots inject Playwright's temporary `body {}`
            // stylesheet. Keep that deliberate CSP rejection out of this
            // application's normal-interaction diagnostic journey.
            if (browserName !== "webkit")
              await page.screenshot({
                path: info.outputPath(`menu-${theme}-${width}.png`),
              });
          }
          expect(background).toBe(backgrounds.get(theme));
          await expect(page.getByRole("listbox")).toBeVisible();
          await expect(
            page.getByRole("option", { selected: true }),
          ).toHaveCount(1);
          const option = page.getByRole("option").first();
          const optionStyle = await option.evaluate((element) => {
            const css = getComputedStyle(element);
            return {
              height: element.getBoundingClientRect().height,
              font: css.fontSize,
              lineHeight: css.lineHeight,
            };
          });
          expect(optionStyle.height).toBeGreaterThanOrEqual(44);
          expect(optionStyle.font).toBe("16px");
          expect(optionStyle.lineHeight).toBe("24px");
          await dismissMenu(page);
          await expect(trigger).toBeFocused();
        }
        for (const [id, button] of [
          ["target-zone", "Show target timezones"],
          ["source-zone", "Show source timezones"],
        ]) {
          const toggle = page.getByRole("button", {
            name: button,
            exact: true,
          });
          // Reach the control before opening it, as a touch user would.
          // Scrolling from a previously focused offscreen format field during
          // the synthetic click can dismiss the newly opened combobox popup.
          await toggle.scrollIntoViewIfNeeded();
          await toggle.click();
          expect(await expectPopup(page, page.locator(`#${id}`), width)).toBe(
            backgrounds.get(theme),
          );
          await expect(page.getByRole("listbox")).toBeVisible();
          await expect(page.getByRole("option").first()).toBeVisible();
          await dismissMenu(page);
        }
        const dateTrigger = page.getByRole("button", {
          name: /^Choose reference date/,
        });
        await dateTrigger.click();
        expect(
          await expectPopup(
            page,
            page.locator("#reference-date"),
            width,
            false,
          ),
        ).toBe(backgrounds.get(theme));
        await expect(page.locator(".calendar-popover")).toBeVisible();
        const calendar = (await page
          .locator(".calendar-popover")
          .boundingBox())!;
        const dateField = (await page
          .locator("#reference-date")
          .boundingBox())!;
        expect(calendar.width).toBeLessThanOrEqual(302);
        const alignedLeft = Math.max(
          12,
          Math.min(dateField.x, width - calendar.width - 12),
        );
        expect(Math.abs(calendar.x - alignedLeft)).toBeLessThanOrEqual(1);
        await expect(page.getByRole("grid")).toBeVisible();
        await dismissMenu(page);
        await expect(
          page.getByLabel("Message with a date or time"),
        ).toHaveValue(draft);
        await expect(page.locator(".hero-time")).toHaveText(result);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    }
  }
  expect(backgrounds.get("dark")).not.toBe(backgrounds.get("light"));
  expect(
    await page.evaluate(() => (window as any).__choiceCspViolations),
  ).toEqual([]);
  const injectedStyles = await page.locator("style").evaluateAll((elements) =>
    elements.map((element) => ({
      text: element.textContent,
      hasSheet: (element as HTMLStyleElement).sheet !== null,
    })),
  );
  expect(injectedStyles.length).toBeGreaterThan(0);
  expect(injectedStyles.every((style) => style.hasSheet)).toBe(true);
});

test("choice menus support keyboard selection, nested Escape and pointer dismissal", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Appearance", { exact: true }).click();
  const theme = choiceTrigger(page, "Theme");
  await theme.focus();
  await theme.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator(".appearance")).toHaveAttribute("open", "");
  await expect(theme).toBeFocused();
  await theme.press("Escape");
  await expect(page.locator(".appearance")).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("Appearance", { exact: true })).toBeFocused();

  await page.getByRole("button", { name: /More options/ }).click();
  await page
    .getByRole("button", { name: "Display preferences", exact: true })
    .click();
  const time = choiceTrigger(page, "Time format");
  await time.focus();
  await time.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(
    page.locator('[role="option"][data-value="24"]'),
  ).toHaveAttribute("data-focused", "true");
  await page.keyboard.press("Enter");
  await expect(time).toHaveAttribute("data-value", "24");
  await expect(time).toBeFocused();
  await time.click();
  await expect(page.getByRole("option", { selected: true })).toHaveAttribute(
    "data-value",
    "24",
  );
  // Click outside the popup itself, including the modal dismissal underlay.
  await page.mouse.click(4, 4);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(time).toHaveAttribute("data-value", "24");

  await choose(page, "Date order in messages", "dmy");
  await enterZone(page, "UTC");
  await page
    .getByLabel("Message with a date or time")
    .fill("04/09/2026 3pm UTC");
  await expect(page.locator(".result-date")).toHaveText(
    /4 Sep(?:t(?:ember)?)? 2026/,
  );
  await expect(page.locator(".hero-time")).toHaveText("15:00");
  await choose(page, "Date order in messages", "mdy");
  await expect(page.locator(".result-date")).toHaveText(/9 Apr(?:il)? 2026/);
  await enterReferenceDate(page, "2026-04-09");
  await page
    .getByLabel("Message with a date or time")
    .fill("Tomorrow at 3pm UTC");
  await expect(page.locator(".result-date")).toHaveText(/10 Apr(?:il)? 2026/);
  const day = page.locator('#reference-date [data-type="day"]');
  await day.click();
  await day.press("Backspace");
  await expect(day).toHaveAttribute("data-placeholder", "true");
  await expect(page.locator(".result")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText(
    "Complete or clear the reference date to continue.",
  );
  await expect(page.locator(".result")).toHaveCount(0);
  await enterReferenceDate(page, "2026-04-09");
  await page.getByRole("button", { name: /^Choose reference date/ }).click();
  const selectedDay = page.locator(".calendar-day[data-selected]");
  await expect(selectedDay).toHaveText("9");
  await selectedDay.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator(".calendar-popover")).toHaveCount(0);
  await expect(
    page.locator('#reference-date [data-type="day"]'),
  ).toHaveAttribute("aria-valuenow", "10");
  await expect(page.locator(".result-date")).toHaveText(/11 Apr(?:il)? 2026/);
  await page.getByRole("button", { name: /^Choose reference date/ }).click();
  await page
    .locator(".calendar-popover")
    .getByRole("button", { name: "Clear reference date", exact: true })
    .click();
  await expect(page.locator(".calendar-popover")).toHaveCount(0);
  for (const type of ["year", "month", "day"]) {
    await expect(
      page.locator(`#reference-date [data-type="${type}"]`),
    ).toHaveAttribute("data-placeholder", "true");
  }
  const year = page.locator('#reference-date [data-type="year"]');
  await year.click();
  for (const digit of "2027") await year.press(digit);
  await year.press("Tab");
  await expect(page.getByRole("alert")).toHaveText(
    "Complete or clear the reference date to continue.",
  );
  await page
    .getByRole("button", { name: "Reset preferences", exact: true })
    .click();
  for (const type of ["year", "month", "day"]) {
    await expect(
      page.locator(`#reference-date [data-type="${type}"]`),
    ).toHaveAttribute("data-placeholder", "true");
  }
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const label of ["Convert to", "Source timezone"]) {
  for (const opening of ["keyboard", "pointer"]) {
    test(`first ${opening} opening of ${label} preserves the saved value and permits selection`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          "chronoshift.preferences.v1",
          JSON.stringify({ target: "UTC", source: "UTC" }),
        );
      });
      await page.goto("/");
      if (label === "Source timezone")
        await page.getByRole("button", { name: /More options/ }).click();
      const input = page.getByLabel(label, { exact: true });
      await expect(input).toHaveValue("UTC");
      await input.scrollIntoViewIfNeeded();
      if (opening === "keyboard") {
        await input.click();
        await input.press("ArrowDown");
        await expect(
          page.locator('[role="option"][data-value="UTC"]'),
        ).toHaveAttribute("data-focused", "true");
        await input.press("Enter");
      } else {
        await page
          .getByRole("button", {
            name:
              label === "Convert to"
                ? "Show target timezones"
                : "Show source timezones",
            exact: true,
          })
          .click();
        await expect(
          page.locator('[role="option"][data-value="UTC"]'),
        ).toHaveAttribute("aria-selected", "true");
        await input.press("Escape");
      }
      await expect(input).toHaveValue("UTC");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await input.fill("Tokyo");
      await page.getByRole("option", { name: "Tokyo", exact: true }).click();
      await expect(input).toHaveValue("Asia/Tokyo");
      if (label === "Convert to")
        await page.getByRole("button", { name: /More options/ }).click();
      await expect(
        page.getByLabel(
          label === "Convert to" ? "Source timezone" : "Convert to",
          { exact: true },
        ),
      ).toHaveValue("UTC");
    });
  }
}

test("focusing a displayed city preserves its text and replacing the zone keeps identities independent", async ({
  page,
}) => {
  await page.goto("/");
  await enterZone(page, "Asia/Tokyo");
  const target = page.getByLabel("Convert to", { exact: true });
  await target.click();
  await expect(target).toHaveValue("Tokyo");
  await target.press("End");
  await target.pressSequentially("!");
  await expect(target).toHaveValue("Tokyo!");
  await enterZone(page, "Pacific/Chatham");
  await expect(target).toHaveValue("Chatham");
  await page.getByRole("button", { name: /Message interpretation/ }).click();
  await enterZone(page, "UTC", "Source timezone");
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm");
  await expect(page.locator(".hero-time")).toHaveText(/3:45 am/i);
  await expect(page.locator(".result-date")).toContainText("10 Apr 2026");
  await enterZone(page, "UTC");
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
  await expect(page.getByLabel("Source timezone", { exact: true })).toHaveValue(
    "UTC",
  );
});

test("timezone search preserves freeform offsets and recovers from empty and invalid choices", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /More options/ }).click();
  const target = page.getByLabel("Convert to", { exact: true });
  const source = page.getByLabel("Source timezone", {
    exact: true,
  });
  await source.fill("UTC");
  await target.fill("Tokyo");
  await expect(page.getByRole("option", { name: /Tokyo/ })).toHaveCount(1);
  await target.press("ArrowDown");
  await target.press("Enter");
  await expect(target).toHaveValue("Asia/Tokyo");
  await expect(source).toHaveValue("UTC");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/12:00 am/i);
  await target.fill("UTC");
  await expect(page.getByRole("listbox")).toBeVisible();
  // Valid freeform zones convert automatically; dismiss suggestions separately.
  await target.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);

  if (isMobile) await target.tap({ position: { x: 24, y: 22 } });
  else await target.click();
  await target.fill("Definitely/Not-A-Timezone");
  await expect(page.getByText(/^No matches\./)).toBeVisible();
  await expect(page.locator('[role="option"][data-value]')).toHaveCount(0);
  await target.press("Escape");
  await expect(target).toHaveValue("Definitely/Not-A-Timezone");
  await expect(target).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".result")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(/timezone/i);

  await target.fill("+05:45");
  await target.press("Escape");
  await expect(target).toHaveValue("+05:45");
  await expect(target).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".hero-time")).toHaveText(/8:45 pm/i);
  await expect(source).toHaveValue("UTC");

  await target.fill("");
  await target.press("Escape");
  await page
    .getByRole("button", { name: "Show target timezones", exact: true })
    .click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.setViewportSize({ width: 280, height: 960 });
  await expectPopup(page, target, 280);
  await expect(target).toHaveValue("");
  await target.press("Escape");
  await target.fill("Tokyo");
  await page.getByRole("option", { name: /Tokyo/ }).click();
  await expect(target).toBeFocused();
  await expect(target).toHaveValue("Asia/Tokyo");
  await expect(page.locator(".hero-time")).toHaveText(/12:00 am/i);
  await source.fill("New York");
  await page.getByRole("option", { name: /New York/ }).click();
  await expect(source).toHaveValue("America/New_York");
  await expect(target).toHaveValue("Tokyo");
  await expect(page.locator(".hero-time")).toHaveText(/12:00 am/i);
});

test("hovering timezone suggestions preserves typed values while explicit selections still commit", async ({
  page,
  browserName,
  isMobile,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /More options/ }).click();
  await enterZone(page, "UTC", "Source timezone");
  await enterZone(page, "UTC");
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm UTC");
  for (const label of ["Convert to", "Source timezone"]) {
    const input = page.getByLabel(label, { exact: true });
    const other = page.getByLabel(
      label === "Convert to" ? "Source timezone" : "Convert to",
      { exact: true },
    );
    await enterZone(page, "CST", label);
    const otherValue = await other.inputValue();
    // Bring the field back into view after Tab focused the next control.
    // fill() can otherwise focus an offscreen field and dismiss the newly
    // opened suggestions when the browser performs its delayed focus scroll.
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.fill("Asia/Tokyo");
    await expect(input).toHaveAttribute("aria-controls", /.+/);
    const suggestions = page.locator(
      `[id="${await input.getAttribute("aria-controls")}"]`,
    );
    const alias = suggestions.getByRole("option", {
      name: "Osaka",
      exact: true,
    });
    // Leave any prior pointer position so this exercises a fresh hover event.
    await page.mouse.move(0, 0);
    await alias.hover();
    await expect(alias).toHaveAttribute("data-hovered", "true");
    await input.press("Tab");
    await expect(input).toHaveValue("Tokyo");
    await expect(other).toHaveValue(otherValue);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.locator(".hero-time")).toHaveText(/12:00 am/i);
    await expect(page.locator(".result-date")).toContainText("10 Apr");

    // Navigation and selection are deliberate actions, unlike mere hover.
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.fill("Asia/Toky");
    await input.press("ArrowDown");
    await input.press("End");
    await expect(alias).toHaveAttribute("data-focused", "true");
    await input.press("Tab");
    await expect(input).toHaveValue("Osaka");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    // A real pointer interaction brings the field into view before typing.
    // Focusing an offscreen input with fill() can scroll its ancestor after
    // opening the popup; React Aria intentionally dismisses on that scroll.
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await input.fill("Tokyo");
    await expect(input).toHaveAttribute("aria-expanded", "true");
    const reopenedSuggestions = page.locator(
      `[id="${await input.getAttribute("aria-controls")}"]`,
    );
    await expect(reopenedSuggestions).toBeVisible();
    await reopenedSuggestions
      .getByRole("option", { name: "Tokyo", exact: true })
      .click();
    await expect(input).toHaveValue("Asia/Tokyo");
    await expect(other).toHaveValue(otherValue);
  }
  // Summary reflow must preserve suggestions, while deliberate page scrolling
  // still dismisses them without committing a hovered or focused suggestion.
  const source = page.getByLabel("Source timezone", { exact: true });
  await source.scrollIntoViewIfNeeded();
  await source.click();
  await source.press("ArrowDown");
  await source.press("End");
  await expect(page.getByRole("listbox")).toBeVisible();
  const scrollBefore = await page.evaluate(() => scrollY);
  const scrollDelta = scrollBefore > 0 ? -160 : 160;
  // Wheel the document outside the popup, rather than the suggestion list or
  // an already exhausted page edge. Verify an actual document scroll occurred.
  await page.mouse.move(4, 4);
  if (browserName === "webkit" && isMobile) {
    // Mobile WebKit emulation has no mouse-wheel capability. Exercise the
    // resulting document scroll and dismissal without claiming a touch swipe.
    await page.evaluate(() => window.scrollBy(0, scrollY > 0 ? -160 : 160));
  } else {
    await page.mouse.wheel(0, scrollDelta);
  }
  await expect.poll(() => page.evaluate(() => scrollY)).not.toBe(scrollBefore);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(source).toHaveValue("Asia/Tokyo");
  await expect(page.getByLabel("Convert to", { exact: true })).toHaveValue(
    "Tokyo",
  );
  await expect(page.getByLabel("Message with a date or time")).toHaveValue(
    "April 9, 2026 3pm UTC",
  );
  await expect(page.locator(".hero-time")).toHaveText(/12:00 am/i);
  await expect(page.locator(".result-date")).toContainText("10 Apr");
});
