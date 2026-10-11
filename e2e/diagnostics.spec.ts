import { test, expect, publishRelease } from "./fixtures";
import { enterZone } from "./choices";
import type { Page } from "@playwright/test";

import { consoleDiagnostics } from "./console";

async function toggle(page: Page) {
  await page
    .getByRole("button", { name: "Support diagnostics", exact: true })
    .click();
  return page.getByRole("checkbox", { name: "Enable detailed logs" });
}

test("detailed logs are opt-in, local, exclude message and selected zones, and stop when disabled", async ({
  page,
}) => {
  const logs = consoleDiagnostics(page);
  const requests: string[] = [];
  page.on("request", (request) =>
    requests.push(request.url() + (request.postData() || "")),
  );
  await page.goto("/");
  await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
  const checkbox = await toggle(page);
  await expect(checkbox).not.toBeChecked();
  const draft = "PrivatePlanningSentinel July 4, 2027 at 3pm UTC";
  await page.getByLabel("Message with a date or time").fill(draft);
  await enterZone(page, "Pacific/Chatham");
  await expect(page.locator(".hero-time")).toBeVisible();
  await logs.flush();
  expect([...logs]).toEqual([]);
  await checkbox.check();
  await expect
    .poll(async () => {
      await logs.flush();
      return logs.join("\n");
    })
    .toContain("offline.probe-result");
  await page.getByRole("combobox", { name: "Convert to", exact: true }).click();
  await page.getByLabel("Message with a date or time").fill(draft + " ");
  await expect
    .poll(async () => {
      await logs.flush();
      return logs.join("\n");
    })
    .toContain("conversion.complete");
  expect(logs.join("\n")).toContain("ui.zone-focus");
  await logs.flush();
  const raw = logs.join("\n");
  for (const privateValue of [
    "PrivatePlanningSentinel",
    "2027",
    "Chatham",
    "July 4",
    draft,
  ]) {
    expect(raw).not.toContain(privateValue);
    expect(requests.join("\n")).not.toContain(privateValue);
  }
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("chronoshift-detailed-logs"),
    ),
  ).toBe("true");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("PrivatePlanningSentinel");
  await checkbox.uncheck();
  await logs.flush();
  const stopped = logs.length;
  await page.getByRole("combobox", { name: "Convert to", exact: true }).click();
  await page.getByLabel("Message with a date or time").fill(draft + "  ");
  await expect(page.locator(".hero-time")).toBeVisible();
  await page.waitForTimeout(100);
  await logs.flush();
  expect(logs).toHaveLength(stopped);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("chronoshift-detailed-logs"),
    ),
  ).toBeNull();
});

test("detailed logging survives a tab reload and reset preferences disables it", async ({
  page,
}) => {
  const logs = consoleDiagnostics(page);
  await page.goto("/");
  await (await toggle(page)).check();
  await page.reload();
  const checkbox = await toggle(page);
  await expect(checkbox).toBeChecked();
  await expect
    .poll(async () => {
      await logs.flush();
      return logs.join("\n");
    })
    .toContain("offline.register-attempt");
  await page.getByRole("button", { name: "Reset preferences" }).click();
  await expect(checkbox).not.toBeChecked();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("chronoshift-detailed-logs"),
    ),
  ).toBeNull();
  await logs.flush();
  const stopped = logs.length;
  await page.reload();
  await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
  await logs.flush();
  expect(logs).toHaveLength(stopped);
});

test("detailed logs still work in memory when session storage is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
  });
  const logs = consoleDiagnostics(page);
  await page.goto("/");
  await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
  const checkbox = await toggle(page);
  await checkbox.check();
  await expect
    .poll(async () => {
      await logs.flush();
      return logs.join("\n");
    })
    .toContain("offline.probe-result");
  await checkbox.uncheck();
  await logs.flush();
  const stopped = logs.length;
  await page.getByRole("combobox", { name: "Convert to", exact: true }).click();
  await page.waitForTimeout(100);
  await logs.flush();
  expect(logs).toHaveLength(stopped);
});

const cacheTest = test.extend({ isolatedOrigin: true });
cacheTest(
  "a retired release repairs only missing files using its intact cached assets",
  async ({ page, context, baseURL }) => {
    await publishRelease(context, baseURL!, "first");
    await page.goto("/");
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
    await publishRelease(context, baseURL!, "second-retired");
    const result = await page.evaluate(async () => {
      const cache = await caches.open("chronoshift-test-first");
      await cache.delete("/fonts/README.txt");
      await cache.delete("/index.html");
      return new Promise<any>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          channel.port1.close();
          resolve(event.data);
        };
        navigator.serviceWorker.controller!.postMessage(
          { type: "CHECK_READY", repairIfMissing: true, detailedLogs: true },
          [channel.port2],
        );
      });
    });
    expect(result.ready).toBe(true);
    expect(result.diagnostics.unavailable).toEqual([
      "/fonts/README.txt",
      "/index.html",
    ]);
    expect(result.diagnostics.repair.fetched).toBe(1);
    expect(result.diagnostics.repair.reused).toBeGreaterThan(1);
    // Check production-like retirement really exists rather than silently retaining every fixture.
    const oldCSS = await page.evaluate(
      async () =>
        (await (await caches.open("chronoshift-test-first")).keys()).find((r) =>
          r.url.endsWith(".css"),
        )!.url,
    );
    expect((await context.request.get(oldCSS)).status()).toBe(404);
    await page
      .getByLabel("Message with a date or time")
      .fill("July 4, 2027 3pm UTC");
    await expect(page.locator(".hero-time")).toBeVisible();
    await expect(page.locator(".message.warning")).toHaveCount(0);
  },
);

cacheTest(
  "corrupt cached files fail integrity checks and detailed logs identify bounded repair failure",
  async ({ page, context, baseURL }) => {
    const logs = consoleDiagnostics(page);
    await publishRelease(context, baseURL!, "first");
    await page.goto("/");
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
    await publishRelease(context, baseURL!, "second");
    await page.evaluate(async () =>
      (await caches.open("chronoshift-test-first")).put(
        "/release.json",
        new Response("corrupt private data"),
      ),
    );
    await (await toggle(page)).check();
    await expect(page.locator(".message.warning")).toContainText(
      "Offline setup is incomplete.",
    );
    await expect
      .poll(async () => {
        await logs.flush();
        return logs.join("\n");
      })
      .toContain("release-mismatch");
    expect(logs.join("\n")).toContain("/release.json");
    expect(logs.join("\n")).not.toContain("corrupt private data");
    expect(
      await page.evaluate(async () =>
        (await (
          await caches.open("chronoshift-test-first")
        ).match("/index.html"))!.text(),
      ),
    ).toContain("test-first-");
    expect(
      await page.evaluate(async () =>
        (await caches.keys()).filter((key) => key.includes("staging")),
      ),
    ).toEqual([]);
  },
);

cacheTest(
  "waiting updates remain actionable when a current cache probe times out",
  async ({ page, context, baseURL }) => {
    await page.addInitScript(() => {
      const native = window.setTimeout;
      window.setTimeout = ((
        handler: TimerHandler,
        delay?: number,
        ...args: any[]
      ) =>
        native(
          handler,
          delay === 15000 ? 200 : delay,
          ...args,
        )) as typeof setTimeout;
    });
    await publishRelease(context, baseURL!, "first");
    await page.goto("/");
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
    const draft = "Preserved July 4, 2027 3pm UTC";
    await page.getByLabel("Message with a date or time").fill(draft);
    await publishRelease(context, baseURL!, "second");
    await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistration())!.update(),
    );
    await expect(
      page.getByRole("button", { name: "Update now" }),
    ).toBeVisible();
    await publishRelease(context, baseURL!, "second-stalled");
    await page.evaluate(async () => {
      await (
        await caches.open("chronoshift-test-first")
      ).delete("/release.json");
      window.dispatchEvent(new PageTransitionEvent("pageshow"));
    });
    await page
      .getByRole("combobox", { name: "Convert to", exact: true })
      .click();
    await expect(page.locator(".message.warning")).toContainText(
      "Offline assets could not be confirmed.",
    );
    await expect(
      page.getByRole("button", { name: "Update now" }),
    ).toBeVisible();
    await Promise.all([
      page.waitForEvent("domcontentloaded"),
      page.getByRole("button", { name: "Update now" }).click(),
    ]);
    await expect(page.getByLabel("Message with a date or time")).toHaveValue(
      draft,
    );
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
    await expect(page.locator(".message.warning")).toHaveCount(0);
  },
);
