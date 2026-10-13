import { en, ParsingContext } from "chrono-node";
import type { Chrono } from "chrono-node";
import type { ParsingResult } from "chrono-node";
import type { Refiner } from "chrono-node";
import type { ParsedComponents } from "chrono-node";
import type { Temporal as TemporalTypes } from "@js-temporal/polyfill";
import { temporal as Temporal } from "./temporal";
import { AMBIGUOUS, FIXED, REGIONAL } from "./zones";
const abbreviations = Object.keys({ ...FIXED, ...AMBIGUOUS, ...REGIONAL }).join(
  "|",
);
const dateParts = ["year", "month", "day"] as const;
const unrelatedDateBoundary = "result/unrelated-date-boundary";
export function startsAfterUnrelatedDate(c: ParsedComponents): boolean {
  return c.tags().has(unrelatedDateBoundary);
}
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
export function usesReferenceYear(c: ParsedComponents): boolean {
  return referenceDateParts(c).year;
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
  // Both pinned English date/time passes accept a period and arbitrary
  // whitespace. Guard them before they destroy sentence/paragraph ownership.
  // Explicit connectors and the separate range merger retain native behavior.
  type DateTimeMerger = Refiner & {
    patternBetween: () => RegExp;
    shouldMergeResults: (
      between: string,
      from: ParsingResult,
      to: ParsingResult,
      context: ParsingContext,
    ) => boolean;
  };
  const dateTime = parser.refiners.filter((refiner) => {
    const candidate = refiner as unknown as Partial<DateTimeMerger>;
    return (
      candidate.patternBetween?.().test(" at ") &&
      candidate.patternBetween().test(" on ") &&
      candidate.patternBetween().test(".\n\n") &&
      !candidate.patternBetween().test(" to ")
    );
  }) as unknown as DateTimeMerger[];
  if (dateTime.length !== 2 || dateTime.some((r) => !r.shouldMergeResults))
    throw new Error(
      "Chrono date/time boundary adapter requires review after dependency upgrade",
    );
  for (const refiner of dateTime) {
    // Chrono.clone() copies arrays but shares their refiner instances. Keep
    // this adapter local to our parser rather than changing the English singleton.
    const adapter = Object.create(refiner) as DateTimeMerger;
    parser.refiners[parser.refiners.indexOf(refiner)] = adapter;
    const shouldMerge = refiner.shouldMergeResults.bind(refiner);
    adapter.shouldMergeResults = (between, from, to, context) => {
      if (!shouldMerge(between, from, to, context)) return false;
      const separator = between.trim();
      if (
        /^[-–]$/.test(separator) &&
        ((from.start.isOnlyDate() &&
          to.start.tags().has("chronoshift/rescued-range-end")) ||
          (from.start.tags().has("chronoshift/date-range-boundary") &&
            to.start.isOnlyDate()))
      )
        return false;
      const paragraphBreak = /\n\s*\n/.test(between);
      // A standalone date heading may deliberately precede a blank separator.
      // Keep its existing merge/span/disclosure; this adds no new context grammar.
      const heading =
        from.start.isOnlyDate() &&
        /^\s*(?:#{1,6}\s+)?$/.test(
          context.text.slice(
            context.text.lastIndexOf("\n", from.index - 1) + 1,
            from.index,
          ),
        );
      // Chrono includes these explicit connectors inside the time match, so
      // they may not appear in the separator passed to this refiner.
      const timeConnector =
        from.start.isOnlyDate() && /^(?:at|from)\s/i.test(to.text);
      const unrelated =
        separator === "." ||
        (paragraphBreak && !separator && !heading && !timeConnector);
      if (!unrelated) return true;
      // The converter must also decline the preceding date as message context,
      // including when a sentence is followed directly by a numeric clock.
      // result/* tags survive the existing range adapter's component clones.
      if (to.start.isOnlyTime()) to.start.addTag(unrelatedDateBoundary);
      return false;
    };
  }
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
      [...from.start.tags()].filter(
        (tag) =>
          !tag.startsWith("chronoshift/") ||
          tag.startsWith("chronoshift/iso-offset:"),
      ),
    );
    result.end.addTags(
      [...to.start.tags()].filter(
        (tag) =>
          !tag.startsWith("chronoshift/") ||
          tag.startsWith("chronoshift/iso-offset:"),
      ),
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
    result.end.addTag(`chronoshift/endpoint-index:${to.index}`);
    result.text = from.text + between + to.text;
    return result;
  };
  // Bounded extensions cover audited shorthand without treating room numbers
  // or prices as times. Native Chrono refiners still merge dates and zones.
  // Like an undated 00:00 clock, midnight uses the source reference date.
  // Explicit today/tomorrow/date context and overnight ranges still bind via
  // the normal date/range refiners; do not silently choose the coming midnight.
  parser.refiners.unshift({
    refine: (context, results) => {
      const reference = context.createParsingComponents({});
      for (const result of results) {
        for (const components of [result.start, result.end])
          if (
            components?.tags().has("parser/ISOFormatParser") &&
            components.isCertain("timezoneOffset")
          )
            components.addTag(
              `chronoshift/iso-offset:${components.get("timezoneOffset")}`,
            );
        if (result.end) {
          const separator = result.text.match(
            /\b(?:to|until|through|till|and)\b\s*|[-–~〜?]\s*/i,
          );
          if (separator) {
            const endIndex =
              result.index + separator.index! + separator[0].length;
            const completeStart = results.some(
              (date) =>
                date !== result &&
                date.start.isCertain("day") &&
                (!date.start.isCertain("hour") ||
                  date.start.tags().has("parser/ISOFormatParser")) &&
                date.index < result.index &&
                date.index + date.text.length > result.index &&
                date.index + date.text.length <= endIndex,
            );
            // Preserve a complete date or ISO timestamp overlapping a partial
            // start clock. Otherwise overlap removal can discard its end clock.
            if (result.start.isCertain("hour") && completeStart) {
              const resultEnd = result.index + result.text.length;
              const tags = [...result.end.tags()];
              result.start = result.end.clone();
              result.start.addTags(tags);
              result.start.addTag("chronoshift/rescued-range-end");
              result.end = undefined;
              result.index = endIndex;
              result.text = context.text.slice(endIndex, resultEnd);
              for (const part of dateParts)
                if (!result.start.isCertain(part))
                  result.start.imply(part, reference.get(part)!);
              continue;
            }
            // A masked prefix can expose a written date's leading day to the
            // clock-range parser ("3pm to 10 April"). Keep the independent
            // date parser's span before overlap removal; later date/time and
            // range refiners can then merge the complete endpoints.
            if (
              results.some(
                (date) =>
                  date !== result &&
                  date.index === endIndex &&
                  date.start.isCertain("day") &&
                  date.text.length >
                    result.index + result.text.length - endIndex,
              )
            ) {
              result.text = result.text.slice(0, separator.index).trimEnd();
              result.end = undefined;
              result.start.addTag("chronoshift/date-range-boundary");
            } else if (result.start.isCertain("hour"))
              result.end.addTag(`chronoshift/endpoint-index:${endIndex}`);
          }
        }
        for (const components of [result.start, result.end])
          if (
            components?.tags().has("casualReference/midnight") &&
            !components.isCertain("day")
          )
            for (const part of dateParts)
              components.imply(part, reference.get(part)!);
      }
      return results;
    },
  });
  const offsetRefiners = parser.refiners.filter((refiner) => {
    const context = new ParsingContext("3pm-10", {
      instant: new Date("2026-04-06T12:00:00Z"),
      timezone: 0,
    });
    const result = context.createParsingResult(0, "3pm", {
      hour: 15,
      minute: 0,
    });
    const refined = refiner.refine(context, [result]);
    return (
      refined.length === 1 &&
      refined[0].text === "3pm-10" &&
      refined[0].start.isCertain("timezoneOffset") &&
      refined[0].start.get("timezoneOffset") === -600
    );
  });
  if (offsetRefiners.length !== 1)
    throw new Error(
      "Chrono offset boundary adapter requires dependency review",
    );
  const offsetRefiner = offsetRefiners[0];
  parser.refiners[parser.refiners.indexOf(offsetRefiner)] = {
    refine: (context, results) => {
      // A complete written date owns the digits after this separator. Native
      // offset extraction must not reinterpret its compact '-10' as -10:00.
      offsetRefiner.refine(
        context,
        results.filter(
          (result) =>
            !result.start.tags().has("chronoshift/date-range-boundary"),
        ),
      );
      return results;
    },
  };
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
  parser.refiners.push({
    refine: (context, results) =>
      results.flatMap((result) => {
        if (!result.end?.isCertain("hour") || result.start.isCertain("hour"))
          return [result];
        const separator = result.text.match(
          /\b(?:to|until|through|till|and)\b\s*|[-–~]\s*/i,
        );
        if (!separator) return [result];
        // A native date range can attach a clock only to its final date.
        // Keep that explicitly parsed time without inventing a start clock.
        const end = result.clone();
        end.start = result.end.clone();
        end.start.addTags([...result.end.tags()]);
        end.end = undefined;
        end.index = result.index + separator.index! + separator[0].length;
        end.text = context.text.slice(
          end.index,
          result.index + result.text.length,
        );
        result.text = result.text.slice(0, separator.index).trimEnd();
        result.end = undefined;
        return [result, end];
      }),
  });
  parser.refiners.push({
    refine: (context, results) => {
      const consumed = new Set<number>();
      return results.flatMap((result, index) => {
        if (consumed.has(index)) return [];
        const date = results[index + 1];
        const endpointTag = [...(result.end?.tags() ?? [])].find((tag) =>
          tag.startsWith("chronoshift/endpoint-index:"),
        );
        const connector = date
          ? context.text.slice(result.index + result.text.length, date.index)
          : "";
        if (
          !result.end ||
          !result.start.isCertain("hour") ||
          !result.end.isCertain("hour") ||
          !date?.start.isOnlyDate() ||
          date.end ||
          !endpointTag ||
          !(
            /^[ \t]+on[ \t]+$/i.test(connector) ||
            (/^[ \t]+$/.test(connector) && /^on[ \t]+/i.test(date.text))
          )
        )
          return [result];
        // Resolve date/time ownership first. A date with its own clock is no
        // longer date-only here, and compact hyphens retain range ownership
        // through native offset extraction.
        const endIndex = +endpointTag.split(":")[1];
        const start = result.clone();
        start.start.addTags([...result.start.tags()]);
        start.end = undefined;
        start.text = result.text
          .slice(0, endIndex - result.index)
          .replace(/(?:to|until|through|till|and|[-–~])\s*$/i, "")
          .trimEnd();
        const end = result.clone();
        end.start = result.end.clone();
        end.start.addTags(
          [...result.end.tags()].filter(
            (tag) =>
              !tag.startsWith("chronoshift/") ||
              tag.startsWith("chronoshift/iso-offset:"),
          ),
        );
        end.start.addTags([...date.start.tags()]);
        for (const part of dateParts) {
          end.start.delete([part]);
          if (date.start.isCertain(part))
            end.start.assign(part, date.start.get(part)!);
          else end.start.imply(part, date.start.get(part)!);
        }
        end.end = undefined;
        end.index = endIndex;
        end.text = context.text.slice(endIndex, date.index + date.text.length);
        consumed.add(index + 1);
        return [
          range.mergeResults(
            context.text.slice(start.index + start.text.length, endIndex),
            start,
            end,
          ),
        ];
      });
    },
  });
  return parser;
}
export const monthFirst = extend(en.casual.clone(), "mdy"),
  dayFirst = extend(en.GB.clone(), "dmy");
