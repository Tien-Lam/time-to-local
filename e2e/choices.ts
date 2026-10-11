import { expect, type Page } from "@playwright/test";
import { zoneName } from "../web/src/engine/zones";

// Exercise the visible app menu; React Aria's hidden form select does not
// establish that the user can open, navigate or choose from the themed popup.
export function choiceTrigger(page: Page, label: string) {
  // React Aria includes the selected text before the field label in the name.
  return page.getByRole("button", { name: new RegExp(`${label}$`) });
}

export async function choose(page: Page, label: string, value: string) {
  if (
    label === "Time format" &&
    !(await page.locator("#time-format").isVisible())
  )
    await page
      .getByRole("button", { name: "Display preferences", exact: true })
      .click();
  const trigger = choiceTrigger(page, label);
  await trigger.click();
  await page.locator(`[role="option"][data-value="${value}"]`).click();
  await expect(trigger).toHaveAttribute("data-value", value);
  await expect(page.getByRole("option")).toHaveCount(0);
}

export async function enterZone(
  page: Page,
  value: string,
  label = "Convert to",
) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  // Commit custom input and leave the combobox before addressing other
  // accessible controls: its open suggestions intentionally hide outside UI.
  await input.press("Tab");
  await expect(input).toHaveValue(
    value.includes("/") ? zoneName(value) : value,
  );
}

export async function enterReferenceDate(page: Page, isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  for (const [type, value] of [
    ["year", year],
    ["month", month],
    ["day", day],
  ]) {
    const segment = page.locator(
      `#reference-date [data-type="${type}"][role="spinbutton"]`,
    );
    await segment.click();
    const existing = await segment.getAttribute("aria-valuenow");
    if (existing)
      for (const digit of existing) await segment.press("Backspace");
    for (const digit of String(Number(value))) await segment.press(digit);
    await segment.press("Tab");
    await expect(segment).toHaveAttribute(
      "aria-valuenow",
      String(Number(value)),
    );
  }
}
