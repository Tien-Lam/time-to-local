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
import { zoneIdentity } from "./zone-aliases";
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
function writtenIsoOffset(c: ParsedComponents): number | undefined {
  const tag = [...c.tags()].find((tag) =>
    tag.startsWith("chronoshift/iso-offset:"),
  );
  return tag ? +tag.split(":")[1] : undefined;
}
function sameCivilClock(
  civil: TemporalTypes.PlainDateTime,
  left: string,
  right: string,
): boolean {
  if (left === right) return true;
  const candidates = civilInstants(civil, left).instants;
  const other = civilInstants(civil, right).instants;
  return (
    (!candidates.length && !other.length) ||
    other.some((instant) => candidates.includes(instant))
  );
}
const zoneToken =
  `(?:[A-Z][A-Za-z0-9_+-]*/)+[A-Za-z0-9_+-]+|` +
  `(?:UTC|GMT)[ \\t]*[+\\-−][A-Za-z0-9+\\-−:]+|` +
  `(?:US[ \\t]+)?(?:Pacific|Eastern|Central|Mountain)(?:[ \\t]+Time)?|` +
  Object.keys(timezoneHints).join("|") +
  `|[A-Z]{2,5}(?=[ \\t]*:)`;

function zonePrefixes(text: string) {
  // Claim zones only at phrase boundaries and immediately before a temporal
  // expression. Masking them before Chrono runs prevents a comma-separated
  // prefix from being consumed as the preceding clock's timezone suffix.
  const temporalStart =
    `now\\b|noon\\b|midnight\\b|today\\b|tomorrow\\b|yesterday\\b|tonight\\b|between\\b|` +
    `(?:this|next|last|in)\\b|` +
    `(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\b|` +
    `\\d{1,2}(?:st|nd|rd|th)?[ \\t]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\b|` +
    `\\d{1,4}(?=[:/\\-]|[ \\t]*[ap]m\\b|[ \\t]+hours\\b)`;
  const pattern = new RegExp(
    `(?:^|[,;.!?\\n(–-]|\\b(?:and|then|to|until|till|through|at|in)\\b)[ \\t]*` +
      `(${zoneToken})(?:[ \\t]*:[ \\t]*|[ \\t]+)(?:at[ \\t]+)?(?=${temporalStart})`,
    "gi",
  );
  return [...text.matchAll(pattern)].flatMap((match) => {
    if (
      !explicitZones(match[1]) &&
      !IANA_TOKEN.test(match[1]) &&
      !/^[A-Z]{2,5}$/.test(match[1])
    )
      return [];
    const end = match.index! + match[0].length;
    const index = match.index! + match[0].indexOf(match[1]);
    return [{ index, end, text: match[1] }];
  });
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

function cityChoices(
  adjacent: string,
  warnings: string[],
): ZoneChoice[] | undefined {
  // Explicit zone suffixes are validated separately, including invalid IANA IDs.
  if (explicitZones(adjacent) || IANA_TOKEN.test(adjacent)) return;
  const city = adjacent.match(/^\s+(?:in|at)\s+([\p{L}][\p{L} .'-]{1,40})/iu);
  if (!city) return;
  const query = city[1].replace(/[.,]+$/, "").trim();
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

function adjacentQualifier(suffix: string): string {
  return suffix.split(
    /\b(?:to|until|till|through|on|tomorrow|today|and|then|but|please|for|with|because|is|if|asap)\b|[.!?]/i,
  )[0];
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
  const adjacent = adjacentQualifier(suffix);
  const combined = text + adjacent;
  const numeric = combined.match(OFFSET_TOKEN);
  if (numeric && !explicitZones(numeric[0])?.length) {
    warnings.push(
      `Invalid timezone offset ${numeric[0]}. Correct it and try again.`,
    );
    return [];
  }
  const unknownIana = [
    ...combined.matchAll(new RegExp(IANA_TOKEN.source, "g")),
  ].find((token) => !validZone(token[0]));
  if (unknownIana) {
    warnings.push(
      `Unknown timezone ${unknownIana[0]}. Correct it and try again.`,
    );
    return [];
  }
  const explicit = explicitZones(text);
  const unknownAbbr = adjacent.match(/^\s+([A-Z]{2,5})\b/);
  if (
    (explicit || writtenIsoOffset(c) !== undefined) &&
    unknownAbbr &&
    (adjacent.trim() === unknownAbbr[1] ||
      /^\s+(?:time(?:\s*zone)?\b|zone\b|(?:in|at)\s+)/i.test(
        adjacent.slice(unknownAbbr[0].length),
      )) &&
    !["AM", "PM", "IN", "AT"].includes(unknownAbbr[1]) &&
    !explicitZones(unknownAbbr[1])
  ) {
    warnings.push(
      `Unknown timezone ${unknownAbbr[1]}. Correct or remove it, then choose a source timezone.`,
    );
    return [];
  }
  if (explicit) return explicit;
  const suffixZone = adjacent.match(
    /^\s*(?:(?:in|at)\s+)?((?:[A-Z][A-Za-z0-9_+-]*\/)+[A-Za-z0-9_+-]+|(?:UTC|GMT)\s*[+\-−][\d:]+|(?:US\s+)?(?:Pacific|Eastern|Central|Mountain)(?:\s+Time)?|[A-Z]{2,5}\b)/i,
  );
  if (suffixZone) {
    const choices = explicitZones(suffixZone[1]);
    if (choices) return choices;
  }
  const city = cityChoices(adjacent, warnings);
  if (city) return city;
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
  const prefixes = zonePrefixes(text);
  const prefixAt = (index: number) =>
    prefixes.find(
      (p) =>
        p.index <= index &&
        (index < p.end ||
          /^(?:between)?$/i.test(text.slice(p.end, index).trim())),
    );
  let parserText = text.replace(OFFSET_TOKEN, (token) =>
    " ".repeat(token.length),
  );
  for (const prefix of prefixes)
    parserText =
      parserText.slice(0, prefix.index) +
      " ".repeat(prefix.end - prefix.index) +
      parserText.slice(prefix.end);
  for (const prefix of prefixes) {
    const adjacent = text.slice(
      prefix.end,
      Math.min(
        prefix.end + 100,
        prefixes.find((next) => next.index > prefix.index)?.index ??
          text.length,
      ),
    );
    const qualifier = adjacent.match(IANA_TOKEN);
    if (
      !qualifier ||
      !/^(?:\s+(?:to|until|through|till)|[ \t]*[-–])\s*/i.test(
        adjacent.slice(qualifier.index! + qualifier[0].length),
      )
    )
      continue;
    const dateText = adjacent
      .slice(0, qualifier.index)
      .replace(/\s+(?:in|at)\s*$/i, "")
      .trim();
    const dates = parser.parse(dateText, ref, { timezones: timezoneHints });
    if (
      dates.length !== 1 ||
      !dates[0].start.isCertain("day") ||
      dates[0].start.isCertain("hour") ||
      dates[0].start.isCertain("minute") ||
      dates[0].index !== 0 ||
      dates[0].text.trim() !== dateText
    )
      continue;
    // A slash-bearing qualifier can make Chrono discard a complete date.
    // Keep its original ownership available for validation and range rejection.
    const index = prefix.end + qualifier.index!;
    parserText =
      parserText.slice(0, index) +
      " ".repeat(qualifier[0].length) +
      parserText.slice(index + qualifier[0].length);
  }
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
  const rejected = new Set<number>();

  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i],
      block = paragraph(text, r.index);
    const prefix = prefixAt(r.index);
    const sourceIndex = prefix?.index ?? r.index;
    const matchedText = text.slice(sourceIndex, r.index + r.text.length);
    const prior = parsed[i - 1];
    const priorSuffix = prior
      ? text.slice(prior.index + prior.text.length, sourceIndex)
      : "";
    const qualifiedRange =
      prior &&
      !prior.end &&
      (/^\s+(?:(?:in|at)\s+)?(?:[\p{L} .'-]+?|(?:[A-Z][A-Za-z0-9_+-]*\/)+[A-Za-z0-9_+-]+|(?:UTC|GMT)[ \t]*[+\-−][A-Za-z0-9+\-−:]+)(?:\s+(?:to|until|through|till)|[ \t]*[-–])\s*$/iu.test(
        priorSuffix,
      ) ||
        /^(?:\s+(?:to|until|through|till)|[ \t]*[-–])\s*$/i.test(priorSuffix));
    const priorResults = qualifiedRange
      ? results.filter(
          (result) =>
            result.sourceIndex ===
              (prefixAt(prior.index)?.index ?? prior.index) && result.instant,
        )
      : [];
    const resultStart = results.length;
    // Qualified ranges can arrive as separate parses. Keep their rejection
    // state even when the first endpoint never produced a usable result.
    const reject = () => {
      rejected.add(r.index);
      const ranges = new Set(
        priorResults.flatMap((result) =>
          result.rangeId ? [result.rangeId] : [],
        ),
      );
      for (let index = results.length - 1; index >= 0; index--)
        if (
          index >= resultStart ||
          priorResults.includes(results[index]) ||
          (results[index].rangeId && ranges.has(results[index].rangeId!))
        )
          results.splice(index, 1);
    };
    if (qualifiedRange && rejected.has(prior.index)) {
      reject();
      continue;
    }
    if (
      prefix &&
      /^[A-Z]{2,5}$/.test(prefix.text) &&
      !explicitZones(prefix.text)
    ) {
      warnings.push(
        `Unknown timezone ${prefix.text}. Correct or remove it, then choose a source timezone.`,
      );
      reject();
      continue;
    }
    if (
      invalidOffsets.some(
        (m) =>
          r.index <= m.index! + m[0].length &&
          (r.index + r.text.length >= m.index! ||
            !text.slice(r.index + r.text.length, m.index).trim()),
      )
    ) {
      reject();
      continue;
    }
    if (
      vague.some(
        (m) =>
          r.index < m.index! + m[0].length &&
          r.index + r.text.length > m.index!,
      )
    ) {
      reject();
      continue;
    }
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
    const suffixEnd = Math.min(
      parsed[i + 1]
        ? (prefixAt(parsed[i + 1].index)?.index ?? parsed[i + 1].index)
        : text.length,
      r.index + r.text.length + 100,
    );
    const suffix = text
      .slice(r.index + r.text.length, suffixEnd)
      .split(/\n|[.;!?]|,(?!\s*\d)/)[0]
      .replace(/(?:\s+(?:to|until|through|till)|[ \t]*[-–])\s*$/i, "");
    // Chrono treats case-insensitive "at" as the regional AT abbreviation and
    // may include it in the clock span. Reattach the connector to its original
    // suffix unless it is exactly uppercase AT, which retains zone semantics.
    const consumedAt =
      /\bat\s*$/i.test(r.text) &&
      !/\bAT\s*$/.test(r.text) &&
      /^\s+[\p{L}]/u.test(suffix);
    const qualifierSuffix = consumedAt ? ` at${suffix}` : suffix;
    previousEnd = r.index + r.text.length;
    const date = componentDate(r.start),
      explicitDate = r.start.isCertain("day");
    const dateOnly = !r.start.isCertain("hour") && !r.start.isCertain("minute");
    if (
      dateOnly &&
      prefix &&
      (!choicesFor(
        prefix?.text ?? matchedText,
        qualifierSuffix,
        r.start,
        options.sourceZone,
        warnings,
      ).length ||
        cityChoices(adjacentQualifier(qualifierSuffix), warnings)?.length === 0)
    ) {
      reject();
      continue;
    }
    if (dateOnly && prefix) {
      const ownerZones = [
        ...(matchedText + adjacentQualifier(suffix)).matchAll(
          new RegExp(`\\b(?:${zoneToken})\\b`, "gi"),
        ),
      ].flatMap((token) => explicitZones(token[0]) ?? []);
      const cities = cityChoices(adjacentQualifier(qualifierSuffix), warnings);
      const prefixChoices = explicitZones(prefix.text) ?? [];
      const cityConflict = cities?.some((city) =>
        prefixChoices.some((choice) => {
          if (!/^[+-]/.test(choice.zone))
            return zoneIdentity(choice.zone) !== zoneIdentity(city.zone);
          // A date-only owner has no selected clock. Accept a fixed/city
          // pairing only when that offset is possible on its written date.
          return !Array.from({ length: 24 }, (_, hour) => hour).some((hour) =>
            civilInstants(
              date.toPlainDateTime({ hour }),
              city.zone,
            ).instants.some(
              (instant) =>
                offsetMinutes(city.zone, instant) ===
                offsetMinutes(choice.zone, instant),
            ),
          );
        }),
      );
      if (
        new Set(ownerZones.map((choice) => zoneIdentity(choice.zone))).size >
          new Set(prefixChoices.map((choice) => zoneIdentity(choice.zone)))
            .size ||
        cityConflict
      ) {
        warnings.push(
          "Conflicting timezones around one time. Keep one source timezone per time and try again.",
        );
        reject();
        continue;
      }
    }
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
    const zoneSuffix = adjacentQualifier(suffix);
    const leadingZone = zoneSuffix
      .trim()
      .match(/^(?:UTC|GMT)\s*[+\-−][\d:]+|^[A-Z]{2,5}\b/i);
    const original = (
      matchedText +
      (consumedAt ||
      /^\s+(?:(?:in|at)\s+|(?:[A-Z][A-Za-z0-9_+-]*\/))/.test(zoneSuffix) ||
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
        new RegExp(`\\b(?:${zoneToken})\\b`, "gi"),
      ),
    ].filter((m) => !!explicitZones(m[0]));
    const rangePrefixes = prefixes.filter(
      (p) => p.index >= sourceIndex && p.end < r.index + r.text.length,
    );
    const endIndexTag = [...(r.end?.tags() ?? [])].find((tag) =>
      tag.startsWith("chronoshift/endpoint-index:"),
    );
    const endIndex = endIndexTag ? +endIndexTag.split(":")[1] : undefined;
    const rangeBoundary =
      rangePrefixes.find(
        (p) =>
          p !== prefix &&
          endIndex !== undefined &&
          p.index <= endIndex &&
          (endIndex < p.end || !text.slice(p.end, endIndex).trim()),
      )?.index ??
      endIndex ??
      // Native calendar ranges can inherit their end clock after our early
      // refiner. A distinct masked prefix still owns that endpoint's zone.
      (r.end ? rangePrefixes.find((p) => p !== prefix)?.index : undefined);
    if (prefix || rangePrefixes.length) {
      const owners =
        rangeBoundary === undefined
          ? [zones]
          : [
              zones.filter((zone) => sourceIndex + zone.index! < rangeBoundary),
              zones.filter(
                (zone) => sourceIndex + zone.index! >= rangeBoundary,
              ),
            ];
      if (
        owners.some(
          (owned) =>
            new Set(
              owned.map((zone) =>
                explicitZones(zone[0])!
                  .map((choice) => zoneIdentity(choice.zone))
                  .join("|"),
              ),
            ).size > 1,
        )
      ) {
        warnings.push(
          "Conflicting timezones around one time. Keep one source timezone per time and try again.",
        );
        reject();
        continue;
      }
    }
    let invalidEndpoint = false;
    for (const [c, endpoint] of endpoints) {
      // If both endpoints carry a different abbreviation, resolve each independently.
      const zoneText =
        endpoint === "start" && r.end && !prefix && rangePrefixes.length
          ? zones
              .filter(
                (zone) =>
                  rangeBoundary !== undefined &&
                  sourceIndex + zone.index! < rangeBoundary,
              )
              .map((zone) => zone[0])
              .join(" ")
          : r.end && zones.length > 1
            ? zones[endpoint === "end" ? zones.length - 1 : 0][0]
            : matchedText;
      const endpointPrefix =
        endpoint === "end"
          ? rangePrefixes.length > (prefix ? 1 : 0)
            ? rangePrefixes.at(-1)
            : undefined
          : prefix;
      const isoZoneText = zones
        .filter(
          (token) =>
            rangeBoundary === undefined ||
            sourceIndex + token.index! >= rangeBoundary ===
              (endpoint === "end"),
        )
        .map((token) => token[0])
        .join(" ");
      const choices = choicesFor(
        endpointPrefix?.text ??
          (writtenIsoOffset(c) !== undefined ? isoZoneText : zoneText),
        endpoint === "start" && r.end && (prefix || rangePrefixes.length)
          ? ""
          : qualifierSuffix,
        c,
        options.sourceZone,
        warnings,
      );
      if (
        endpointPrefix &&
        /^[A-Z]{2,5}$/.test(endpointPrefix.text) &&
        !explicitZones(endpointPrefix.text)
      ) {
        invalidEndpoint = true;
        warnings.push(
          `Unknown timezone ${endpointPrefix.text}. Correct or remove it, then choose a source timezone.`,
        );
        continue;
      }
      if (!choices.length) {
        invalidEndpoint = true;
        continue;
      }
      const qualifier =
        prefix || rangePrefixes.length
          ? cityChoices(
              adjacentQualifier(
                endpoint === "start" && r.end ? "" : qualifierSuffix,
              ),
              warnings,
            )
          : undefined;
      if (qualifier && !qualifier.length) {
        invalidEndpoint = true;
        continue;
      }
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
          assumptions = [
            ...(choice.assumption ? [choice.assumption] : []),
            ...(qualifier?.flatMap((city) =>
              city.assumption ? [city.assumption] : [],
            ) ?? []),
          ],
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
        // An ISO offset owns this endpoint's instant, even in a repeated hour.
        // A prefix may supply a label only when its offset agrees at that instant.
        const isoOffset = writtenIsoOffset(c);
        const isoInstant =
          isoOffset === undefined
            ? undefined
            : civil
                .toZonedDateTime(offsetZone(isoOffset))
                .toInstant()
                .toString();
        const cityConflict = qualifier?.some((city) => {
          if (!/^[+-]/.test(choice.zone))
            return (
              zoneIdentity(choice.zone) !== zoneIdentity(city.zone) ||
              !sameCivilClock(civil, choice.zone, city.zone)
            );
          const candidates = civilInstants(civil, city.zone).instants;
          return !candidates.some(
            (instant) =>
              offsetMinutes(city.zone, instant) ===
              offsetMinutes(choice.zone, instant),
          );
        });
        // Browsers can retain pre-1970 backzone history behind a current IANA
        // link. Compare the actual clock too instead of rewriting either ID.
        const aliasConflict = zones.some((token) => {
          if (
            rangeBoundary !== undefined &&
            sourceIndex + token.index! >= rangeBoundary !== (endpoint === "end")
          )
            return false;
          return explicitZones(token[0])!.some(
            (other) =>
              zoneIdentity(choice.zone) === zoneIdentity(other.zone) &&
              !sameCivilClock(civil, choice.zone, other.zone),
          );
        });
        if (
          cityConflict ||
          aliasConflict ||
          (isoInstant && offsetMinutes(choice.zone, isoInstant) !== isoOffset)
        ) {
          invalidEndpoint = true;
          warnings.push(
            "Conflicting timezones around one time. Keep one source timezone per time and try again.",
          );
          continue;
        }
        // "Now" denotes an instant, including during the repeated civil hour
        // when a regional zone moves its clocks back.
        const resolved = isoInstant
          ? { instants: [isoInstant], nonexistent: false }
          : components.tags().has("casualReference/now") &&
              civil.equals(
                Temporal.Instant.from(now)
                  .toZonedDateTimeISO(choice.zone)
                  .toPlainDateTime()
                  .round({
                    smallestUnit: "millisecond",
                    roundingMode: "trunc",
                  }),
              )
            ? {
                instants: [Temporal.Instant.from(now).toString()],
                nonexistent: false,
              }
            : civilInstants(civil, choice.zone);
        if (resolved.nonexistent) {
          invalidEndpoint = true;
          warnings.push(
            `${civil.toString().replace("T", " ")} doesn't exist in ${choice.label} because the clocks move forward. Edit the time or timezone in your message${choice.assumption?.startsWith("Source timezone assumed:") ? ", or change Source timezone in Message interpretation" : ""}.`,
          );
          continue;
        }
        for (let n = 0; n < resolved.instants.length; n++) {
          const instant = resolved.instants[n];
          results.push({
            id: `${sourceIndex}-${endpoint || "time"}-${choice.zone}-${n}`,
            group: `${sourceIndex}-${endpoint || "time"}`,
            original,
            sourceIndex,
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
    if (invalidEndpoint) {
      reject();
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
