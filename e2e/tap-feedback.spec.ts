import {
  test,
  expect,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import { choose, enterReferenceDate } from "./choices";

test.use({ hasTouch: true, viewport: { width: 393, height: 851 } });
test.beforeEach(async ({ browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Native touch sequences use Chromium CDP; these are browser emulation checks.",
  );
});

async function start(cdp: CDPSession, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = (await control.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  return box;
}
async function stop(
  cdp: CDPSession,
  type: "touchCancel" | "touchEnd" = "touchCancel",
) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [] });
}
async function styles(control: Locator) {
  return control.evaluate((element) => {
    const css = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      background: css.backgroundColor,
      shadow: css.boxShadow,
      radius: Math.max(
        ...[
          css.borderTopLeftRadius,
          css.borderTopRightRadius,
          css.borderBottomLeftRadius,
          css.borderBottomRightRadius,
        ].map(parseFloat),
      ),
      tap: css.getPropertyValue("-webkit-tap-highlight-color"),
      outline: css.outlineWidth,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  });
}
async function pressedAttribute(control: Locator) {
  return (await control.evaluate((el) =>
    el.matches("[data-slot=button], [data-slot=collapsible-trigger]"),
  ))
    ? "data-pressed"
    : "data-touch-pressed";
}
async function pressedValue(control: Locator) {
  return (await pressedAttribute(control)) === "data-pressed" ? "true" : "";
}
async function hold(page: Page, milliseconds: number) {
  // This is the gesture's hold interval, not a settling delay before acting.
  return page.evaluate(async (duration) => {
    const start = performance.now();
    while (performance.now() - start < duration)
      await new Promise(requestAnimationFrame);
    return performance.now() - start;
  }, milliseconds);
}

test("touch presses use rounded palette feedback immediately across task controls", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page.locator("#message").fill("2026-04-09 3pm UTC");
  await expect(page.locator(".result .copy-button")).toBeVisible();
  const cdp = await context.newCDPSession(page);
  for (const theme of ["dark", "light"] as const) {
    if (theme === "light") {
      await page.locator(".appearance summary").tap();
      await choose(page, "Theme", "light");
      await page.locator(".appearance summary").tap();
    }
    const palette =
      theme === "dark" ? "rgb(178, 237, 137)" : "rgb(142, 64, 41)";
    const soft = theme === "dark" ? "rgb(34, 55, 42)" : "rgb(229, 221, 207)";
    let index = 0;
    const probe = async (control: Locator, copy = false, selected = false) => {
      await control.scrollIntoViewIfNeeded();
      const before = await styles(control);
      expect(before.tap).toBe("rgba(0, 0, 0, 0)");
      expect(before.radius).toBeGreaterThan(0);
      await start(cdp, control);
      // Sample the very first delivered touch; :active alone is delayed on Chrome.
      await expect(control).toHaveAttribute(
        await pressedAttribute(control),
        await pressedValue(control),
      );
      const pressed = await styles(control);
      expect(pressed.box).toEqual(before.box);
      expect(pressed.shadow).toContain("inset");
      expect(pressed.shadow).toContain(
        copy
          ? theme === "dark"
            ? "rgb(16, 32, 14)"
            : "rgb(255, 255, 255)"
          : selected
            ? theme === "dark"
              ? "rgb(20, 30, 24)"
              : "rgb(238, 232, 221)"
            : palette,
      );
      expect(pressed.background).toBe(copy || selected ? palette : soft);
      if (index++ < 3)
        await page.screenshot({
          path: info.outputPath(`${theme}-pressed-${index}.png`),
        });
      await stop(cdp);
      await expect(control).not.toHaveAttribute(
        await pressedAttribute(control),
        await pressedValue(control),
      );
      await expect
        .poll(async () => (await styles(control)).background)
        .toBe(before.background);
    };
    for (const selector of [
      ".appearance summary",
      ".input-tools button.example-button",
      ".input-tools button:has-text('Paste')",
      ".text-button:has-text('Clear')",
      ".options-trigger",
      ".choice-toggle",
      "footer button",
      ".brand",
    ])
      await probe(page.locator(selector).first());
    await probe(page.locator(".result .copy-button"), true);
    await page.locator(".appearance summary").tap();
    await probe(page.locator("#theme"));
    await page.locator("#theme").tap();
    await probe(page.getByRole("option").first());
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator(".choice-toggle").first().tap();
    await probe(page.getByRole("option").first());
    await page.keyboard.press("Escape");
    await page.locator(".options-trigger").tap();
    await probe(page.locator("#date-order"));
    await probe(page.locator("#time-format"));
    await probe(
      page.locator("#source-zone").locator("..").locator(".choice-toggle"),
    );
    await enterReferenceDate(page, "2026-04-09");
    await probe(page.locator(".date-choice-clear-button"));
    await probe(page.locator(".date-choice-calendar-button"));
    await page.locator(".date-choice-calendar-button").tap();
    await probe(page.locator(".calendar-navigation").first());
    await probe(page.locator(".calendar-day[data-selected]"), false, true);
    await probe(
      page
        .locator(
          ".calendar-day:not([data-selected]):not([data-outside-visible-range])",
        )
        .first(),
    );
    await probe(page.locator(".calendar-clear-choice"));
    await page.keyboard.press("Escape");
    await probe(page.getByRole("button", { name: "Reset preferences" }));
    await page.locator(".options-trigger").tap();
  }
});

test("touch feedback clears on release, cancellation, scroll and drag, including repeated and held taps", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  // A scrolling gesture needs remaining content below the viewport. The compact
  // empty phone layout can already be at its end after the earlier scroll.
  await page.locator("#message").fill("2026-04-09 3pm UTC; 2026-04-09 4pm UTC");
  await expect(page.locator(".result")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight - innerHeight,
    ),
  ).toBeGreaterThan(280);
  const cdp = await context.newCDPSession(page);
  const appearance = page.locator(".appearance summary");
  for (let index = 0; index < 4; index++) {
    await start(cdp, appearance);
    await expect(appearance).toHaveAttribute("data-touch-pressed", "");
    await stop(cdp, "touchEnd");
    await expect(appearance).not.toHaveAttribute("data-touch-pressed", "");
    await expect(appearance).toHaveAttribute(
      "aria-expanded",
      String(index % 2 === 0),
    );
  }
  await appearance.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.screenshot({ path: info.outputPath("released-touch.png") });
  const releasedFrames = await appearance.evaluate(async (element) => {
    const started = performance.now();
    const frames = [];
    while (performance.now() - started < 600) {
      await new Promise(requestAnimationFrame);
      const css = getComputedStyle(element);
      frames.push({
        elapsed: performance.now() - started,
        background: css.backgroundColor,
        shadow: css.boxShadow,
        pressed: element.hasAttribute("data-touch-pressed"),
        hover: element.matches(":hover"),
      });
    }
    return frames;
  });
  expect(releasedFrames.at(-1)).toMatchObject({
    background: "rgba(0, 0, 0, 0)",
    shadow: "none",
    pressed: false,
  });
  await info.attach("post-release-frames", {
    body: JSON.stringify(releasedFrames),
    contentType: "application/json",
  });
  await start(cdp, appearance);
  const duration = await hold(page, 600);
  await expect(appearance).toHaveAttribute("data-touch-pressed", "");
  await page.screenshot({ path: info.outputPath("held-touch.png") });
  await stop(cdp);
  await expect(appearance).not.toHaveAttribute("data-touch-pressed", "");
  await info.attach("actual-hold-duration", {
    body: JSON.stringify({ milliseconds: duration }),
    contentType: "application/json",
  });
  const box = await start(cdp, appearance);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 + 25 }],
  });
  await expect(appearance).not.toHaveAttribute("data-touch-pressed", "");
  await stop(cdp);
  await expect(appearance).toHaveAttribute("aria-expanded", "false");
  await start(cdp, appearance);
  await page.evaluate(() => window.scrollBy(0, 100));
  await expect(appearance).not.toHaveAttribute("data-touch-pressed", "");
  await stop(cdp);
  const disclosure = page.locator(".options-trigger");
  const scrollBox = await start(cdp, disclosure);
  const previousScroll = await page.evaluate(() => scrollY);
  for (const distance of [100, 180])
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: scrollBox.x + scrollBox.width / 2,
          y: scrollBox.y + scrollBox.height / 2 - distance,
        },
      ],
    });
  await stop(cdp, "touchEnd");
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(previousScroll);
  await expect(disclosure).not.toHaveAttribute(
    await pressedAttribute(disclosure),
    await pressedValue(disclosure),
  );
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await page.locator("#message").fill("Selection remains editable");
  const input = page.locator("#message");
  expect((await styles(input)).tap).not.toBe("rgba(0, 0, 0, 0)");
  await start(cdp, input);
  await expect(page.locator("[data-touch-pressed]")).toHaveCount(0);
  await stop(cdp, "touchEnd");
  await input.press("ControlOrMeta+A");
  expect(
    await input.evaluate(
      (element: HTMLTextAreaElement) =>
        element.selectionEnd - element.selectionStart,
    ),
  ).toBe(26);
  await page.keyboard.insertText("2026-04-09 4pm UTC");
  await expect(input).toHaveValue("2026-04-09 4pm UTC");
});

test("keyboard focus, forced colors, reduced motion and live System preserve touch feedback", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const cdp = await context.newCDPSession(page);
  const appearance = page.locator(".appearance summary");
  await page.keyboard.press("Tab");
  await expect(page.locator(".brand")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(appearance).toBeFocused();
  expect((await styles(appearance)).outline).toBe("2px");
  await page.keyboard.press("Space");
  await expect(appearance).toHaveAttribute("aria-expanded", "true");
  await choose(page, "Theme", "system");
  await appearance.tap();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      colorScheme,
    );
    await start(cdp, appearance);
    expect((await styles(appearance)).shadow).toContain("inset");
    await stop(cdp);
  }
  await page.emulateMedia({ forcedColors: "active" });
  const before = await styles(appearance);
  await start(cdp, appearance);
  const pressed = await styles(appearance);
  expect(pressed.background).not.toBe(before.background);
  expect(pressed.shadow).toBe("none");
  await stop(cdp);
  await appearance.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".brand")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(appearance).toBeFocused();
  expect((await styles(appearance)).outline).toBe("2px");
});
