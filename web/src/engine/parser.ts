import { en } from "chrono-node";
import type { Chrono } from "chrono-node";
import type { ParsingResult } from "chrono-node";
import type { ParsedComponents } from "chrono-node";
import type { Temporal as TemporalTypes } from "@js-temporal/polyfill";
import { temporal as Temporal } from "./temporal";
import { AMBIGUOUS, FIXED, REGIONAL } from "./zones";
const abbreviations = Object.keys({ ...FIXED, ...AMBIGUOUS, ...REGIONAL }).join(
  "|",
);
const dateParts = ["year", "month", "day"] as const;
function referenceDateParts(c: ParsedComponents) {
  const tags = c.tags();
  const relative = [...tags].some(
    (tag) =>
      tag.startsWith("casualReference/") || tag === "result/relativeDate",
  );
  return Object.fromEntries(
    dateParts.map((part) => [
      part,
      tags.has("chronoshift/resolved-date")
        ? tags.has(`chronoshift/reference-${part}`)
        : relative || !c.isCertain(part),
    ]),
  ) as Record<(typeof dateParts)[number], boolean>;
}
export function usesReferenceDate(c: ParsedComponents): boolean {
  return Object.values(referenceDateParts(c)).some(Boolean);
}
export function numericDateOrder(
  c: ParsedComponents,
  fallback: "mdy" | "dmy",
): "mdy" | "dmy" {
  return c.tags().has("parser/date-order/dmy")
    ? "dmy"
    : c.tags().has("parser/date-order/mdy")
      ? "mdy"
      : fallback;
}
function extend(parser: Chrono, preference: "mdy" | "dmy"): Chrono {
  // Annotate each parser-owned date before date/time and range merging. Chrono
  // swaps an impossible month; the saved preference is then not the used order.
  parser.refiners.unshift({
    refine: (_context, results) => {
      for (const result of results) {
        if (!result.start.tags().has("parser/SlashDateFormatParser")) continue;
        const [first, second] = result.text.split(/[\/.-]/).map(Number);
        const order = first > 12 ? "dmy" : second > 12 ? "mdy" : preference;
        result.start.addTag(`parser/date-order/${order}`);
      }
      return results;
    },
  });
  // Chrono's range merger sorts endpoints by instant. Our contract preserves
  // textual clock/zone identity, and treats a lower end clock as overnight.
  // Locate the pinned English merger by its behavior, not a minified class name.
  const range = parser.refiners.find((refiner) => {
    const candidate = refiner as unknown as { patternBetween?: () => RegExp };
    return (
      candidate.patternBetween?.().test(" to ") &&
      !candidate.patternBetween().test(" at ")
    );
  }) as unknown as {
    mergeResults: (
      between: string,
      from: ParsingResult,
      to: ParsingResult,
    ) => ParsingResult;
  };
  if (!range?.mergeResults)
    throw new Error(
      "Chrono range adapter requires review after dependency upgrade",
    );
  const merge = range.mergeResults.bind(range);
  range.mergeResults = (between, from, to) => {
    if (!from.start.isCertain("hour") || !to.start.isCertain("hour"))
      return merge(between, from, to);
    const result = from.clone();
    result.end = to.start.clone();
    // Chrono's clone drops tags. Preserve relative-date provenance before
    // recording which date components the range inherits from either side.
    result.start.addTags(
      [...from.start.tags()].filter((tag) => !tag.startsWith("chronoshift/")),
    );
    result.end.addTags(
      [...to.start.tags()].filter((tag) => !tag.startsWith("chronoshift/")),
    );
    let startReference = referenceDateParts(from.start);
    let endReference = referenceDateParts(to.start);
    const clock = (c: typeof result.start) =>
      ((c.get("hour") || 0) * 3600 +
        (c.get("minute") || 0) * 60 +
        (c.get("second") || 0)) *
        1000 +
      (c.get("millisecond") || 0);
    const dateOf = (c: typeof result.start) =>
      Temporal.PlainDate.from({
        year: c.get("year")!,
        month: c.get("month")!,
        day: c.get("day")!,
      });
    const implyDate = (
      c: typeof result.start,
      date: TemporalTypes.PlainDate,
    ) => {
      c.imply("year", date.year);
      c.imply("month", date.month);
      c.imply("day", date.day);
    };
    if (!result.start.isCertain("day") && result.end.isCertain("day")) {
      let date = dateOf(result.end);
      if (clock(result.start) > clock(result.end))
        date = date.subtract({ days: 1 });
      implyDate(result.start, date);
      startReference = { ...endReference };
    } else if (
      !result.start.isCertain("year") &&
      result.end.isCertain("year")
    ) {
      result.start.imply("year", result.end.get("year")!);
      startReference.year = endReference.year;
      if (
        Temporal.PlainDate.compare(dateOf(result.start), dateOf(result.end)) > 0
      )
        result.start.imply("year", result.end.get("year")! - 1);
    }
    if (!result.end.isCertain("day")) {
      let date = dateOf(result.start);
      if (clock(result.end) < clock(result.start)) date = date.add({ days: 1 });
      implyDate(result.end, date);
      endReference = { ...startReference };
    } else if (!result.end.isCertain("year")) {
      result.end.imply("year", result.start.get("year")!);
      endReference.year = startReference.year;
      if (
        Temporal.PlainDate.compare(dateOf(result.end), dateOf(result.start)) < 0
      )
        result.end.imply("year", result.start.get("year")! + 1);
    }
    for (const [components, reference] of [
      [result.start, startReference],
      [result.end, endReference],
    ] as const) {
      components.addTag("chronoshift/resolved-date");
      for (const part of dateParts)
        if (reference[part]) components.addTag(`chronoshift/reference-${part}`);
    }
    result.text = from.text + between + to.text;
    return result;
  };
  // Bounded extensions cover audited shorthand without treating room numbers
  // or prices as times. Native Chrono refiners still merge dates and zones.
  parser.parsers.unshift({
    pattern: () =>
      new RegExp(
        `\\b([01]\\d|2[0-3])([0-5]\\d)\\s*(?:hours\\b|Zulu\\b|(?=(?:${abbreviations})\\b))`,
        "i",
      ),
    extract: (_context, match) => ({
      hour: +match[1],
      minute: +match[2],
      second: 0,
    }),
  });
  parser.parsers.unshift({
    pattern: () => /\b(1[0-2]|[1-9])([ap])\b(?=\s+[A-Z]{2,5}\b)/i,
    extract: (_context, m) => ({
      hour: (+m[1] % 12) + (m[2].toLowerCase() === "p" ? 12 : 0),
      minute: 0,
      second: 0,
      meridiem: m[2].toLowerCase() === "p" ? 1 : 0,
    }),
  });
  parser.parsers.unshift({
    pattern: () =>
      /\bbetween\s+(1[0-2]|[1-9])(?::([0-5]\d))?\s+and\s+(1[0-2]|[1-9])(?::([0-5]\d))?\s*([ap])m\b/i,
    extract: (context, m) => {
      const pm = m[5].toLowerCase() === "p" ? 12 : 0;
      return context.createParsingResult(
        m.index!,
        m[0],
        { hour: (+m[1] % 12) + pm, minute: +(m[2] || 0), meridiem: pm ? 1 : 0 },
        { hour: (+m[3] % 12) + pm, minute: +(m[4] || 0), meridiem: pm ? 1 : 0 },
      );
    },
  });
  return parser;
}
export const monthFirst = extend(en.casual.clone(), "mdy"),
  dayFirst = extend(en.GB.clone(), "dmy");
