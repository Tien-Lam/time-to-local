import { test, expect } from "./fixtures";
import { enterZone } from "./choices";

test("live feedback covers debounce and worker completion, then settles or cancels", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = Worker;
    window.Worker = new Proxy(Native, {
      construct(Target, args) {
        const worker = Reflect.construct(Target, args);
        return new Proxy(worker, {
          get(target, property) {
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
          set(target, property, value) {
            if (property === "onmessage")
              target.onmessage = (event: MessageEvent) =>
                setTimeout(() => value(event), 600);
            else Reflect.set(target, property, value, target);
            return true;
          },
        });
      },
    });
  });
  await page.goto("/");
  await enterZone(page, "UTC");
  const input = page.getByLabel("Message with a date or time");
  const indicator = page.locator(".live-indicator");
  const panel = page.locator(".result-panel");
  await expect(indicator).toHaveAttribute("data-state", "idle");
  await input.fill("June 18, 2026 at 5:20pm in Tokyo");
  await expect(indicator).toHaveAttribute("data-state", "pending");
  await expect(indicator).toContainText("Updating");
  await expect(panel).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".result")).toHaveCount(0);
  await expect(page.locator(".hero-time")).toHaveText(/8:20 am/i);
  await expect(indicator).toHaveAttribute("data-state", "ready");
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await input.fill("June 18, 2026 at 6:20pm in Tokyo");
  await expect(indicator).toHaveAttribute("data-state", "pending");
  await expect(page.getByRole("button", { name: /^Copy / })).toHaveCount(0);
  await input.fill("");
  await expect(indicator).toHaveAttribute("data-state", "idle");
  // Let any delayed old completion arrive: clear must remain the settled state.
  await page.waitForTimeout(1000);
  await expect(indicator).toHaveAttribute("data-state", "idle");
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".result")).toHaveCount(0);
  await input.fill("No timestamp here");
  await expect(page.getByRole("alert")).toContainText("No time found");
  await expect(indicator).toHaveAttribute("data-state", "error");
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await input.fill("June 18, 2026 at 6:20pm in Tokyo");
  await expect(page.locator(".hero-time")).toHaveText(/9:20 am/i);
  await expect(indicator).toHaveAttribute("data-state", "ready");
});

test("reduced motion keeps live feedback and usable results without animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await enterZone(page, "UTC");
  await page
    .getByLabel("Message with a date or time")
    .fill("June 18, 2026 at 5:20pm in Tokyo");
  await expect(page.locator(".hero-time")).toHaveText(/8:20 am/i);
  await expect(page.locator(".live-indicator")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await page.getByLabel("Appearance", { exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
  const styles = await page.locator(".result-group").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animation: style.animationName,
      transition: style.transitionDuration,
    };
  });
  expect(styles.animation).toBe("none");
  expect(styles.transition).toBe("0s");
  await page.getByLabel("Appearance", { exact: true }).click();
  await page.getByRole("button", { name: /^Copy / }).click();
  await expect(page.locator(".notice")).toBeVisible();
});
