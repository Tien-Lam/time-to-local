import { test, expect } from "./fixtures";

// Simulate an enlarged default text size independently of viewport/browser
// zoom, and exercise the system fallback when the bundled font is unavailable.
for (const rootSize of [24, 32])
  for (const fallback of [false, true])
    test(`${rootSize}px default text preserves complete clocks and usable controls${fallback ? " with the fallback font" : ""}`, async ({
      page,
    }, info) => {
      if (fallback) await page.route("**/*.woff2", (route) => route.abort());
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async () => {} },
        });
        localStorage.setItem(
          "chronoshift.preferences.v1",
          JSON.stringify({ target: "UTC", hourCycle: "12", theme: "light" }),
        );
      });
      await page.goto("/");
      // Loading can finish before asynchronous module hydration. Exercise
      // the interactive form; inert startup input does not accept filling.
      await expect(page.locator("main")).toHaveAttribute(
        "data-app-ready",
        "true",
      );
      // Browser default-font simulation, not physical-device or real page zoom.
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}px`;
      }, rootSize);
      const message = "2026-04-09T23:59:59.123+00:00";
      await page.getByLabel("Message with a date or time").fill(message);
      await expect(page.locator(".hero-time")).toHaveText("11:59:59.123 pm");
      for (const width of [280, 390, 820, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(
          page.getByLabel("Message with a date or time"),
        ).toHaveValue(message);
        const geometry = await page.locator(".result").evaluate((result) => {
          const number = result.querySelector(".time-number")!;
          const output = result.querySelector(".result-output")!;
          const text = number.firstChild!;
          const tops = [...text.textContent!].map((_, i) => {
            const range = document.createRange();
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            return range.getBoundingClientRect().top;
          });
          return {
            numberRight: number.getBoundingClientRect().right,
            outputRight: output.getBoundingClientRect().right,
            tops,
            pageWidth: document.documentElement.scrollWidth,
          };
        });
        expect(geometry.numberRight).toBeLessThanOrEqual(
          geometry.outputRight + 0.5,
        );
        expect(
          Math.max(...geometry.tops) - Math.min(...geometry.tops),
        ).toBeLessThan(2);
        expect(geometry.pageWidth).toBeLessThanOrEqual(width);
        const copy = page.getByRole("button", { name: /^Copy / });
        await copy.scrollIntoViewIfNeeded();
        // Compare document coordinates: keyboard/pointer activation can scroll
        // a short viewport without moving the target within the document.
        const copyBounds = () =>
          copy.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x + scrollX,
              y: rect.y + scrollY,
              width: rect.width,
              height: rect.height,
            };
          });
        const before = await copyBounds();
        await copy.click();
        await expect(copy).toHaveText(/Copied/);
        expect(await copyBounds()).toEqual(before);
        await page.getByRole("button", { name: /More options/ }).click();
        const heading = await page.locator("#input-title").evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getClientRects().length;
        });
        expect(heading).toBe(1);
        const field = page.getByLabel("Source timezone", { exact: true });
        await field.fill("Asia/Tokyo");
        await field.press("Tab");
        await expect(field).toHaveValue("Tokyo");
        await page
          .getByRole("button", { name: "Choose reference date" })
          .click();
        await expect(page.getByRole("dialog")).toBeVisible();
        const days = await page.locator(".calendar-day").evaluateAll((cells) =>
          cells
            .filter((cell) => getComputedStyle(cell).visibility !== "hidden")
            .map((cell) => {
              const range = document.createRange();
              range.selectNodeContents(cell);
              return {
                text: range.getBoundingClientRect().width,
                cell: cell.getBoundingClientRect().width,
              };
            }),
        );
        for (const day of days)
          expect(day.text).toBeLessThanOrEqual(day.cell - 2);
        await page.screenshot({
          path: info.outputPath(
            `enlarged-${width}-${fallback ? "fallback" : "geist"}.png`,
          ),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: /More options/ }).click();
      }
    });
