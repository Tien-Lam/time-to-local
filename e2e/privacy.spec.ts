import { test, expect, publishRelease } from "./fixtures";
import { enterZone } from "./choices";
const releaseTest = test.extend({ isolatedOrigin: true });

for (const legacyDesign of ["lens", "command"])
  test(`legacy ${legacyDesign} preferences migrate, reset removes them and quota failures keep conversion usable`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
    await page.evaluate(
      (design) =>
        localStorage.setItem(
          "chronoshift.preferences.v1",
          JSON.stringify({
            target: "Asia/Tokyo",
            source: "UTC",
            hourCycle: "24",
            dateOrder: "dmy",
            design,
            text: "DROP-LEGACY-TEXT",
          }),
        ),
      legacyDesign,
    );
    await page.reload();
    await expect(page.getByLabel("Convert to")).toHaveValue("Tokyo");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-design",
      "command",
    );
    await page.getByLabel("Appearance", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Original Design", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Appearance", { exact: true }).click();
    await expect(page.getByLabel("Message with a date or time")).toHaveValue(
      "",
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("chronoshift.preferences.v1")!),
        ),
      )
      .toEqual({
        target: "Asia/Tokyo",
        source: "UTC",
        hourCycle: "24",
        dateOrder: "dmy",
        theme: "dark",
      });
    await page.getByRole("button", { name: /More options/ }).click();
    await page.getByRole("button", { name: "Reset preferences" }).click();
    await expect(page.getByLabel("Convert to")).toHaveValue("");
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("chronoshift.preferences.v1")),
      )
      .toBeNull();
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Quota full", "QuotaExceededError");
      };
    });
    await page.reload();
    await enterZone(page, "Asia/Tokyo");
    await expect(
      page.getByText("Preferences cannot be saved", { exact: false }),
    ).toBeVisible();
    await page
      .getByLabel("Message with a date or time")
      .fill("April 9, 2026 3pm UTC");
    await expect(page.locator(".hero-time")).toHaveText(/12:00 am/i);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("chronoshift.preferences.v1"),
      ),
    ).toBeNull();
    await page.reload();
    await expect(page.getByLabel("Convert to")).toHaveValue("");
    await page
      .getByLabel("Message with a date or time")
      .fill("April 9, 2026 3pm UTC");
    await expect(page.locator(".hero-time")).toHaveText(/1:00 am/i);
  });

test("invalid and oversized local shares return a paste fallback without storing text", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
  const responses = await page.evaluate(async () => {
    const requests = [
      new URLSearchParams({ text: "" }),
      new URLSearchParams({ text: "x".repeat(10001) }),
      new URLSearchParams({ text: "x".repeat(70000) }),
      "invalid form body",
    ];
    const results = [];
    for (const body of requests) {
      const response = await fetch("share", { method: "POST", body });
      results.push({ status: response.status, text: await response.text() });
    }
    return results;
  });
  expect(responses.map((response) => response.status)).toEqual([
    400, 400, 413, 400,
  ]);
  expect(
    responses.every((response) => /paste|shorter/i.test(response.text)),
  ).toBe(true);
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/1:00 am/i);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain("April");
});

test("expired and invalid temporary text is consumed and erased without restoring it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
  for (const invalid of ["expired", "future", "oversized", "malformed"]) {
    await page.evaluate((invalid) => {
      const entry = {
        text:
          invalid === "oversized"
            ? "x".repeat(10001)
            : "Private expired April 9, 2026 3pm UTC",
        created:
          Date.now() +
          (invalid === "future"
            ? 60000
            : invalid === "oversized"
              ? 0
              : -300001),
      };
      sessionStorage.setItem(
        "chronoshift.update-draft",
        invalid === "malformed" ? "{" : JSON.stringify(entry),
      );
    }, invalid);
    await page.reload();
    await expect(page.getByLabel("Message with a date or time")).toHaveValue(
      "",
    );
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("chronoshift.update-draft")),
      )
      .toBeNull();
    await page.evaluate(async (invalid) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("chronoshift-handoff", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("messages");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("messages", "readwrite");
          const created =
            Date.now() +
            (invalid === "future"
              ? 60000
              : invalid === "oversized"
                ? 0
                : -300001);
          tx.objectStore("messages").put(
            {
              text:
                invalid === "oversized"
                  ? "x".repeat(10001)
                  : "Private expired April 9, 2026 3pm UTC",
              created: invalid === "malformed" ? "today" : created,
            },
            "invalid-share",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    }, invalid);
    await page.goto("/?share=invalid-share");
    await expect(
      page.getByText("The shared text expired.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel("Message with a date or time")).toHaveValue(
      "",
    );
    expect(page.url()).not.toContain("?");
    expect(
      await page.evaluate(
        async () =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open("chronoshift-handoff", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result,
                tx = db.transaction("messages", "readonly");
              const count = tx.objectStore("messages").count();
              tx.oncomplete = () => {
                db.close();
                resolve(count.result);
              };
              tx.onerror = () => {
                db.close();
                reject(tx.error);
              };
            };
          }),
      ),
    ).toBe(0);
  }
});

releaseTest(
  "denied update storage keeps the draft active and requires clearing before reload",
  async ({ page, context }) => {
    const leaks: string[] = [];
    page.on("console", (message) => leaks.push(message.text()));
    page.on("request", (request) =>
      leaks.push(request.url() + (request.postData() || "")),
    );
    await page.addInitScript(() =>
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new Error("Storage denied");
        },
      }),
    );
    await page.goto("/");
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
    const draft = "PRIVATE-UPDATE-TEST April 9, 2026 3pm UTC";
    await page.getByLabel("Message with a date or time").fill(draft);
    // This case exercises the storage guard on a completed conversion. Result
    // completion can move the update button between pointer down and up.
    await expect(page.locator(".hero-time")).toHaveText(/1:00 am/i);
    await publishRelease(context, page.url(), "second");
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update();
    });
    await expect(
      page.getByRole("button", { name: "Update now" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Update now" }).click();
    await expect(
      page.getByText("This browser cannot preserve it", { exact: false }),
    ).toBeVisible();
    await expect(page.getByLabel("Message with a date or time")).toHaveValue(
      draft,
    );
    await expect(
      page.getByRole("button", { name: "Update now" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage })),
    ).not.toContain(draft);
    expect(leaks.join("\n")).not.toContain("PRIVATE-UPDATE-TEST");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await Promise.all([
      page.waitForEvent("domcontentloaded"),
      page.getByRole("button", { name: "Update now" }).click(),
    ]);
    await expect(page.getByLabel("Message with a date or time")).toHaveValue(
      "",
    );
    await expect(page.locator('main[data-offline-ready="true"]')).toBeVisible();
  },
);
