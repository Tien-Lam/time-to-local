export interface Preferences {
  target: string;
  source: string;
  hourCycle: "auto" | "12" | "24";
  dateOrder: "mdy" | "dmy";
  theme: "dark" | "light" | "system";
  design: "command" | "aqua";
}
export const DEFAULTS: Preferences = {
  target: "",
  source: "",
  hourCycle: "auto",
  dateOrder: "mdy",
  theme: "dark",
  design: "command",
};
const KEY = "chronoshift.preferences.v1";
export function loadPreferences(): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      target: typeof raw.target === "string" ? raw.target.slice(0, 80) : "",
      source: typeof raw.source === "string" ? raw.source.slice(0, 80) : "",
      hourCycle: ["auto", "12", "24"].includes(raw.hourCycle)
        ? raw.hourCycle
        : "auto",
      dateOrder: raw.dateOrder === "dmy" ? "dmy" : "mdy",
      theme: ["dark", "light", "system"].includes(raw.theme)
        ? raw.theme
        : "dark",
      design: raw.design === "aqua" ? "aqua" : "command",
    };
  } catch {
    return { ...DEFAULTS };
  }
}
export function savePreferences(value: Preferences): boolean {
  try {
    if (
      (Object.keys(DEFAULTS) as (keyof Preferences)[]).every(
        (key) => value[key] === DEFAULTS[key],
      )
    )
      localStorage.removeItem(KEY);
    else {
      // Keep the original preference shape for the default design and legacy clients.
      const { design, ...original } = value;
      localStorage.setItem(
        KEY,
        JSON.stringify(design === "aqua" ? value : original),
      );
    }
    return true;
  } catch {
    return false;
  }
}
export function resetPreferences(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* defaults still work */
  }
}
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
