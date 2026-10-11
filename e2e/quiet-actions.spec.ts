import { test, expect, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { choose } from "./choices";

async function geometry(control: Locator) {
  return control.evaluate((element) => {
    // Measure the rendered label independently of padding/alignment declarations.
    const range = document.createRange();
    range.selectNodeContents(element);
    const label = range.getBoundingClientRect();
    const surface = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    return {
      box: {
        x: surface.x,
        y: surface.y,
        width: surface.width,
        height: surface.height,
      },
      labelCentreError:
        label.x + label.width / 2 - (surface.x + surface.width / 2),
      background: css.backgroundColor,
      outline: css.outlineWidth,
      shadow: css.boxShadow,
      radius: css.borderRadius,
      hover: element.matches(":hover"),
      active: element.matches(":active"),
      pressed: element.getAttribute("data-pressed") === "true",
      focusVisible: element.matches(":focus-visible"),
    };
  });
}

test("quiet actions activate once by keyboard and preserve the message focus after clipboard rejection and Clear", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        readText: () => {
          (window as any).pasteReads = ((window as any).pasteReads || 0) + 1;
          return Promise.reject(new Error("Injected read rejection"));
        },
      },
    });
  });
  await page.goto("/");
  const input = page.locator("#message");
  await input.fill("April 9, 2026 3pm UTC");
  await input.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Paste", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".notice")).toHaveText(
    "Paste directly into the message box using your keyboard or touch menu.",
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("April 9, 2026 3pm UTC");
  expect(await page.evaluate(() => (window as any).pasteReads)).toBe(1);
  await input.press("ControlOrMeta+A");
  await page.keyboard.insertText("June 18, 2026 9am UTC");
  await input.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Clear", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Space");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(page.locator(".result")).toHaveCount(0);
});

test.describe("quiet action native touch", () => {
  test.use({ hasTouch: true, viewport: { width: 393, height: 851 } });
  test("Paste and Clear retain centred rounded feedback through cancellation, drag and release", async ({
    page,
    context,
    browserName,
  }, info) => {
    test.skip(
      browserName !== "chromium",
      "Native touch uses Chromium CDP; this is browser emulation.",
    );
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          readText: () => {
            (window as any).pasteReads = ((window as any).pasteReads || 0) + 1;
            return Promise.resolve("April 9, 2026 3pm UTC");
          },
        },
      });
    });
    await page.goto("/");
    const input = page.locator("#message");
    const cdp = await context.newCDPSession(page);
    for (const theme of ["dark", "light"] as const) {
      if (theme === "light") {
        await page.locator(".appearance summary").tap();
        await choose(page, "Theme", "light");
        await page.locator(".appearance summary").tap();
      }
      await input.fill("June 18, 2026 9am UTC");
      for (const name of ["Paste", "Clear"]) {
        const control = page.getByRole("button", { name, exact: true });
        await control.scrollIntoViewIfNeeded();
        const before = await geometry(control);
        const x = before.box.x + before.box.width / 2;
        const y = before.box.y + before.box.height / 2;
        for (const cancel of ["cancel", "drag"] as const) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y }],
          });
          await expect(control).toHaveAttribute("data-pressed", "true");
          const pressed = await geometry(control);
          expect(pressed.box).toEqual(before.box);
          expect(Math.abs(pressed.labelCentreError)).toBeLessThanOrEqual(1);
          expect(pressed.background).toBe(
            theme === "dark" ? "rgb(34, 55, 42)" : "rgb(229, 221, 207)",
          );
          expect(pressed.shadow).toContain("inset");
          expect(pressed.radius).toBe("8px");
          await page.locator(".input-tools").screenshot({
            path: info.outputPath(`${theme}-${name}-${cancel}-pressed.png`),
          });
          if (cancel === "drag") {
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: x + 25, y }],
            });
            await expect(control).not.toHaveAttribute("data-pressed", "true");
          }
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchCancel",
            touchPoints: [],
          });
          await expect(control).not.toHaveAttribute("data-pressed", "true");
          await expect(input).toHaveValue("June 18, 2026 9am UTC");
        }
      }
      expect(await page.evaluate(() => (window as any).pasteReads || 0)).toBe(
        theme === "dark" ? 0 : 1,
      );
      for (const name of ["Paste", "Clear"]) {
        const control = page.getByRole("button", { name, exact: true });
        const box = (await control.boundingBox())!;
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          ],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await expect(page.locator("[data-touch-pressed]")).toHaveCount(0);
        await expect(input).toHaveValue(
          name === "Paste" ? "April 9, 2026 3pm UTC" : "",
        );
        await expect(input).toBeFocused();
      }
      expect(await page.evaluate(() => (window as any).pasteReads)).toBe(
        theme === "dark" ? 1 : 2,
      );
    }
  });
});

for (const theme of ["dark", "light"] as const) {
  for (const filled of [false, true]) {
    test(`${theme} quiet actions centre labels with ${filled ? "Paste and Clear" : "Paste alone"} through native pointer and keyboard states`, async ({
      page,
      isMobile,
      browser,
    }, info) => {
      test.skip(isMobile, "Desktop hover requires a hover-capable profile.");
      const started = new Date().toISOString();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      if (theme === "light") {
        await page.locator(".appearance summary").click();
        await choose(page, "Theme", "light");
        await page.locator(".appearance summary").click();
      }
      const input = page.locator("#message");
      if (filled) await input.fill("April 9, 2026 3pm UTC");
      const neighbour = page.getByRole("button", { name: "Try example" });
      const samples: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
      for (const name of filled ? ["Paste", "Clear"] : ["Paste"]) {
        const control = page.getByRole("button", { name, exact: true });
        await input.click();
        await page.mouse.move(0, 0);
        const before = await geometry(control);
        const neighbourBefore = await neighbour.boundingBox();
        samples[`${name}-rest`] = before;
        await page.locator(".input-tools").screenshot({
          path: info.outputPath(`${name}-rest.png`),
        });
        await control.hover();
        samples[`${name}-hover`] = await geometry(control);
        await page.locator(".input-tools").screenshot({
          path: info.outputPath(`${name}-hover.png`),
        });
        await page.mouse.down();
        samples[`${name}-press`] = await geometry(control);
        await page.locator(".input-tools").screenshot({
          path: info.outputPath(`${name}-press.png`),
        });
        // Release outside the button so the press does not activate Paste/Clear.
        await page.mouse.move(0, 0);
        await page.mouse.up();
        await input.focus();
        await page.keyboard.press("Tab");
        await expect(neighbour).toBeFocused();
        await page.keyboard.press("Tab");
        if (name === "Clear") await page.keyboard.press("Tab");
        await expect(control).toBeFocused();
        samples[`${name}-focus`] = await geometry(control);
        await page.locator(".input-tools").screenshot({
          path: info.outputPath(`${name}-focus.png`),
        });
        expect(await neighbour.boundingBox()).toEqual(neighbourBefore);
        for (const state of ["hover", "press", "focus"])
          expect(samples[`${name}-${state}`].box).toEqual(before.box);
        expect(samples[`${name}-hover`].hover).toBe(true);
        // Focus-preserving React Aria presses can suppress native :active.
        // The effective pressed state must still drive the same feedback.
        expect(
          samples[`${name}-press`].active || samples[`${name}-press`].pressed,
        ).toBe(true);
        expect(samples[`${name}-focus`].focusVisible).toBe(true);
        expect(samples[`${name}-focus`].outline).toBe("2px");
        const soft =
          theme === "dark" ? "rgb(34, 55, 42)" : "rgb(229, 221, 207)";
        expect(samples[`${name}-hover`].background).toBe(soft);
        expect(samples[`${name}-press`].background).toBe(soft);
        expect(samples[`${name}-press`].shadow).toContain("inset");
      }
      const evidence = {
        started,
        ended: new Date().toISOString(),
        browser: browser.version(),
        environment: await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          viewport: { width: innerWidth, height: innerHeight },
          raster: devicePixelRatio,
          motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
          scroll: { x: scrollX, y: scrollY },
          origin: location.origin,
          assets: performance
            .getEntriesByType("resource")
            .map((resource) => resource.name)
            .filter((name) => /\.(css|js|woff2)(\?|$)/.test(name)),
        })),
        samples,
        errors,
      };
      await writeFile(
        info.outputPath("quiet-action-geometry.json"),
        JSON.stringify(evidence, null, 2),
      );
      expect(errors).toEqual([]);
      // Keep all state captures before the independent numeric assertion so
      // an old-source failure retains the complete competing-control evidence.
      for (const sample of Object.values(samples)) {
        expect(sample.box.height).toBeGreaterThanOrEqual(44);
        expect(sample.radius).toBe("8px");
        expect(Math.abs(sample.labelCentreError)).toBeLessThanOrEqual(1);
      }
    });
  }
}
