import { test, expect } from "./fixtures";
import { choiceTrigger, enterZone } from "./choices";
import {
  beginMotionProbe,
  captureMotionCheckpoint,
  expectStationary,
  finishMotionProbe,
  installMotionProbe,
} from "./motion-probe";
import type { Page } from "@playwright/test";

const disclosure = (page: Page) =>
  page.getByRole("button", { name: /More options/ });

async function holdConversion(page: Page) {
  await page.addInitScript(() => {
    const state = window as any;
    state.completions = [];
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
                state.completions.push(() => value(event));
            else Reflect.set(target, property, value, target);
            return true;
          },
        });
      },
    });
  });
}

async function deliverConversion(page: Page, index: number) {
  await expect
    .poll(() => page.evaluate(() => (window as any).completions.length))
    .toBeGreaterThan(index);
  await page.evaluate((index) => (window as any).completions[index](), index);
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme} entrance permits immediate typing with stationary editing and theme targets`, async ({
    page,
  }, info) => {
    await page.addInitScript((theme) => {
      localStorage.setItem(
        "chronoshift.preferences.v1",
        JSON.stringify({
          theme,
          target: "UTC",
          source: "",
          dateOrder: "mdy",
          hourCycle: "12",
        }),
      );
    }, theme);
    const anchors = ["#message", "#target-zone", ".appearance summary"];
    await installMotionProbe(page, [
      ...anchors,
      ".input-panel",
      ".result-panel",
    ]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const input = page.getByLabel("Message with a date or time");
    // No settling wait: focus and typing happen during the finite entrance.
    await input.fill("April 9, 2026 3pm UTC");
    await input.press("End");
    await input.press("!");
    await expect(input).toHaveValue("April 9, 2026 3pm UTC!");
    await expect(input).toBeFocused();
    await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
    const record = await finishMotionProbe(page, info, "entrance-frames");
    expectStationary(record, anchors);
    const entrance = record.events.filter(
      (event) =>
        event.type === "animationstart" &&
        /input-panel|result-panel/.test(event.target),
    );
    expect(entrance.length).toBe(2);
    const completed = record.events.filter(
      (event) =>
        /^(?:animationend|animationcancel)$/.test(event.type) &&
        /input-panel|result-panel/.test(event.target),
    );
    expect(completed.length).toBe(2);
    for (const start of entrance)
      expect(
        completed.filter((event) => event.target === start.target),
      ).toHaveLength(1);
    for (const event of completed) {
      // The CSS elapsed clock measures effect lifetime; event callback time
      // includes main-thread delivery delay. Preserve both raw clocks.
      expect(event.elapsedTimeSeconds).toBeLessThanOrEqual(0.36);
      expect(event.time).toBeGreaterThanOrEqual(
        entrance.find((start) => start.target === event.target)!.time,
      );
    }
    const panelAnimations = record.events
      .filter((event) => /^(?:input-panel|result-panel)$/.test(event.target))
      .flatMap((event) => event.animations) as typeof record.initialAnimations;
    expect(panelAnimations.length).toBeGreaterThan(0);
    for (const animation of panelAnimations) {
      expect(animation.durationMilliseconds).toBe(320);
      expect([0, 40]).toContain(animation.delayMilliseconds);
      expect(animation.iterations).toBe(1);
      expect(animation.endTimeMilliseconds).toBeLessThanOrEqual(360);
      expect(animation.currentTimeMilliseconds).toBeLessThanOrEqual(360);
    }
    const finalPanels = await page.evaluate(() =>
      [...document.querySelectorAll(".input-panel,.result-panel")].map(
        (element) => ({
          opacity: Number(getComputedStyle(element).opacity),
          running: element
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
        }),
      ),
    );
    expect(finalPanels).toHaveLength(2);
    for (const panel of finalPanels) {
      expect(panel.opacity).toBe(1);
      expect(panel.running).toBe(0);
    }
    // Resize/theme must not replay this once-per-load presentation.
    await beginMotionProbe(page, anchors);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(input).toHaveValue("April 9, 2026 3pm UTC!");
    const resized = await finishMotionProbe(page, info, "resize-events");
    expect(
      resized.events.filter(
        (event) =>
          event.type === "animationstart" &&
          /input-panel|result-panel/.test(event.target),
      ),
    ).toEqual([]);
  });
}

test("disclosure reversals remove collapsed fields from keyboard navigation immediately", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await page.goto("/");
  const toggle = disclosure(page);
  await toggle.focus();
  await beginMotionProbe(page, [
    ".options",
    ".option-fields",
    ".options button",
  ]);
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("Source timezone", { exact: true }).fill("UTC");
  await page.getByLabel("Source timezone", { exact: true }).press("Escape");
  // Reverse using keyboard immediately, while content may still be revealing.
  await toggle.focus();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".option-fields")).toHaveAttribute("inert", "");
  await toggle.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest(".option-fields"),
    ),
  ).toBe(false);
  await toggle.focus();
  await toggle.press("Enter");
  await toggle.press("Enter");
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".option-fields")).not.toHaveAttribute("inert", "");
  await page.getByLabel("Source timezone", { exact: true }).focus();
  await expect(
    page.getByLabel("Source timezone", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Source timezone", { exact: true })).toHaveValue(
    "UTC",
  );
  // The correction action owns focus even when the disclosure is already open.
  await page.getByRole("button", { name: "Change message defaults" }).click();
  await expect(
    page.getByLabel("Source timezone", { exact: true }),
  ).toBeFocused();
  await toggle.focus();
  await toggle.press("Enter");
  await page.getByRole("button", { name: "Change message defaults" }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByLabel("Source timezone", { exact: true }),
  ).toBeFocused();
  const record = await finishMotionProbe(
    page,
    info,
    "disclosure-reversal-frames",
  );
  expect(
    record.events.some(
      (event) =>
        event.type === "transitionrun" &&
        /chevron|option-fields/.test(event.target),
    ),
  ).toBe(true);
});

test("normal motion keeps zone anchors and outer overlays stationary through immediate Escape and reopen", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await page.goto("/");
  await enterZone(page, "UTC");
  const target = page.getByLabel("Convert to", { exact: true });
  const toggle = page.getByRole("button", {
    name: "Show target timezones",
    exact: true,
  });
  await toggle.scrollIntoViewIfNeeded();
  // Setup's typed shortlist has its own retained exit. Let that prior popup
  // unmount before observing the new, full menu's immediate open/reversal.
  await expect(page.locator(".choice-popover")).toHaveCount(0);
  await beginMotionProbe(page, [
    "#target-zone",
    ".choice-toggle",
    ".choice-popover",
  ]);
  await toggle.click();
  await expect(target).toHaveAttribute("aria-controls", /.+/);
  const ownedList = page.locator(
    `[id="${await target.getAttribute("aria-controls")}"]`,
  );
  await expect(ownedList).toBeVisible();
  await captureMotionCheckpoint(page, "zone-open-before-immediate-Escape");
  await page.keyboard.press("Escape");
  await expect(target).toHaveAttribute("aria-expanded", "false");
  await captureMotionCheckpoint(page, "zone-first-closed");
  await toggle.click();
  await expect(target).toHaveAttribute("aria-expanded", "true");
  await captureMotionCheckpoint(page, "zone-reopened");
  await target.press("ArrowDown");
  await captureMotionCheckpoint(page, "zone-keyboard-before-immediate-Escape");
  await target.press("Escape");
  await expect(target).toHaveValue("UTC");
  await expect(target).toHaveAttribute("aria-expanded", "false");
  const record = await finishMotionProbe(
    page,
    info,
    "zone-interruption-frames",
  );
  expectStationary(record, [
    "#target-zone",
    ".choice-toggle",
    ".choice-popover",
  ]);
  expect(
    record.events.some(
      (event) => event.type === "animationstart" && /choice/.test(event.target),
    ),
  ).toBe(true);
  await expect(page.getByRole("option")).toHaveCount(0);
  await target.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest(".choice-popover"),
    ),
  ).toBe(false);
});

test("a delayed result animation owns completion beyond the former cleanup deadline", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await holdConversion(page);
  await page.goto("/");
  await enterZone(page, "UTC");
  const input = page.getByLabel("Message with a date or time");
  await input.fill("April 9, 2026 3pm UTC");
  await expect
    .poll(() => page.evaluate(() => (window as any).completions.length))
    .toBe(1);
  await beginMotionProbe(page, [".result-group", ".result .copy-button"]);
  await page.evaluate(() => {
    const state = window as any;
    const observer = new MutationObserver(() => {
      const animation = document
        .querySelector(".result-group.is-new-group")
        ?.getAnimations()
        .find(
          (animation) =>
            animation instanceof CSSAnimation &&
            animation.animationName === "surface-fade",
        );
      if (!animation) return;
      animation.pause();
      animation.currentTime = 0;
      state.delayedResultAnimation = animation;
      state.delayedResultAt = performance.now();
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await deliverConversion(page, 0);
  await expect
    .poll(() => page.evaluate(() => !!(window as any).delayedResultAnimation))
    .toBe(true);
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
  // Deliberately keep the native animation pending beyond the previous 240ms
  // wall-clock cleanup. This is a failure boundary, not a settling wait.
  await expect
    .poll(() =>
      page.evaluate(() => performance.now() - (window as any).delayedResultAt),
    )
    .toBeGreaterThan(350);
  await expect(page.locator(".result-group")).toHaveClass(/is-new-group/);
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { name: /^Copy / })).toBeEnabled();
  await page.evaluate(() => (window as any).delayedResultAnimation.play());
  await expect(page.locator(".result-group")).not.toHaveClass(/is-new-group/);
  const record = await finishMotionProbe(page, info, "delayed-result-frames");
  expectStationary(record, [".result .copy-button"]);
  expect(
    record.events.filter(
      (event) => event.type === "animationend" && event.name === "surface-fade",
    ),
  ).toHaveLength(1);
});

test("new groups reveal once, numeric replacements are atomic and Copy reports only the clipboard outcome", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await holdConversion(page);
  await page.addInitScript(() => {
    const state = window as any;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () =>
          new Promise<void>((resolve, reject) => {
            state.resolveClipboard = resolve;
            state.rejectClipboard = reject;
          }),
      },
    });
  });
  await page.goto("/");
  await enterZone(page, "UTC");
  const input = page.getByLabel("Message with a date or time");
  await input.fill("April 9, 2026 3pm UTC");
  await expect
    .poll(() => page.evaluate(() => (window as any).completions.length))
    .toBe(1);
  await beginMotionProbe(page, [".result-group", ".result .copy-button"]);
  await deliverConversion(page, 0);
  const copy = page.getByRole("button", { name: /^Copy / });
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
  await copy.click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).resolveClipboard))
    .toBe("function");
  await expect(copy).toHaveAttribute("data-copy-state", "idle");
  await expect(page.getByText("Copied", { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).resolveClipboard());
  await expect(copy).toHaveAttribute("data-copy-state", "success");
  const first = await finishMotionProbe(page, info, "new-group-copy-frames");
  expectStationary(first, [".result .copy-button"]);
  expect(
    first.events.filter(
      (event) =>
        event.type === "animationstart" && /is-new-group/.test(event.target),
    ),
  ).toHaveLength(1);

  await input.fill("April 9, 2026 4pm UTC");
  await expect
    .poll(() => page.evaluate(() => (window as any).completions.length))
    .toBe(2);
  await beginMotionProbe(page, [
    ".result-group",
    ".hero-time",
    ".result .copy-button",
  ]);
  await deliverConversion(page, 1);
  await expect(page.locator(".hero-time")).toHaveText(/4:00 pm/i);
  await expect(copy).toHaveAttribute("data-copy-state", "idle");
  const replaced = await finishMotionProbe(
    page,
    info,
    "same-group-replacement-frames",
  );
  expect(
    replaced.events.filter(
      (event) =>
        event.type === "animationstart" && /result-group/.test(event.target),
    ),
  ).toEqual([]);
  for (const element of replaced.frames.flatMap((frame) => frame.elements)) {
    expect(element.opacity).toBe(1);
    expect(element.transforms).toEqual([]);
  }
  await copy.click();
  await page.evaluate(() =>
    (window as any).rejectClipboard(new Error("Injected clipboard rejection")),
  );
  await expect(copy).toHaveAttribute("data-copy-state", "failure");
  await expect(page.getByLabel("Text to copy")).toHaveValue(/4:00 pm/i);

  await input.fill("April 9, 2026 4pm UTC. April 10, 2026 6pm UTC");
  await expect
    .poll(() => page.evaluate(() => (window as any).completions.length))
    .toBe(3);
  await beginMotionProbe(page, [".result-group", ".result .copy-button"]);
  await deliverConversion(page, 2);
  await expect(page.locator(".hero-time")).toHaveText([/4:00 pm/i, /6:00 pm/i]);
  const added = await finishMotionProbe(page, info, "additional-group-frames");
  expect(
    added.events.filter(
      (event) =>
        event.type === "animationstart" && /is-new-group/.test(event.target),
    ),
  ).toHaveLength(1);
  expectStationary(added, [".result .copy-button"]);
});

test("first System selection resolves the OS palette without explicit theme feedback", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "chronoshift.preferences.v1",
      JSON.stringify({ theme: "dark", target: "UTC", hourCycle: "12" }),
    );
  });
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await page.goto("/");
  const input = page.getByLabel("Message with a date or time");
  await input.fill("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Appearance", { exact: true }).click();
  const theme = choiceTrigger(page, "Theme");
  await theme.click();
  await beginMotionProbe(page, [
    "#message",
    "#target-zone",
    ".hero-time",
    ".result .copy-button",
    ".brand-clock",
  ]);
  await page.evaluate(() => {
    const state = window as any;
    state.firstSystemFeedback = [];
    state.firstSystemSampling = true;
    const sample = () => {
      state.firstSystemFeedback.push({
        time: performance.now(),
        marker: document.documentElement.getAttribute("data-theme-changing"),
        theme: document.documentElement.dataset.theme,
        clock: getComputedStyle(
          document.querySelector(".brand-clock")!,
          "::after",
        ).animationName,
        effects: document.getAnimations().map((animation) => ({
          name:
            (animation as CSSAnimation).animationName ||
            (animation as CSSTransition).transitionProperty,
          state: animation.playState,
          duration: animation.effect?.getTiming().duration,
          currentTime: animation.currentTime,
          stationaryPaletteOwner: (
            animation.effect as KeyframeEffect
          )?.target?.matches(
            "#message,#target-zone,.input-panel,.result-panel,footer",
          ),
          target: (animation.effect as KeyframeEffect)?.target?.outerHTML.slice(
            0,
            220,
          ),
        })),
      });
      if (state.firstSystemSampling) requestAnimationFrame(sample);
    };
    // RAC may stop the option's click propagation. Observe the rendered
    // lifecycle directly instead of depending on a document click listener.
    requestAnimationFrame(sample);
  });
  await page.locator('[role="option"][data-value="system"]').click();
  // Capture before any live OS change or settling assertion can conceal the
  // first-selection marker and its finite 200ms decorative feedback.
  const immediate = await page.evaluate(() => ({
    time: performance.now(),
    theme: document.documentElement.dataset.theme,
    marker: document.documentElement.getAttribute("data-theme-changing"),
    ink: getComputedStyle(document.documentElement).color,
    page: getComputedStyle(document.documentElement).backgroundColor,
  }));
  await expect(theme).toBeFocused();
  await expect(input).toHaveValue("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
  const record = await finishMotionProbe(page, info, "first-system-frames");
  const feedback = await page.evaluate(() => {
    const state = window as any;
    state.firstSystemSampling = false;
    return state.firstSystemFeedback as {
      time: number;
      marker: string | null;
      theme: string;
      clock: string;
      effects: {
        name: string;
        duration: number;
        state: string;
        stationaryPaletteOwner: boolean;
      }[];
    }[];
  });
  await info.attach("first-system-feedback", {
    body: JSON.stringify({ immediate, feedback }),
    contentType: "application/json",
  });
  expect(immediate).toMatchObject({
    theme: "light",
    marker: null,
    ink: "rgb(41, 37, 30)",
    page: "rgb(247, 244, 237)",
  });
  expect(feedback.length).toBeGreaterThan(2);
  for (const [index, sample] of feedback.entries()) {
    expect(Number.isFinite(sample.time)).toBe(true);
    if (index > 0)
      expect(sample.time - feedback[index - 1].time).toBeGreaterThanOrEqual(0);
    expect(sample.marker).toBeNull();
    expect(sample.clock).not.toMatch(/clock-settle/);
    // The native popover may still exit, and restored keyboard focus may
    // produce 140ms control feedback. Neither is the explicit 200ms theme
    // border/shadow or clock effect being excluded here. Unfocused stationary
    // palette owners must also have no fallback-duration palette transitions.
    expect(
      sample.effects.filter(
        (effect) =>
          effect.name === "clock-settle" ||
          (/^(?:border-.*color|box-shadow)$/.test(effect.name) &&
            (effect.duration === 200 || effect.stationaryPaletteOwner)),
      ),
    ).toEqual([]);
  }
  expect(
    record.events.filter((event) => event.name === "clock-settle"),
  ).toEqual([]);
  for (const element of record.frames
    .filter((frame) => frame.time >= immediate.time)
    .flatMap((frame) => frame.elements))
    expect(
      contrast(element.foreground, element.backgrounds, element.layers),
    ).toBeGreaterThanOrEqual(element.selector === ".hero-time" ? 3 : 4.5);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-changing");
  await expect(theme).toBeFocused();
  await expect(input).toHaveValue("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
});

test("explicit theme transitions preserve draft and results; live system resolution is immediate", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await enterZone(page, "UTC");
  const input = page.getByLabel("Message with a date or time");
  await input.fill("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
  await page.getByLabel("Appearance", { exact: true }).click();
  const theme = choiceTrigger(page, "Theme");
  await theme.click();
  await beginMotionProbe(page, [
    ".appearance summary",
    "#theme",
    "#message",
    ".result .copy-button",
  ]);
  await page.locator('[role="option"][data-value="light"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-changing",
    "true",
  );
  await expect(theme).toBeFocused();
  await expect(input).toHaveValue("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
  const record = await finishMotionProbe(page, info, "explicit-theme-frames");
  expectStationary(record, [
    ".appearance summary",
    "#theme",
    "#message",
    ".result .copy-button",
  ]);
  expect(
    record.events.some(
      (event) => event.type === "transitionrun" && /color/.test(event.name),
    ),
  ).toBe(true);
  expect(
    record.events.filter(
      (event) =>
        event.type === "animationstart" &&
        /input-panel|result-panel/.test(event.target),
    ),
  ).toEqual([]);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-changing");
  await theme.click();
  await page.locator('[role="option"][data-value="system"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-changing");
  await expect(input).toHaveValue("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
});

for (const reducedAtStart of [true, false]) {
  test(`${reducedAtStart ? "first-load" : "live"} reduced motion keeps final disclosure, clipboard and editing states usable`, async ({
    page,
  }, info) => {
    await installMotionProbe(page);
    await page.emulateMedia({
      reducedMotion: reducedAtStart ? "reduce" : "no-preference",
    });
    await page.goto("/");
    const toggle = disclosure(page);
    await toggle.focus();
    await toggle.press("Enter");
    if (!reducedAtStart) await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.getByLabel("Source timezone", { exact: true }).fill("UTC");
    await page.getByLabel("Source timezone", { exact: true }).press("Escape");
    await toggle.focus();
    await toggle.press("Enter");
    await toggle.press("Enter");
    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".option-fields")).toHaveAttribute("inert", "");
    await enterZone(page, "UTC");
    await beginMotionProbe(page, [
      "#message",
      ".result-group",
      ".result .copy-button",
    ]);
    const input = page.getByLabel("Message with a date or time");
    await input.fill("April 9, 2026 3pm UTC");
    await input.fill("April 9, 2026 4pm UTC");
    await expect(page.locator(".hero-time")).toHaveText(/4:00 pm/i);
    await captureMotionCheckpoint(page, "reduced-final-result-committed");
    const record = await finishMotionProbe(page, info, "reduced-result-frames");
    expect(
      record.events.filter((event) => event.type === "animationstart"),
    ).toEqual([]);
    expectStationary(record, ["#message", ".result .copy-button"]);
    expect(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      ),
    ).toBe(0);
    await page.getByRole("button", { name: /^Copy / }).click();
    await expect(page.locator(".notice")).toBeVisible();
    await toggle.focus();
    await toggle.press("Enter");
    await page
      .getByRole("button", { name: "Reset preferences", exact: true })
      .click();
    await expect(input).toHaveValue("April 9, 2026 4pm UTC");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".hero-time")).toBeVisible();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(page.locator(".result")).toHaveCount(0);
  });
}

for (const reduced of [false, true]) {
  test(`${reduced ? "reduced" : "normal"} empty, error and ambiguity feedback keeps explanations persistent without animation loops`, async ({
    page,
  }, info) => {
    await installMotionProbe(page);
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.goto("/");
    await enterZone(page, "UTC");
    const input = page.getByLabel("Message with a date or time");
    await beginMotionProbe(page, [".message.error"]);
    await input.fill("No timestamp here");
    await expect(page.getByRole("alert")).toContainText("No time found");
    const error = await finishMotionProbe(page, info, "error-state-frames");
    await expect(page.getByRole("alert")).toContainText("No time found");
    await beginMotionProbe(page, [".result-placeholder"]);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Ready to convert" }),
    ).toBeVisible();
    const empty = await finishMotionProbe(page, info, "empty-state-frames");
    await expect(
      page.getByRole("heading", { name: "Ready to convert" }),
    ).toBeVisible();
    await beginMotionProbe(page, [".ambiguity"], 650);
    await input.fill("July 15, 2026 3pm CST");
    await expect(
      page.getByText("2 possible interpretations", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".hero-time")).toHaveText([
      /9:00 pm/i,
      /7:00 am/i,
    ]);
    const ambiguity = await finishMotionProbe(
      page,
      info,
      "ambiguity-state-frames",
    );
    await expect(
      page.getByText("2 possible interpretations", { exact: true }),
    ).toBeVisible();
    for (const [record, target] of [
      [error, "message error"],
      [empty, "result-placeholder"],
      [ambiguity, "ambiguity"],
    ] as const) {
      const events = record.events.filter(
        (event) =>
          event.type === "animationstart" && event.target.includes(target),
      );
      expect(events.length).toBe(reduced ? 0 : 1);
    }
    const animations = await page.evaluate(() =>
      document.getAnimations().map((animation) => ({
        running: animation.playState === "running",
        iterations: animation.effect?.getTiming().iterations,
      })),
    );
    expect(
      animations.every(
        (animation) =>
          Number.isFinite(animation.iterations) && animation.iterations! <= 1,
      ),
    ).toBe(true);
    expect(animations.some((animation) => animation.running)).toBe(false);
  });
}

test("IME, clear and a superseded clipboard completion cannot revive stale result effects", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await holdConversion(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            (window as any).lateCopy = resolve;
          }),
      },
    });
  });
  await page.goto("/");
  await enterZone(page, "UTC");
  const input = page.getByLabel("Message with a date or time");
  await input.fill("April 9, 2026 3pm UTC");
  await expect
    .poll(() => page.evaluate(() => (window as any).completions.length))
    .toBe(1);
  await beginMotionProbe(page, [".result-group", ".result .copy-button"]);
  await input.dispatchEvent("compositionstart");
  await input.evaluate((element: HTMLTextAreaElement) => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(element, "April 9, 2026 4pm UTC");
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertCompositionText",
        data: "4pm",
        isComposing: true,
      }),
    );
  });
  await deliverConversion(page, 0);
  await expect(page.locator(".result")).toHaveCount(0);
  await expect(page.locator(".live-indicator")).toHaveAttribute(
    "data-state",
    "paused",
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await input.dispatchEvent("compositionend");
  await expect(input).toHaveValue("");
  await expect(page.locator(".live-indicator")).toHaveAttribute(
    "data-state",
    "idle",
  );
  const cleared = await finishMotionProbe(page, info, "ime-clear-stale-frames");
  expect(
    cleared.events.filter(
      (event) =>
        event.type === "animationstart" && /result-group/.test(event.target),
    ),
  ).toEqual([]);
  await input.fill("April 9, 2026 5pm UTC");
  await deliverConversion(page, 1);
  await expect(page.locator(".hero-time")).toHaveText(/5:00 pm/i);
  await page.getByRole("button", { name: /^Copy / }).click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).lateCopy))
    .toBe("function");
  await input.fill("April 9, 2026 6pm UTC");
  await expect
    .poll(() => page.evaluate(() => (window as any).completions.length))
    .toBe(3);
  await beginMotionProbe(page, [".result-group", ".result .copy-button"]);
  await page.evaluate(() => (window as any).lateCopy());
  await deliverConversion(page, 2);
  await expect(page.locator(".hero-time")).toHaveText(/6:00 pm/i);
  await expect(page.getByRole("button", { name: /^Copy / })).toHaveAttribute(
    "data-copy-state",
    "idle",
  );
  await expect(page.getByText("Copied", { exact: true })).toHaveCount(0);
  const replaced = await finishMotionProbe(
    page,
    info,
    "superseded-copy-frames",
  );
  expect(
    replaced.events.filter(
      (event) =>
        event.type === "animationstart" &&
        /result-group|copy-check/.test(event.target),
    ),
  ).toEqual([]);
});

test("immediate Escape closes a child menu and then its retained Appearance parent", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await page.goto("/");
  const appearance = page.getByLabel("Appearance", { exact: true });
  await appearance.click();
  const theme = choiceTrigger(page, "Theme");
  await theme.focus();
  await theme.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await beginMotionProbe(page, [
    ".appearance summary",
    ".appearance-fields",
    ".choice-popover",
  ]);
  // Exiting child content is retained for presentation. It must not consume
  // the next Escape intended for the parent, and this action does not settle it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const requested = await page
    .locator(".appearance")
    .getAttribute("data-expanded");
  const record = await finishMotionProbe(page, info, "nested-escape-frames");
  expect(requested).toBe("false");
  await expect(appearance).toBeFocused();
  await expect(page.locator(".appearance-fields")).toHaveAttribute("inert", "");
  await expect(page.getByRole("option")).toHaveCount(0);
  expectStationary(record, [".appearance summary"]);
});

test("an entering zone menu follows an immediate viewport resize and still accepts keyboard selection", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await enterZone(page, "UTC");
  const input = page.getByLabel("Message with a date or time");
  await input.fill("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
  await expect(page.locator(".choice-popover")).toHaveCount(0);
  const toggle = page.getByRole("button", {
    name: "Show target timezones",
    exact: true,
  });
  const target = page.getByLabel("Convert to", { exact: true });
  await toggle.scrollIntoViewIfNeeded();
  await beginMotionProbe(page, ["#target-zone", ".choice-popover"], 650);
  await toggle.click();
  const beforeResize = await page.evaluate(() => {
    const target = document
      .querySelector("#target-zone")!
      .getBoundingClientRect();
    const popup = document
      .querySelector(".choice-popover:not([data-exiting])")!
      .getBoundingClientRect();
    return {
      target: target.toJSON(),
      popup: popup.toJSON(),
      layoutWidth: document.documentElement.clientWidth,
      innerWidth,
      visualScale: visualViewport?.scale,
      scrollY,
    };
  });
  await captureMotionCheckpoint(page, "open-menu-before-resize");
  await page.setViewportSize({ width: 280, height: 844 });
  const popup = page.locator(".choice-popover:not([data-exiting])");
  await expect(target).toHaveAttribute("aria-expanded", "true");
  const bounds = (await popup.boundingBox())!;
  const afterResize = await page.evaluate(() => {
    const target = document
      .querySelector("#target-zone")!
      .getBoundingClientRect();
    const popup = document
      .querySelector(".choice-popover:not([data-exiting])")!
      .getBoundingClientRect();
    return {
      target: target.toJSON(),
      popup: popup.toJSON(),
      layoutWidth: document.documentElement.clientWidth,
      innerWidth,
      visualScale: visualViewport?.scale,
      scrollY,
    };
  });
  await captureMotionCheckpoint(page, "open-menu-after-immediate-resize");
  await target.fill("Tokyo");
  const ownedList = page.locator(
    `[id="${await target.getAttribute("aria-controls")}"]`,
  );
  await expect(
    ownedList.getByRole("option", { name: "Tokyo", exact: true }),
  ).toHaveCount(1);
  await target.press("ArrowDown");
  await target.press("Enter");
  await expect(target).toHaveValue("Asia/Tokyo");
  await expect(page.locator(".hero-time")).toHaveText(/12:00 am/i);
  await expect(input).toHaveValue("April 9, 2026 3pm UTC");
  const record = await finishMotionProbe(page, info, "open-menu-resize-frames");
  await info.attach("immediate-resize-bounds", {
    body: JSON.stringify({ bounds, beforeResize, afterResize }),
    contentType: "application/json",
  });
  expect(record.frames.some((frame) => frame.viewport.width === 1280)).toBe(
    true,
  );
  expect(record.frames.some((frame) => frame.viewport.width === 280)).toBe(
    true,
  );
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(afterResize.layoutWidth).toBe(280);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    afterResize.layoutWidth + 1,
  );
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
  const verticalAnchorGap = Math.min(
    Math.abs(afterResize.popup.top - afterResize.target.bottom),
    Math.abs(afterResize.target.top - afterResize.popup.bottom),
  );
  expect(verticalAnchorGap).toBeLessThanOrEqual(12);
  expect(afterResize.innerWidth).toBe(280);
  expect(afterResize.visualScale).toBe(1);
  // Responsive layout and collection filtering can change bounds; neither
  // authorizes transform/scale on the positioned overlay or live field.
  for (const element of record.frames.flatMap((frame) => frame.elements))
    expect(element.transforms).toEqual([]);
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(target).toBeFocused();
  await target.press("Escape");
  // The toggle preserves input focus, so the explicitly selected canonical
  // draft remains until ordinary blur restores its inactive city label.
  await expect(target).toHaveValue("Asia/Tokyo");
  await expect(target).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("option")).toHaveCount(0);
  await target.press("Tab");
  await expect(target).not.toBeFocused();
  await expect(target).toHaveValue("Tokyo");
});

for (const mode of [
  "reduced startup",
  "normal startup delivered",
  "normal startup rapid",
  "completed normal startup",
] as const)
  test(`${mode} does not replay entrance or committed groups when normal motion resumes`, async ({
    page,
  }, info) => {
    const reducedAtStart = mode === "reduced startup";
    await installMotionProbe(page);
    await page.emulateMedia({
      reducedMotion: reducedAtStart ? "reduce" : "no-preference",
    });
    await page.goto("/");
    await enterZone(page, "UTC");
    const input = page.getByLabel("Message with a date or time");
    await input.fill("April 9, 2026 3pm UTC");
    await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
    await input.focus();
    if (mode === "completed normal startup")
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document
                .getAnimations()
                .filter((animation) => animation.playState === "running")
                .length,
          ),
        )
        .toBe(0);
    await beginMotionProbe(page, [
      "#message",
      ".result .copy-button",
      ".input-panel",
      ".result-panel",
      ".result-group",
    ]);
    if (!reducedAtStart) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      // Consecutive browser emulation calls can coalesce into only a normal
      // event. Establish actual reduced preference delivery to the application
      // before testing its resume lifecycle; this is a condition, not a delay.
      if (
        mode === "normal startup delivered" ||
        mode === "completed normal startup"
      )
        await expect
          .poll(() =>
            page.evaluate(() =>
              (window as any)
                .motionPreferences()
                .some((event: any) => event.matches),
            ),
          )
          .toBe(true);
    }
    const resumedAt = await page.evaluate(() => performance.now());
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await input.press("End");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("April 9, 2026 3pm UTC");
    await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
    const record = await finishMotionProbe(page, info, "motion-resume-frames");
    // Immediate interruption can deliver an already queued initial start after
    // its animation was consumed. Preserve those raw starts/cancels, verify actual
    // opacity/lifetime below; completed effects have no fresh-start allowance.
    if (mode !== "normal startup rapid")
      expect(
        record.events.filter(
          (event) =>
            event.time >= resumedAt &&
            event.type === "animationstart" &&
            /input-panel|result-panel|result-group/.test(event.target),
        ),
      ).toEqual([]);
    const resumedFrames = record.frames.filter(
      (frame) => frame.time >= resumedAt,
    );
    expect(resumedFrames.length).toBeGreaterThan(2);
    for (const element of resumedFrames
      .flatMap((frame) =>
        frame.elements.map((element) => ({
          ...element,
          sampledAt: frame.time,
        })),
      )
      .filter((element) =>
        /input-panel|result-panel|result-group/.test(element.selector),
      )) {
      expect(element.opacity, `${mode} ${element.selector}`).toBe(1);
      const deliveredPreference = record.preferences.some(
        (preference) => preference.time <= element.sampledAt,
      );
      if (mode !== "normal startup rapid" || deliveredPreference) {
        expect(
          element.runningAnimations,
          `${mode} ${element.selector} stale running animation`,
        ).toEqual([]);
      } else {
        // Some browsers emit no event for coalesced emulation changes. The
        // application cannot consume an undelivered preference. Only its
        // original finite animation may continue; forbid fresh/restarted
        // object identities, require full semantic opacity, and terminal
        // lifetime below. Retain raw no-event evidence rather than calling
        // unchanged normal playback a reduced-motion handling regression.
        for (const animation of element.animations.filter(
          (animation) => animation.state === "running",
        )) {
          const original = record.initialAnimations.find(
            (candidate) => candidate.identity === animation.identity,
          );
          expect(original, `${mode} fresh animation identity`).toBeDefined();
          if (original?.startTimeMilliseconds !== null)
            expect(animation.startTimeMilliseconds).toBe(
              original?.startTimeMilliseconds,
            );
          expect(animation.currentTimeMilliseconds).toBeLessThanOrEqual(
            element.selector === ".result-group" ? 240 : 360,
          );
        }
      }
    }
    for (const element of record.frames
      .at(-1)!
      .elements.filter((element) =>
        /input-panel|result-panel|result-group/.test(element.selector),
      ))
      expect(element.runningAnimations).toEqual([]);
    expectStationary(record, ["#message", ".result .copy-button"]);
  });

// Local palettes use computed sRGB colours. Composite transparent ancestor
// layers from the canvas upward before testing actual text/background pairs.
function contrast(
  foreground: string,
  backgrounds: string[],
  layers?: { background: string; opacity: number; image: string }[],
) {
  const parse = (value: string) => {
    const channels = value.match(/[\d.]+/g)!.map(Number);
    return { rgb: channels.slice(0, 3), alpha: channels[3] ?? 1 };
  };
  type Pixel = ReturnType<typeof parse>;
  const over = (top: Pixel, bottom: Pixel): Pixel => {
    const alpha = top.alpha + bottom.alpha * (1 - top.alpha);
    return {
      alpha,
      rgb: top.rgb.map((channel, i) =>
        alpha === 0
          ? 0
          : (channel * top.alpha +
              bottom.rgb[i] * bottom.alpha * (1 - top.alpha)) /
            alpha,
      ),
    };
  };
  let text = parse(foreground),
    background: Pixel = { rgb: [0, 0, 0], alpha: 0 };
  for (const layer of layers ??
    backgrounds.map((background) => ({
      background,
      opacity: 1,
      image: "none",
    }))) {
    // Model each element's completed subtree composited at its ancestor alpha.
    // Applying only a text alpha or sampling colours without group alpha is
    // insufficient when a card and its semantic text fade together.
    text = over(text, parse(layer.background));
    background = over(background, parse(layer.background));
    text.alpha *= layer.opacity;
    background.alpha *= layer.opacity;
  }
  const canvas: Pixel = { rgb: [255, 255, 255], alpha: 1 };
  const luminance = (rgb: number[]) =>
    rgb
      .map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce(
        (sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i],
        0,
      );
  const a = luminance(over(text, canvas).rgb),
    b = luminance(over(background, canvas).rgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("explicit and live System themes preserve contrast in actual semantic text and control pairs", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await enterZone(page, "UTC");
  await page
    .getByLabel("Message with a date or time")
    .fill("April 9, 2026 3pm UTC");
  await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
  const selectors = [
    "#message",
    "#target-zone",
    ".hero-time",
    ".result-date",
    ".source-label",
    ".result .copy-button",
    ".appearance summary",
  ];
  const check = (record: Awaited<ReturnType<typeof finishMotionProbe>>) => {
    for (const element of record.frames.flatMap((frame) => frame.elements)) {
      const minimum = element.selector === ".hero-time" ? 3 : 4.5;
      expect(
        contrast(element.foreground, element.backgrounds, element.layers),
        `${element.selector} ${element.foreground} over ${element.backgrounds.join(" / ")}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  };
  await page.getByLabel("Appearance", { exact: true }).click();
  const theme = choiceTrigger(page, "Theme");
  for (const value of ["light", "dark", "system"]) {
    await theme.click();
    await beginMotionProbe(page, selectors);
    await page.locator(`[role="option"][data-value="${value}"]`).click();
    check(
      await finishMotionProbe(page, info, `semantic-theme-${value}-frames`),
    );
  }
  for (const colorScheme of ["light", "dark"] as const) {
    await beginMotionProbe(page, selectors);
    await page.emulateMedia({ colorScheme });
    const record = await finishMotionProbe(
      page,
      info,
      `semantic-system-${colorScheme}-frames`,
    );
    check(record);
    expect(
      record.events.filter(
        (event) =>
          event.type === "transitionrun" &&
          /^(?:color|background-color)$/.test(event.name),
      ),
    ).toEqual([]);
  }
});

test("example sequence fills directly, advances on repeated pointer and keyboard activation and preserves editing", async ({
  page,
}, info) => {
  await installMotionProbe(page);
  await page.goto("/");
  const button = page.locator(".example-button");
  const input = page.getByLabel("Message with a date or time");
  await input.fill("User draft: April 9, 2026 3pm UTC");
  await beginMotionProbe(page, [".example-button"]);
  await button.click();
  await expect(input).toHaveValue("April 9, 2026 3pm in Tokyo");
  await expect(input).toBeFocused();
  await expect(button).not.toHaveAttribute("aria-haspopup");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("April 9, 2026 9am–11am UTC");
  await expect(input).toBeFocused();
  await button.focus();
  await page.keyboard.press("Space");
  await expect(input).toHaveValue("Tomorrow at 3pm in Tokyo");
  await expect(input).toBeFocused();
  await input.fill("April 9, 2026 3pm UTC");
  await enterZone(page, "UTC");
  await expect(page.locator(".hero-time")).toHaveText("3:00 pm");
  await finishMotionProbe(page, info, "random-example-frames");
  await expect(input).toHaveValue("April 9, 2026 3pm UTC");
});

for (const theme of ["light", "dark"] as const)
  test(`${theme} normal entrance and new-group feedback preserve composite semantic contrast including ancestor opacity`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (theme) =>
        localStorage.setItem(
          "chronoshift.preferences.v1",
          JSON.stringify({
            theme,
            target: "UTC",
            source: "",
            dateOrder: "mdy",
            hourCycle: "12",
          }),
        ),
      theme,
    );
    const selectors = [
      "#message",
      "label[for=target-zone]",
      ".source-label",
      ".result-date",
      ".hero-time",
      ".result-placeholder p",
    ];
    await installMotionProbe(page, selectors);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const input = page.getByLabel("Message with a date or time");
    await input.fill("April 9, 2026 3pm UTC");
    await expect(page.locator(".hero-time")).toHaveText(/3:00 pm/i);
    const entrance = await finishMotionProbe(
      page,
      info,
      "composite-entrance-frames",
    );
    await beginMotionProbe(page, selectors);
    await input.fill("April 9, 2026 3pm UTC. April 10, 2026 6pm UTC");
    await expect(page.locator(".result")).toHaveCount(2);
    const group = await finishMotionProbe(
      page,
      info,
      "composite-new-group-frames",
    );
    for (const record of [entrance, group])
      for (const element of record.frames.flatMap((frame) => frame.elements)) {
        // These palettes have solid CSS surfaces. Retain and verify image absence
        // so the analytical composite is not mislabeled as a pixel measurement.
        expect(element.layers.every((layer) => layer.image === "none")).toBe(
          true,
        );
        const minimum = element.selector === ".hero-time" ? 3 : 4.5;
        expect(
          contrast(element.foreground, element.backgrounds, element.layers),
          `${theme} ${element.selector} composite alpha ${element.layers.map((layer) => layer.opacity).join("/")}`,
        ).toBeGreaterThanOrEqual(minimum);
      }
  });
