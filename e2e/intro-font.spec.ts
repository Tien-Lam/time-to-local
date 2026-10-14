import { test, expect } from "./fixtures";
import type { Route } from "@playwright/test";
test.use({ serviceWorkers: "block" });
test("intro holds the editor position while its body font finishes downloading", async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName === "webkit",
    "The held-font control reports a failed font face on local WebKit; its existing entrance-motion checks remain active.",
  );
  const pending: Route[] = [];
  let releaseFont!: () => void;
  const fontGate = new Promise<void>((resolve) => (releaseFont = resolve));
  await page.route("**/*.woff2", async (route) => {
    pending.push(route);
    await fontGate;
    await route.continue();
  });
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const input = page.getByLabel("Message with a date or time");
  await input.fill("April 9, 2026 3pm UTC");
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  const measure = () =>
    page.locator(".converter-intro").evaluate((e) => {
      const range = document.createRange();
      range.selectNodeContents(e);
      return {
        font: getComputedStyle(e).fontFamily,
        fontLoaded: document.fonts.check("15px Geist"),
        fontStatus: [...document.fonts]
          .filter((face) => face.family.includes("Geist"))
          .map((face) => face.status),
        lines: new Set([...range.getClientRects()].map((r) => r.top)).size,
        height: e.getBoundingClientRect().height,
        editorY: document.querySelector("#message")!.getBoundingClientRect()
          .top,
      };
    });
  // Model Linux, where the default stack falls through to sans-serif/Arial.
  // macOS's native fallback has different metrics and does not reproduce the wrap.
  await page.evaluate(() => {
    document.documentElement.style.fontFamily = "Geist, Arial, sans-serif";
  });
  const before = await measure();
  releaseFont();
  await page.evaluate(() => document.fonts.ready);
  const after = await measure();
  await info.attach("font-transition", {
    body: JSON.stringify({ before, after }),
    contentType: "application/json",
  });
  expect(before.fontStatus).toContain("loading");
  expect(after.fontStatus).toContain("loaded");
  expect(Math.abs(after.editorY - before.editorY)).toBeLessThanOrEqual(1);
  await expect(input).toHaveValue("April 9, 2026 3pm UTC");
});
