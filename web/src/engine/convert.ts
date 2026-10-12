import {
  dayFirst,
  monthFirst,
  numericDateOrder,
  startsAfterUnrelatedDate,
  usesReferenceDate,
  usesReferenceYear,
} from "./parser";
import type { ParsedComponents } from "chrono-node";
import type { Temporal as TemporalTypes } from "@js-temporal/polyfill";
import { temporal as Temporal } from "./temporal";
import {
  AMBIGUOUS,
  FIXED,
  REGIONAL,
  explicitZones,
  offsetMinutes,
  offsetZone,
  resolveCity,
  validZone,
  zoneName,
  IANA_TOKEN,
  OFFSET_TOKEN,
} from "./zones";
import type { ZoneChoice } from "./zones";
import { civilInstants } from "./time";
import type { Conversion, ConversionOptions, TimeResult } from "./types";

import { MAX_INPUT } from "./limits";
export { MAX_INPUT } from "./limits";
const timezoneHints = {
  ...FIXED,
  ...Object.fromEntries(
    Object.entries(AMBIGUOUS).map(([k, v]) => [k, v[0][0]]),
  ),
  ...Object.fromEntries(Object.keys(REGIONAL).map((k) => [k, 0])),
};
function hasNumericDate(c: ParsedComponents): boolean {
  return c.tags().has("parser/SlashDateFormatParser");
}

function componentDate(c: ParsedComponents): TemporalTypes.PlainDate {
  return Temporal.PlainDate.from(
    { year: c.get("year")!, month: c.get("month")!, day: c.get("day")! },
    { overflow: "reject" },
  );
}
function referenceAssumption(now: string, zone: string): string {
  const date = Temporal.Instant.from(now)
    .toZonedDateTimeISO(zone)
    .toPlainDate();
  return `Reference date used: ${date}`;
}
function paragraph(text: string, index: number): number {
  return (text.slice(0, index).match(/\n\s*\n/g) || []).length;
}

function choicesFor(
  text: string,
  suffix: string,
  c: ParsedComponents,
  fallback: string,
  warnings: string[],
): ZoneChoice[] {
  // Only a zone directly following the timestamp belongs to it. Later prose
  // may mention a target zone or another person's location.
  const adjacent = suffix.split(
    /\b(?:to|until|till|through|on|tomorrow|today|and|then|but|please|for|with|because)\b|[.!?]/i,
  )[0];
  const combined = text + adjacent;
  const numeric = combined.match(OFFSET_TOKEN);
  if (numeric && !explicitZones(numeric[0])?.length) {
    warnings.push(
      `Invalid timezone offset ${numeric[0]}. Correct it and try again.`,
    );
    return [];
  }
  const unknownIana = combined.match(IANA_TOKEN);
  if (unknownIana && !validZone(unknownIana[0])) {
    warnings.push(
      `Unknown timezone ${unknownIana[0]}. Correct it and try again.`,
    );
    return [];
  }
  const explicit = explicitZones(text);
  if (explicit) return explicit;
  const suffixZone = adjacent.match(
    /^\s*(?:(?:in|at)\s+)?((?:[A-Z][A-Za-z0-9_+-]*\/)+[A-Za-z0-9_+-]+|(?:UTC|GMT)\s*[+\-−][\d:]+|(?:US\s+)?(?:Pacific|Eastern|Central|Mountain)(?:\s+Time)?|[A-Z]{2,5}\b)/i,
  );
  if (suffixZone) {
    const choices = explicitZones(suffixZone[1]);
    if (choices) return choices;
  }
  const city = adjacent.match(/^\s+(?:in|at)\s+([\p{L}][\p{L} .'-]{1,40})/iu);
  if (city) {
    const query = city[1]
      .replace(
        /\s+(?:to|on|tomorrow|today|and|then|but|please|for|with|because)\b.*$/i,
        "",
      )
      .replace(/[.,]+$/, "")
      .trim();
    const resolved = resolveCity(query);
    if (!resolved.zones.length) {
      warnings.push(
        `Couldn't identify the city “${query}”. Correct or remove the city, then choose a source timezone in More options.`,
      );
      return [];
    }
    return resolved.zones.map((zone) => ({
      zone,
      label: zoneName(zone),
      ...(resolved.corrected
        ? {
            assumption: `City interpreted as ${zoneName(zone)}; check this match`,
          }
        : {}),
    }));
  }
  const bare = adjacent.match(/^\s+([\p{L}][\p{L} .'-]{1,40})/u);
  if (bare) {
    const words = bare[1]
      .replace(/[.,]+$/, "")
      .trim()
      .split(/\s+/);
    for (let length = Math.min(words.length, 4); length > 0; length--) {
      const resolved = resolveCity(words.slice(0, length).join(" "));
      if (!resolved.corrected && resolved.zones.length)
        return resolved.zones.map((zone) => ({ zone, label: zoneName(zone) }));
    }
  }
  // Offsets parsed from ISO strings or numeric offsets have no geographic identity.
  if (c.isCertain("timezoneOffset")) {
    const zone = offsetZone(c.get("timezoneOffset")!);
    return [{ zone, label: zoneName(zone) }];
  }
  const unknownAbbr = suffix.match(/^\s+([A-Z]{2,5})\b/);
  if (unknownAbbr && !["AM", "PM"].includes(unknownAbbr[1])) {
    warnings.push(
      `Unknown timezone ${unknownAbbr[1]}. Correct or remove it, then choose a source timezone.`,
    );
    return [];
  }
  return [
    {
      zone: fallback,
      label: zoneName(fallback),
      assumption: `Source timezone assumed: ${zoneName(fallback)}`,
    },
  ];
}

export function convert(text: string, options: ConversionOptions): Conversion {
  if (text.length > MAX_INPUT)
    throw new Error(
      "Keep the message under 10,000 characters. Shorten it and try again.",
    );
  if (!validZone(options.sourceZone) || !validZone(options.targetZone))
    throw new Error("Choose a valid timezone and try again.");
  if (!text.trim()) return { results: [], warnings: [] };
  let now = options.now || Temporal.Now.instant().toString();
  if (options.referenceDate)
    now = Temporal.PlainDate.from(options.referenceDate)
      .toZonedDateTime({ timeZone: options.sourceZone, plainTime: "12:00" })
      .toInstant()
      .toString();
  const parser = options.dateOrder === "dmy" ? dayFirst : monthFirst;
  const ref = {
    instant: new Date(now),
    timezone: offsetMinutes(options.sourceZone, now),
  };
  // Chrono can parse the digits in UTC+03:00 as a second clock time, especially
  // in ranges. Mask only those tokens without moving source indices; resolve
  // their full original spelling below using deterministic zone semantics.
  const parserText = text.replace(OFFSET_TOKEN, (token) =>
    " ".repeat(token.length),
  );
  const parsed = parser.parse(parserText, ref, { timezones: timezoneHints });
  const warnings: string[] = [],
    results: TimeResult[] = [];
  const invalidOffsets = [...text.matchAll(OFFSET_TOKEN)].filter(
    (m) => !explicitZones(m[0])?.length,
  );
  invalidOffsets.forEach((m) =>
    warnings.push(`Invalid timezone offset ${m[0]}. Correct it and try again.`),
  );
  const vague = [
    ...text.matchAll(
      /\b(?:(?:half|quarter)\s+(?:past|to)\s+(?:noon|midnight|\d{1,2}(?:\s*[ap]m)?)|\d{1,2}ish)\b/gi,
    ),
  ];
  vague.forEach((m) =>
    warnings.push(
      `“${m[0]}” needs a clear clock time. Replace it with a time such as 3:30pm.`,
    ),
  );
  if (/\b(?:EOD|COB)\b/i.test(text))
    warnings.push(
      "EOD/COB does not specify a clock time. Replace it with the intended time.",
    );
  let contextDate: TemporalTypes.PlainDate | undefined,
    contextText = "",
    contextNumeric = false,
    contextOrder = options.dateOrder || "mdy",
    contextParagraph = -1,
    previousEnd = 0;
  const hasTime = parsed.some((r) => r.start.isCertain("hour"));

  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i],
      block = paragraph(text, r.index);
    const matchedText = text.slice(r.index, r.index + r.text.length);
    const prior = parsed[i - 1];
    const qualifiedRange =
      prior &&
      /^\s+(?:(?:(?:in|at)\s+)?[\p{L} .'-]+?|(?:[A-Z][A-Za-z0-9_+-]*\/)+[A-Za-z0-9_+-]+)\s+(?:to|until|through|till|[-–])\s*$/iu.test(
        text.slice(prior.index + prior.text.length, r.index),
      );
    const priorResults = qualifiedRange
      ? results.filter(
          (result) => result.sourceIndex === prior.index && result.instant,
        )
      : [];
    if (
      invalidOffsets.some(
        (m) =>
          r.index <= m.index! + m[0].length &&
          (r.index + r.text.length >= m.index! ||
            !text.slice(r.index + r.text.length, m.index).trim()),
      )
    )
      continue;
    if (
      vague.some(
        (m) =>
          r.index < m.index! + m[0].length &&
          r.index + r.text.length > m.index!,
      )
    )
      continue;
    if (
      block !== contextParagraph ||
      startsAfterUnrelatedDate(r.start) ||
      /[.!?]\s+[A-Z]/.test(text.slice(previousEnd, r.index))
    ) {
      contextDate = undefined;
      contextText = "";
      contextNumeric = false;
      contextParagraph = block;
    }
    previousEnd = r.index + r.text.length;
    const date = componentDate(r.start),
      explicitDate = r.start.isCertain("day");
    if (explicitDate) {
      contextDate = date;
      contextText = r.text;
      contextNumeric = hasNumericDate(r.start);
      contextOrder = numericDateOrder(r.start, options.dateOrder || "mdy");
    }
    if (!r.start.isCertain("hour") && !r.start.isCertain("minute")) {
      if (!hasTime)
        results.push({
          id: `date-${r.index}`,
          group: `date-${r.index}`,
          original: r.text,
          sourceIndex: r.index,
          dateOnly: date.toString(),
          ...(hasNumericDate(r.start)
            ? {
                numericDate: {
                  date: date.toString(),
                  order: numericDateOrder(r.start, options.dateOrder || "mdy"),
                },
              }
            : {}),
          sourceZone: options.sourceZone,
          sourceLabel: "Date only",
          assumptions: [
            ...(!r.start.isCertain("year")
              ? [`Year assumed: ${date.year}`]
              : []),
            ...(usesReferenceDate(r.start)
              ? [referenceAssumption(now, options.sourceZone)]
              : []),
          ],
          occurrences: 1,
        });
      continue;
    }
    const suffixEnd = Math.min(
      parsed[i + 1]?.index ?? text.length,
      r.index + r.text.length + 100,
    );
    const suffix = text
      .slice(r.index + r.text.length, suffixEnd)
      .split(/\n|[.;!?]|,(?!\s*\d)/)[0];
    const zoneSuffix = suffix.split(
      /\b(?:to|with|because|please|but|then|and)\b/i,
    )[0];
    const leadingZone = zoneSuffix
      .trim()
      .match(/^(?:UTC|GMT)\s*[+\-−][\d:]+|^[A-Z]{2,5}\b/i);
    const original = (
      matchedText +
      (/^\s+(?:(?:in|at)\s+|(?:[A-Z][A-Za-z0-9_+-]*\/))/.test(zoneSuffix) ||
      (leadingZone && explicitZones(leadingZone[0])?.length)
        ? zoneSuffix
        : "")
    ).trim();
    const endpoints: [ParsedComponents, "start" | "end" | undefined][] = [
      [r.start, r.end ? "start" : undefined],
      ...(r.end ? [[r.end, "end"] as [ParsedComponents, "end"]] : []),
    ];
    const zones = [
      ...(matchedText + zoneSuffix).matchAll(
        /\b(?:UTC|GMT)\s*[+\-−][\d:]+|\b(?:[A-Z]{2,5})\b/gi,
      ),
    ].filter((m) => !!explicitZones(m[0]));
    for (const [c, endpoint] of endpoints) {
      // If both endpoints carry a different abbreviation, resolve each independently.
      const zoneText =
        r.end && zones.length > 1
          ? zones[endpoint === "end" ? zones.length - 1 : 0][0]
          : matchedText;
      const choices = choicesFor(
        zoneText,
        suffix,
        c,
        options.sourceZone,
        warnings,
      );
      for (const choice of choices) {
        const zoneRef = {
          instant: new Date(now),
          timezone: offsetMinutes(choice.zone, now),
        };
        const local = parser.parse(r.text, zoneRef, {
          timezones: timezoneHints,
        })[0];
        const components = local
          ? endpoint === "end" && local.end
            ? local.end
            : local.start
          : c;
        let selectedDate = componentDate(components),
          assumptions = choice.assumption ? [choice.assumption] : [],
          referenceUsed = usesReferenceDate(components);
        if (!explicitDate && contextDate) {
          const header = parser.parse(contextText, zoneRef, {
            timezones: timezoneHints,
          })[0];
          const context = header ? componentDate(header.start) : contextDate;
          referenceUsed = header
            ? usesReferenceDate(header.start)
            : referenceUsed;
          selectedDate = context.add({
            days: componentDate(local?.start || r.start).until(selectedDate)
              .days,
          });
          assumptions.push(`Date from message context: ${context}`);
        } else if (!explicitDate) {
          assumptions.push(`Date assumed: ${selectedDate}`);
        } else if (!c.isCertain("year") && usesReferenceYear(components)) {
          // An implied range year can inherit the other endpoint's explicit year.
          // Keep relative-date disclosure policy while excluding that false claim.
          assumptions.push(`Year assumed: ${selectedDate.year}`);
        }
        if (referenceUsed)
          assumptions.push(referenceAssumption(now, choice.zone));
        const dt = selectedDate.toPlainDateTime({
          hour: components.get("hour") || 0,
          minute: components.get("minute") || 0,
          second: components.get("second") || 0,
          millisecond: components.get("millisecond") || 0,
        });
        let civil = dt;
        if (priorResults.length === 1 && !explicitDate) {
          const start = Temporal.Instant.from(priorResults[0].instant!)
            .toZonedDateTimeISO(priorResults[0].sourceZone)
            .toPlainDateTime();
          civil = start.toPlainDate().toPlainDateTime(dt.toPlainTime());
          if (
            Temporal.PlainTime.compare(
              civil.toPlainTime(),
              start.toPlainTime(),
            ) < 0
          )
            civil = civil.add({ days: 1 });
        }
        if (priorResults.length)
          priorResults.forEach((result) => {
            result.endpoint = "start";
            result.rangeId = `range-${prior.index}`;
          });
        const resolved = civilInstants(civil, choice.zone);
        if (resolved.nonexistent) {
          warnings.push(
            `${civil.toString().replace("T", " ")} doesn't exist in ${choice.label} because the clocks move forward. Edit the time or timezone in your message${choice.assumption?.startsWith("Source timezone assumed:") ? ", or change Source timezone in Message interpretation" : ""}.`,
          );
          continue;
        }
        for (let n = 0; n < resolved.instants.length; n++) {
          const instant = resolved.instants[n];
          results.push({
            id: `${r.index}-${endpoint || "time"}-${choice.zone}-${n}`,
            group: `${r.index}-${endpoint || "time"}`,
            original,
            sourceIndex: r.index,
            endpoint: priorResults.length ? "end" : endpoint,
            ...(r.end || priorResults.length
              ? {
                  rangeId: `range-${priorResults.length ? prior.index : r.index}`,
                }
              : {}),
            ...(hasNumericDate(c) ||
            (!c.isCertain("day") &&
              (hasNumericDate(r.start) ||
                (r.end && hasNumericDate(r.end)) ||
                contextNumeric))
              ? {
                  numericDate: {
                    date: civil.toPlainDate().toString(),
                    order: numericDateOrder(
                      hasNumericDate(c)
                        ? c
                        : hasNumericDate(r.start)
                          ? r.start
                          : r.end && hasNumericDate(r.end)
                            ? r.end
                            : c,
                      contextNumeric
                        ? contextOrder
                        : options.dateOrder || "mdy",
                    ),
                  },
                }
              : {}),
            instant,
            sourceZone: choice.zone,
            sourceLabel: choice.label,
            interpretation:
              resolved.instants.length > 1
                ? `${choice.interpretation ? choice.interpretation + " · " : ""}${n === 0 ? "First" : "Second"} occurrence (clocks move back)`
                : choice.interpretation,
            assumptions,
            occurrences: 1,
          });
        }
      }
    }
  }
  for (const match of text.matchAll(/\b(1[4-9]\d{8}|[2-9]\d{9})\b/g)) {
    const instant = Temporal.Instant.fromEpochMilliseconds(+match[0] * 1000);
    const year = instant.toZonedDateTimeISO("UTC").year;
    if (year < 2015 || year > 2035) continue;
    results.push({
      id: `unix-${match.index}`,
      group: `unix-${match.index}`,
      original: match[0],
      sourceIndex: match.index!,
      instant: instant.toString(),
      sourceZone: "UTC",
      sourceLabel: "UTC",
      assumptions: [],
      occurrences: 1,
    });
  }
  const merged = new Map<string, TimeResult>();
  for (const r of results.sort((a, b) => a.sourceIndex - b.sourceIndex)) {
    const source = r.sourceZone === "+00:00" ? "UTC" : r.sourceZone;
    const key = `${r.instant || r.dateOnly}|${source}|${r.endpoint || ""}|${r.rangeId || ""}`;
    const previous = merged.get(key);
    if (previous) {
      if (
        previous.assumptions.some((a) =>
          a.startsWith("Source timezone assumed:"),
        ) &&
        !r.assumptions.some((a) => a.startsWith("Source timezone assumed:"))
      )
        merged.set(key, {
          ...r,
          numericDate: r.numericDate || previous.numericDate,
          occurrences: previous.occurrences + 1,
        });
      else {
        previous.numericDate ||= r.numericDate;
        previous.occurrences++;
      }
    } else merged.set(key, r);
  }
  if (merged.size > 200)
    throw new Error(
      "This message has more than 200 time interpretations. Convert a smaller section.",
    );
  return { results: [...merged.values()], warnings: [...new Set(warnings)] };
}
