import { expect, test } from "@playwright/test";

function expectStartupErrors(
  pageErrors: string[],
  consoleErrors: string[],
  browserName: string,
) {
  // Linux WebKit reports this existing, optional Chrome keyboard-resize hint
  // as an error. Permit only that exact browser notice; retain and reject all
  // CSP, hydration and application errors rather than filtering the records.
  const viewportNotice =
    'Viewport argument key "interactive-widget" not recognized and ignored.';
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual(
    browserName === "webkit" && consoleErrors.includes(viewportNotice)
      ? [viewportNotice]
      : [],
  );
}

test("the first interface paints before JavaScript and survives hydration", async ({
  page,
  browserName,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/assets/index-*.js", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    const main = page.locator("main");
    await expect(main).toHaveAttribute("data-app-ready", "false");
    await expect(page.locator(".converter-intro")).toBeVisible();
    await expect(page.locator(".converter-guide")).toBeVisible();
    await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
    await expect(page.locator(".appearance")).toHaveAttribute("inert", "");
    await expect(page.locator("#target-zone")).toHaveAttribute(
      "placeholder",
      "Your timezone",
    );
    const intro = await page.locator(".converter-intro").elementHandle();
    const textarea = page.locator("textarea#message");
    const bounds = await textarea.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + 20, bounds!.y + 20);
    await page.keyboard.type("April 9, 2026 3pm in Tokyo");
    await expect(textarea).toHaveValue("");
    // Let the static CSS entrance finish while JavaScript is still held.
    // Hydration must retain these painted panels without starting another fade.
    await page.evaluate(async () => {
      await Promise.all(
        [...document.querySelectorAll(".input-panel,.result-panel")].flatMap(
          (node) => node.getAnimations().map((animation) => animation.finished),
        ),
      );
    });
    release();
    await expect(main).toHaveAttribute("data-app-ready", "true");
    expectStartupErrors(pageErrors, consoleErrors, browserName);
    expect(
      await intro!.evaluate(
        (node) => node === document.querySelector(".converter-intro"),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll(".input-panel,.result-panel")].map(
          (node) => ({
            opacity: getComputedStyle(node).opacity,
            running: node
              .getAnimations()
              .filter((animation) => animation.playState === "running").length,
          }),
        ),
      ),
    ).toEqual([
      { opacity: "1", running: 0 },
      { opacity: "1", running: 0 },
    ]);
    await expect(page.locator(".workspace")).not.toHaveAttribute("inert");
    await textarea.fill("April 9, 2026 3pm in Tokyo");
    // Sydney is UTC+10 on this explicit date; Tokyo is UTC+9.
    await expect(page.locator(".hero-time")).toHaveText(/4:00 pm/i);
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
    expectStartupErrors(pageErrors, consoleErrors, browserName);
  } finally {
    release();
  }
});

test("hydration restores preferences and an initial About route", async ({
  page,
  browserName,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const preferences = {
    target: "UTC",
    source: "Asia/Tokyo",
    hourCycle: "24",
    dateOrder: "dmy",
    theme: "light",
  };
  await page.addInitScript((value) => {
    localStorage.setItem("chronoshift.preferences.v1", JSON.stringify(value));
  }, preferences);
  await page.goto("/#about");
  await expect(page).toHaveTitle("About — Time to Local");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Back to converter" }).click();
  await expect(page.getByLabel("Convert to", { exact: true })).toHaveValue(
    "UTC",
  );
  await page.getByRole("button", { name: /Message interpretation/ }).click();
  await expect(page.getByLabel("Source timezone", { exact: true })).toHaveValue(
    "Tokyo",
  );
  await page.getByLabel("Message with a date or time").fill("9/4/2026 15:00");
  await expect(page.locator(".hero-time")).toHaveText("06:00");
  await expect(page.locator(".result-date")).toContainText("9 Apr 2026");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("chronoshift.preferences.v1")!),
    ),
  ).toEqual(preferences);
  expectStartupErrors(pageErrors, consoleErrors, browserName);
});

test("the static shell permits its fixed hidden styles and rejects other attributes", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/assets/index-*.js", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("main")).toHaveAttribute(
      "data-app-ready",
      "false",
    );
    // Expose the native Appearance details only for this parser/CSP check.
    // Its editing remains inert; collapsed ancestors have no meaningful box.
    const hidden = page
      .locator('.appearance [data-testid="hidden-select-container"]')
      .first();
    await hidden.evaluate((node) => {
      node.closest("details")!.open = true;
    });
    await expect(hidden).toHaveCSS("width", "1px");
    await expect(hidden).toHaveCSS("height", "1px");
    await expect(hidden).toHaveCSS("position", "fixed");
    expect(
      await page
        .locator('[data-testid="hidden-select-container"]')
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("style")),
        ),
    ).toEqual([
      await hidden.getAttribute("style"),
      await hidden.getAttribute("style"),
      await hidden.getAttribute("style"),
    ]);
    await expect(page.locator(".result-shortcut")).toHaveCSS(
      "visibility",
      "hidden",
    );
  } finally {
    // Restore the build-owned DOM before hydration, even if a style check fails.
    await page
      .locator(".appearance")
      .evaluate((node) => {
        (node as HTMLDetailsElement).open = false;
      })
      .finally(release);
  }
  await expect(page.locator("main")).toHaveAttribute("data-app-ready", "true");
  const rejected = await page.evaluate(
    () =>
      new Promise<{ directive: string; applied: boolean }>((resolve) => {
        const probe = document.createElement("div");
        probe.textContent = "CSP test";
        document.body.append(probe);
        const blocked = (event: SecurityPolicyViolationEvent) => {
          if (event.effectiveDirective !== "style-src-attr") return;
          document.removeEventListener("securitypolicyviolation", blocked);
          resolve({
            directive: event.effectiveDirective,
            applied: getComputedStyle(probe).outlineWidth === "99px",
          });
          probe.remove();
        };
        document.addEventListener("securitypolicyviolation", blocked);
        probe.setAttribute("style", "outline:99px solid magenta");
      }),
  );
  expect(rejected).toEqual({ directive: "style-src-attr", applied: false });
});
