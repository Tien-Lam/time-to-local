import { temporal as Temporal } from "./temporal";
import { formatResult, copyText } from "./time";
import type { ConversionOptions, TimeResult } from "./types";

export interface ResultGroup {
  id: string;
  entries: TimeResult[];
  range: boolean;
  ambiguous: boolean;
}

export function resultGroups(results: TimeResult[]): ResultGroup[] {
  const groups = new Map<string, TimeResult[]>();
  for (const result of results) {
    const id = result.rangeId || result.group;
    const entries = groups.get(id) || [];
    entries.push(result);
    groups.set(id, entries);
  }
  return [...groups].map(([id, entries]) => ({
    id,
    entries,
    range: !!entries[0].rangeId,
    ambiguous:
      new Set(entries.map((entry) => entry.group)).size < entries.length,
  }));
}

export function resultSummary(groups: ResultGroup[]): string {
  if (!groups.length) return "Ready";
  const ranges = groups.filter((group) => group.range).length;
  const times = groups.length - ranges;
  const ambiguous = groups.filter((group) => group.ambiguous).length;
  const parts = [
    ...(times ? [`${times} ${times === 1 ? "time" : "times"}`] : []),
    ...(ranges ? [`${ranges} ${ranges === 1 ? "range" : "ranges"}`] : []),
  ];
  return `${parts.join(", ")}${ambiguous ? " · choose an interpretation" : " converted"}`;
}

/** Never combine alternatives into an invented range. */
export function rangePair(
  group: ResultGroup,
): [TimeResult, TimeResult] | undefined {
  if (!group.range || group.ambiguous || group.entries.length !== 2) return;
  const start = group.entries.find((entry) => entry.endpoint === "start");
  const end = group.entries.find((entry) => entry.endpoint === "end");
  if (start?.instant && end?.instant) return [start, end];
}

export function copyRangeText(
  pair: [TimeResult, TimeResult],
  options: ConversionOptions,
): string {
  const [start, end] = pair.map((entry) => formatResult(entry, options));
  const interval =
    start.date === end.date && start.zone === end.zone
      ? `${start.time}–${end.time} · ${start.date} · ${start.zone}`
      : `${start.time} · ${start.date} · ${start.zone} → ${end.time} · ${end.date} · ${end.zone}`;
  // Keep both sources, original excerpts and assumptions when they differ.
  return `${interval}\n${[...new Set(pair.map((entry) => copyText(entry, options).split("\n").slice(1).join("\n")))].join("\n")}`;
}

export function humanDate(
  date: string,
  locale = "en-AU",
  long = false,
): string {
  return Temporal.PlainDate.from(date).toLocaleString(
    locale,
    long
      ? { dateStyle: "long" }
      : { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  );
}

export function sourceDescription(result: TimeResult): string {
  if (!result.interpretation || !result.instant) return result.sourceLabel;
  const offset = Temporal.Instant.from(result.instant).toZonedDateTimeISO(
    result.sourceZone,
  ).offset;
  return `${result.sourceLabel}${result.sourceLabel.includes(result.interpretation) ? "" : ` · ${result.interpretation}`} · UTC${offset}`;
}

export function referenceSummary(
  result: TimeResult,
  locale: string,
): string | undefined {
  const date = result.assumptions
    .find((value) => value.startsWith("Reference date used: "))
    ?.slice(21);
  return date
    ? `Reference: ${humanDate(date, locale)} in ${result.sourceLabel}`
    : undefined;
}

export function assumptionSummary(result: TimeResult, locale: string): string {
  const date = result.assumptions
    .find((value) => value.startsWith("Date assumed: "))
    ?.slice(14);
  if (date)
    return `Assuming ${humanDate(date, locale)} in ${result.sourceLabel}`;
  if (
    result.assumptions.some((value) =>
      value.startsWith("Source timezone assumed:"),
    )
  )
    return `Assuming ${result.sourceLabel} as the source`;
  return "Interpretation details";
}
