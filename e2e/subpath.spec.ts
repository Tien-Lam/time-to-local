import { test, expect } from "@playwright/test";
import { choose, enterZone } from "./choices";
for (const design of ["command", "aqua"] as const)
  test(`${design} subpath scope, manifest and worker survive offline restart`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto("/ChronoShift/");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://timetolocal.com/",
    );
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
    const manifest = await (
      await page.request.get("/ChronoShift/manifest.webmanifest")
    ).json();
    expect(manifest.start_url).toBe("/ChronoShift/");
    expect(manifest.scope).toBe("/ChronoShift/");
    expect(manifest.share_target.action).toBe("/ChronoShift/share");
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())!.scope,
      ),
    ).toBe(`${baseURL}/ChronoShift/`);
    await page.getByLabel("Appearance", { exact: true }).click();
    await choose(page, "Design", design);
    await choose(page, "Theme", "light");
    await page.getByLabel("Appearance", { exact: true }).click();
    await page.close();
    await context.setOffline(true);
    const reopened = await context.newPage();
    await reopened.goto("/ChronoShift/#about");
    await expect(reopened.locator("html")).toHaveAttribute(
      "data-design",
      design,
    );
    await expect(reopened.locator("html")).toHaveAttribute(
      "data-theme",
      "light",
    );
    await expect(reopened).toHaveTitle("About — Time to Local");
    await expect(
      reopened.getByRole("link", { name: "View on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/Tien-Lam/time-to-local");
    await reopened.getByRole("link", { name: "Back to converter" }).click();
    await enterZone(reopened, "UTC");
    await reopened
      .getByLabel("Message with a date or time")
      .fill("April 9, 2026 3pm in Tokyo");
    await expect(reopened.locator(".hero-time")).toHaveText(/6:00 am/i);
    await reopened.evaluate(() => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/ChronoShift/share";
      form.enctype = "multipart/form-data";
      const input = document.createElement("input");
      input.name = "text";
      input.value = "July 15, 2026 3pm CST";
      form.append(input);
      document.body.append(form);
      form.requestSubmit();
    });
    await expect(
      reopened.getByLabel("Message with a date or time"),
    ).toHaveValue("July 15, 2026 3pm CST");
    expect(reopened.url()).toBe(`${baseURL}/ChronoShift/`);
  });
