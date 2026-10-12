import {
  dayFirst,
  monthFirst,
  numericDateOrder,
  startsAfterUnrelatedDate,
  usesReferenceDate,
  usesReferenceYear,
} from "./parser";
import type { ParsedComponents, ParsedResult } from "chrono-node";
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
import {
  maskMetadata,
  prepareMessage,
  qualifiedRangeBetween,
} from "./date-context";
import type { ContextOwner, TemporalEvidence } from "./date-context";
import { collapseRepeatedAtomicRanges } from "./range-dedup";
export { MAX_INPUT } from "./limits";
type ResolvedOwner = {
  date: TemporalTypes.PlainDate;
  referenceUsed: boolean;
  yearAssumed: boolean;
};
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

/** Pinned Chrono closest-year comparison, on the source civil UTC surrogate. */
function ownerYear(
  now: string,
  zone: string,
  month: number,
  day: number,
): number {
  const local = Temporal.Instant.from(now).toZonedDateTimeISO(zone);
  const reference = new Date(0);
  reference.setUTCFullYear(local.year, local.month - 1, local.day);
  reference.setUTCHours(
    local.hour,
    local.minute,
    local.second,
    local.millisecond,
  );
  const date = new Date(reference);
  // Keep the sequential setters, including their existing rollover behavior.
  date.setUTCMonth(month - 1);
  date.setUTCDate(day);
  const next = new Date(date),
    previous = new Date(date);
  next.setUTCFullYear(date.getUTCFullYear() + 1);
  previous.setUTCFullYear(date.getUTCFullYear() - 1);
  const distance = (candidate: Date) =>
    Math.abs(candidate.getTime() - reference.getTime());
  if (distance(next) < distance(date)) return next.getUTCFullYear();
  if (distance(previous) < distance(date)) return previous.getUTCFullYear();
  return date.getUTCFullYear();
}
function paragraph(text: string, index: number): number {
  return (text.slice(0, index).match(/\n\s*\n/g) || []).length;
}

function adjacentZoneToken(suffix: string): RegExpMatchArray | null {
  return suffix.match(
    /^[ \t]+(?:(?:in|at)[ \t]+)?((?:[A-Z][A-Za-z0-9_+-]*\/)+[A-Za-z0-9_+-]+|(?:UTC|GMT)[ \t]*[+\-−]\d{1,2}(?::?\d{2})?|(?:US[ \t]+)?(?:Pacific|Eastern|Central|Mountain)(?:[ \t]+Time)?|[A-Z]{2,5}\b)/i,
  );
}
function zoneTokenBoundary(suffix: string, token: RegExpMatchArray): boolean {
  return !/^[A-Za-z0-9_+\-−/]|^:\S/.test(suffix.slice(token[0].length));
}

/** Literal adjacent token, validated independently of subsequent activity. */
function adjacentZoneSpan(
  suffix: string,
): { text: string; choices: ZoneChoice[] } | undefined {
  const explicit = adjacentZoneToken(suffix);
  if (!explicit) return;
  // Validate after greedy lexical extraction, so optional Time/offset parts
  // cannot backtrack into a shorter recognized alias at an invalid boundary.
  if (!zoneTokenBoundary(suffix, explicit)) return;
  const choices = explicitZones(explicit[1]);
  if (choices?.length) return { text: explicit[0], choices };
}

/** Only a complete offset followed by a spaced activity colon may end here. */
function offsetValidationToken(token: string, following: string): string {
  const core = token.slice(0, -1);
  return token.endsWith(":") &&
    /^[ \t]+\S/.test(following) &&
    explicitZones(core)?.length
    ? core
    : token;
}

/** Exact offline city prefix only; trailing activity never becomes a query. */
function adjacentCitySpan(
  suffix: string,
  activityStart?: number,
): string | undefined {
  const match = suffix.match(
    /^[ \t]+(?:in|at)[ \t]+([\p{L}][\p{L} .'-]{1,40})/iu,
  );
  if (!match) return;
  const words = [...match[1].matchAll(/\S+/g)];
  for (let count = Math.min(words.length, 4); count > 0; count--) {
    const last = words[count - 1],
      end = last.index! + last[0].length,
      resolved = resolveCity(match[1].slice(0, end));
    if (!resolved.corrected && resolved.zones.length)
      return match[0].slice(0, match[0].length - match[1].length + end);
  }
  // A parser-confirmed activity boundary makes the preceding complete city
  // query independent. Retain the existing unique-typo rule only for that
  // whole query; never try corrected arbitrary prefixes of trailing prose.
  if (activityStart !== undefined) {
    const complete = suffix.slice(0, activityStart).trimEnd();
    const query = complete.match(/^[ \t]+(?:in|at)[ \t]+(.+)$/i)?.[1];
    if (
      query &&
      query.length <= 40 &&
      query.split(/[ \t]+/).length <= 4 &&
      resolveCity(query).zones.length
    )
      return complete;
  }
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
  if (
    numeric &&
    !explicitZones(
      offsetValidationToken(
        numeric[0],
        combined.slice(numeric.index! + numeric[0].length),
      ),
    )?.length
  ) {
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
  const suffixZone = adjacentZoneSpan(adjacent);
  if (suffixZone) return suffixZone.choices;
  const token = adjacentZoneToken(adjacent);
  if (token && !zoneTokenBoundary(adjacent, token)) {
    warnings.push(
      `Invalid timezone ${adjacent.trim()}. Correct it and try again.`,
    );
    return [];
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

function boundedZoneSuffix(
  suffix: string,
  includeCity = false,
  activityStart?: number,
): string {
  return (
    adjacentZoneSpan(suffix)?.text ||
    (includeCity && adjacentCitySpan(suffix, activityStart)) ||
    suffix
  );
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
  const qualify = (
    event: ParsedResult,
  ): Omit<TemporalEvidence, "start" | "end"> => {
    const components = [event.start, ...(event.end ? [event.end] : [])];
    const explicitClock = components.some((c) => c.isCertain("hour"));
    const relativeAssertion = components.some((c) => {
      const tags = c.tags();
      return (
        tags.has("result/relativeDate") ||
        tags.has("parser/ENCasualDateParser") ||
        /^\s*(?:this|last|past|next|after\s+this)\s+(?:week|month|year)s?\b/i.test(
          event.text,
        )
      );
    });
    return {
      explicitClock,
      relativeAssertion,
      calendarAssertion: components.some(
        (c) =>
          (c.isCertain("day") && c.isCertain("month")) ||
          (c.isCertain("month") && c.isCertain("year")) ||
          c.isCertain("weekday"),
      ),
      vaguePeriod:
        !explicitClock &&
        components.some((c) =>
          [...c.tags()].some((tag) =>
            /^casualReference\/(?:morning|afternoon|evening)$/.test(tag),
          ),
        ),
    };
  };
  const evidence = (value: string): TemporalEvidence[] =>
    parser.parse(value, ref, { timezones: timezoneHints }).map((event) => {
      const leading = event.text.match(/^\s+/)?.[0].length || 0;
      return {
        start: event.index + leading,
        end: event.index + event.text.length,
        ...qualify(event),
      };
    });
  // Each preparation/plan belongs to this call, before native extraction can
  // consume a sibling list marker or merge a structural date into a clock.
  const prepared = prepareMessage(
    text,
    (value, kind) => {
      // Link destinations are labels' metadata, not temporal assertions. Never
      // inspect a URL for dates; visible link text retains its ordinary meaning.
      const bounded = kind === "temporal" ? maskMetadata(value) : value;
      const detected = (kind === "date" ? monthFirst : parser).parse(
        bounded,
        ref,
        {
          timezones: timezoneHints,
        },
      );
      if (kind === "clock")
        return detected.some((event) => event.start.isCertain("hour"));
      if (kind === "temporal")
        return detected.some((event) => {
          const semantic = qualify(event);
          return (
            semantic.explicitClock ||
            semantic.calendarAssertion ||
            semantic.relativeAssertion
          );
        });
      if (kind === "standalone-date") {
        // Partial/uncertain envelopes never become owners. Still protect a
        // native standalone calendar detection from merging into another field,
        // and restore its original detection when the message has no clocks.
        return (
          detected.some((event) => event.start.isCertain("day")) &&
          detected.every(
            (event) =>
              !event.start.isCertain("hour") && !event.end?.isCertain("hour"),
          )
        );
      }
      const date = detected[0];
      if (
        detected.length !== 1 ||
        !date ||
        date.index !== 0 ||
        date.text.length !== bounded.length ||
        date.end ||
        !date.start.isCertain("day") ||
        date.start.isCertain("hour")
      )
        return false;
      try {
        componentDate(date.start);
        return true;
      } catch {
        return false;
      }
    },
    evidence,
    (suffix) => adjacentZoneSpan(suffix)?.text.length || 0,
  );
  // OFFSET_TOKEN also sees spaced clock separators in "UTC - 2am" or
  // "UTC -- 2am". The latter retains independent points, never a new range.
  // Protect only real clock-first structural items/Time values, with
  // parser-confirmed clocks on both sides; malformed signed offsets still
  // receive the established offset validation.
  const clockSeparators = [
    ...prepared.semanticText.matchAll(OFFSET_TOKEN),
  ].filter((match) => {
    if (!/^(?:UTC|GMT)[ \t]+-{1,2}$/i.test(match[0])) return false;
    const item = prepared.owners
      .flatMap((owner) => owner.items)
      .find(
        ({ value }) =>
          value.start <= match.index! &&
          value.end >= match.index! + match[0].length,
      );
    if (!item) return false;
    const prefix = prepared.semanticText
        .slice(item.value.start, match.index)
        .trim(),
      tail = prepared.semanticText
        .slice(match.index! + match[0].length, item.value.end)
        .trimStart();
    const start = parser.parse(prefix, ref, { timezones: timezoneHints })[0],
      end = parser.parse(tail, ref, { timezones: timezoneHints })[0];
    return (
      start?.index === 0 &&
      start.start.isCertain("hour") &&
      end?.index === 0 &&
      end.start.isCertain("hour")
    );
  });
  const maskOffsets = (value: string, sourceStart = 0) =>
    value.replace(OFFSET_TOKEN, (token, index: number) =>
      clockSeparators.some((match) => match.index === sourceStart + index)
        ? token
        : " ".repeat(token.length),
    );
  const zoneLookupText = (value: string, sourceStart: number) => {
    value = prepared.semanticText.slice(
      sourceStart,
      sourceStart + value.length,
    );
    // The token can straddle matchedText and suffix. Replace only separator
    // signs at their original positions for zone lookup; native parsing and
    // original source slices retain every separator unchanged.
    for (const match of clockSeparators) {
      const end = match.index! + match[0].length - sourceStart,
        start = end - match[0].match(/-+$/)![0].length;
      const from = Math.max(start, 0),
        to = Math.min(end, value.length);
      if (from < to)
        value = value.slice(0, from) + " ".repeat(to - from) + value.slice(to);
    }
    return value;
  };
  // Chrono can parse offset digits as another clock. Keep the established
  // offset mask after structural preparation, retaining original indices.
  const parserText = maskOffsets(prepared.parserText);
  const parsed = parser
    .parse(parserText, ref, { timezones: timezoneHints })
    .filter(
      (event) =>
        !prepared.masks.some(
          (mask) =>
            event.index < mask.end &&
            event.index + event.text.length > mask.start,
        ),
    )
    .map((event) => {
      const leading = event.text.match(/^\s+/)?.[0].length || 0;
      if (
        !leading ||
        ![
          ...prepared.owners.map((owner) => owner.domain),
          ...prepared.quoteSpans,
          ...prepared.fenceSpans,
        ].some(
          (span) =>
            span.start < event.index + event.text.length &&
            span.end > event.index,
        )
      )
        return event;
      // Some native noon/midnight matches include leading whitespace. Keep
      // the displayed original and its sourceIndex aligned within our domains.
      const aligned: ParsedResult = Object.create(event);
      Object.defineProperties(aligned, {
        index: { value: event.index + leading },
        text: { value: event.text.slice(leading) },
      });
      return aligned;
    });
  const hasTime = parsed.some((r) => r.start.isCertain("hour"));
  if (!hasTime) {
    // Restore bounded parser-owned dates only for genuinely date-only input.
    // Opaque dates must never return to the mixed-message merge/context pass.
    for (const token of prepared.savedDates) {
      for (const date of parser.parse(
        prepared.semanticText.slice(token.span.start, token.span.end),
        ref,
        {
          timezones: timezoneHints,
        },
      )) {
        const restored: typeof date = Object.create(date);
        Object.defineProperty(restored, "index", {
          value: date.index + token.span.start,
        });
        parsed.push(restored);
      }
    }
    parsed.sort((a, b) => a.index - b.index);
  }
  const plan = prepared.planFor(
    parsed.map((event) => ({
      start: event.index,
      end: event.index + event.text.length,
      clock: event.start.isCertain("hour"),
      range: !!event.end,
      assertion: (() => {
        const semantic = qualify(event);
        return (
          semantic.explicitClock ||
          semantic.calendarAssertion ||
          semantic.relativeAssertion
        );
      })(),
    })),
  );
  const resolvedOwners = new Map<
    ContextOwner,
    Map<string, ResolvedOwner | undefined>
  >();
  const warnings: string[] = [],
    results: TimeResult[] = [],
    incompleteRangeIds = new Set<string>();
  const invalidOffsets = [
    ...prepared.semanticText.matchAll(OFFSET_TOKEN),
  ].filter(
    (m) =>
      !explicitZones(
        offsetValidationToken(
          m[0],
          prepared.semanticText.slice(m.index! + m[0].length),
        ),
      )?.length &&
      !clockSeparators.some((match) => match.index === m.index) &&
      !prepared.masks.some(
        (mask) => m.index! < mask.end && m.index! + m[0].length > mask.start,
      ),
  );
  invalidOffsets.forEach((m) =>
    warnings.push(`Invalid timezone offset ${m[0]}. Correct it and try again.`),
  );
  const vague = [
    ...prepared.semanticText.matchAll(
      /\b(?:(?:half|quarter)\s+(?:past|to)\s+(?:noon|midnight|\d{1,2}(?:\s*[ap]m)?)|\d{1,2}ish)\b/gi,
    ),
  ];
  vague.forEach((m) =>
    warnings.push(
      `“${m[0]}” needs a clear clock time. Replace it with a time such as 3:30pm.`,
    ),
  );
  if (/\b(?:EOD|COB)\b/i.test(prepared.semanticText))
    warnings.push(
      "EOD/COB does not specify a clock time. Replace it with the intended time.",
    );
  let contextDate: TemporalTypes.PlainDate | undefined,
    contextText = "",
    contextNumeric = false,
    contextOrder = options.dateOrder || "mdy",
    contextParagraph = -1,
    previousEnd = 0;
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i],
      block = paragraph(text, r.index);
    const matchedText = text.slice(r.index, r.index + r.text.length);
    const eventSpan = { start: r.index, end: r.index + r.text.length },
      decision = plan.decisionFor(eventSpan);
    const prior = parsed[i - 1];
    const qualifiedRange =
      prior &&
      !plan.crossesEventBoundary(
        { start: prior.index, end: prior.index + prior.text.length },
        eventSpan,
      ) &&
      qualifiedRangeBetween(
        prepared.semanticText.slice(prior.index + prior.text.length, r.index),
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
            !prepared.semanticText
              .slice(r.index + r.text.length, m.index)
              .trim()),
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
      plan.resetsLegacyContextBetween(previousEnd, r.index) ||
      startsAfterUnrelatedDate(r.start) ||
      /[.!?]\s+[A-Z]/.test(prepared.semanticText.slice(previousEnd, r.index))
    ) {
      contextDate = undefined;
      contextText = "";
      contextNumeric = false;
      contextParagraph = block;
    }
    previousEnd = r.index + r.text.length;
    const date = componentDate(r.start),
      explicitDate =
        r.start.isCertain("day") ||
        (decision.kind !== "legacy" &&
          r.start.isCertain("hour") &&
          (r.start.isCertain("weekday") ||
            r.end?.isCertain("weekday") ||
            qualify(r).relativeAssertion)) ||
        (decision.kind !== "legacy" && !!r.end?.isCertain("day"));
    if (explicitDate && plan.maySeedLegacyContext(eventSpan)) {
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
      decision.kind === "owned" ? decision.event.end : text.length,
    );
    // Native clock parsing can consume a dangling city connector before the
    // activity barrier. Return it to the adjacent-city envelope without
    // changing parsed clock components or the authored start position.
    const connector =
      decision.kind === "owned"
        ? matchedText.match(/[ \t]+(?:in|at)$/i)?.[0] || ""
        : "";
    const suffixStart = r.index + r.text.length - connector.length;
    const sourceCore = connector
      ? matchedText.slice(0, -connector.length)
      : matchedText;
    const rawSuffix = text
      .slice(suffixStart, suffixEnd)
      .split(/\n|[.;!?]|,(?!\s*\d)/)[0];
    const activityStart = prepared.masks.find(
      (mask) =>
        mask.start >= suffixStart &&
        mask.start < suffixStart + rawSuffix.length &&
        /^(?:morning|afternoon|evening|night)$/i.test(
          text.slice(mask.start, mask.end),
        ),
    )?.start;
    const activityOffset =
      activityStart === undefined ? undefined : activityStart - suffixStart;
    const displaySuffix =
      decision.kind === "legacy"
        ? rawSuffix
        : boundedZoneSuffix(
            rawSuffix,
            decision.kind === "owned",
            activityOffset,
          );
    const semanticSuffix = zoneLookupText(rawSuffix, suffixStart);
    const suffix =
      decision.kind === "legacy"
        ? semanticSuffix
        : boundedZoneSuffix(
            semanticSuffix,
            decision.kind === "owned",
            activityOffset,
          );
    const zoneSuffix = suffix.split(
      /\b(?:to|with|because|please|but|then|and)\b/i,
    )[0];
    const displayZoneSuffix = displaySuffix.split(
      /\b(?:to|with|because|please|but|then|and)\b/i,
    )[0];
    const assertedZone = adjacentZoneSpan(displayZoneSuffix);
    const sourceSuffix =
      assertedZone?.text ||
      (decision.kind === "legacy"
        ? /^\s+(?:(?:in|at)\s+|(?:[A-Z][A-Za-z0-9_+-]*\/))/.test(
            displayZoneSuffix,
          )
          ? displayZoneSuffix
          : ""
        : adjacentCitySpan(displayZoneSuffix, activityOffset) || "");
    const original = (sourceCore + sourceSuffix).trim();
    const endpoints: [ParsedComponents, "start" | "end" | undefined][] = [
      [r.start, r.end ? "start" : undefined],
      ...(r.end ? [[r.end, "end"] as [ParsedComponents, "end"]] : []),
    ];
    const candidateRangeId = r.end
      ? `range-${r.index}`
      : priorResults.length
        ? `range-${prior.index}`
        : undefined;
    const zones = [
      ...zoneLookupText(sourceCore + zoneSuffix, r.index).matchAll(
        /\b(?:UTC|GMT)\s*[+\-−][\d:]+|\b(?:[A-Z]{2,5})\b/gi,
      ),
    ].filter((m) => !!explicitZones(m[0]));
    for (const [c, endpoint] of endpoints) {
      // If both endpoints carry a different abbreviation, resolve each independently.
      const zoneText =
        r.end && zones.length > 1
          ? zones[endpoint === "end" ? zones.length - 1 : 0][0]
          : zoneLookupText(sourceCore, r.index);
      const choices = choicesFor(
        zoneText,
        zoneLookupText(suffix, suffixStart),
        c,
        options.sourceZone,
        warnings,
      );
      if (candidateRangeId && !choices.length)
        incompleteRangeIds.add(candidateRangeId);
      for (const choice of choices) {
        const zoneRef = {
          instant: new Date(now),
          timezone: offsetMinutes(choice.zone, now),
        };
        const local = parser.parse(
          maskOffsets(
            prepared.parserText.slice(r.index, r.index + r.text.length),
            r.index,
          ),
          zoneRef,
          {
            timezones: timezoneHints,
          },
        )[0];
        const components = local
          ? endpoint === "end" && local.end
            ? local.end
            : local.start
          : c;
        let selectedDate = componentDate(components),
          assumptions = choice.assumption ? [choice.assumption] : [],
          referenceUsed = usesReferenceDate(components);
        let ownedDate: ResolvedOwner | undefined;
        let assumeOwnerYear = false;
        if (!explicitDate && decision.kind === "owned") {
          let choices = resolvedOwners.get(decision.owner);
          if (!choices) {
            choices = new Map();
            resolvedOwners.set(decision.owner, choices);
          }
          if (!choices.has(choice.zone)) {
            const resolved = monthFirst.parse(
              decision.owner.date.text,
              zoneRef,
              {
                timezones: timezoneHints,
              },
            )[0];
            let ownerDate: TemporalTypes.PlainDate | undefined;
            if (resolved) {
              const c = resolved.start;
              try {
                ownerDate = Temporal.PlainDate.from(
                  {
                    year: c.isCertain("year")
                      ? c.get("year")!
                      : ownerYear(
                          now,
                          choice.zone,
                          c.get("month")!,
                          c.get("day")!,
                        ),
                    month: c.get("month")!,
                    day: c.get("day")!,
                  },
                  { overflow: "reject" },
                );
              } catch {
                // The finally selected source year must also have a valid date.
              }
            }
            choices.set(
              choice.zone,
              ownerDate &&
                (!decision.owner.date.weekday ||
                  ownerDate.dayOfWeek === decision.owner.date.weekday)
                ? {
                    date: ownerDate,
                    referenceUsed: usesReferenceDate(resolved!.start),
                    yearAssumed: !resolved!.start.isCertain("year"),
                  }
                : undefined,
            );
          }
          ownedDate = choices.get(choice.zone);
        }
        if (!explicitDate && ownedDate) {
          const context = ownedDate.date;
          selectedDate = context.add({
            days: componentDate(local?.start || r.start).until(selectedDate)
              .days,
          });
          referenceUsed = ownedDate.referenceUsed;
          assumptions.push(`Date from message context: ${context}`);
          assumeOwnerYear = ownedDate.yearAssumed;
        } else if (!explicitDate && decision.kind === "legacy" && contextDate) {
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
        if (assumeOwnerYear) assumptions.push(`Year assumed: ${civil.year}`);
        if (referenceUsed)
          assumptions.push(referenceAssumption(now, choice.zone));
        const resolved = civilInstants(civil, choice.zone);
        if (resolved.nonexistent) {
          if (candidateRangeId) incompleteRangeIds.add(candidateRangeId);
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
  for (const match of prepared.parserText.matchAll(
    /\b(1[4-9]\d{8}|[2-9]\d{9})\b/g,
  )) {
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
  const rangeGroups = new Map<string, TimeResult[]>();
  for (const row of results) {
    if (!row.rangeId) continue;
    const peers = rangeGroups.get(row.rangeId) || [];
    peers.push(row);
    rangeGroups.set(row.rangeId, peers);
  }
  const eligibleRangeIds = new Set<string>();
  for (const [rangeId, peers] of rangeGroups) {
    const first = plan.decisionFor({
      start: peers[0].sourceIndex,
      end: peers[0].sourceIndex + peers[0].original.length,
    });
    if (
      first.kind === "owned" &&
      !incompleteRangeIds.has(rangeId) &&
      peers.every((row) => {
        const decision = plan.decisionFor({
          start: row.sourceIndex,
          end: row.sourceIndex + row.original.length,
        });
        return decision.kind === "owned" && decision.event === first.event;
      })
    )
      eligibleRangeIds.add(rangeId);
  }
  const collapsed = collapseRepeatedAtomicRanges(results, eligibleRangeIds);
  const merged = new Map<string, TimeResult>();
  for (const r of collapsed.sort((a, b) => a.sourceIndex - b.sourceIndex)) {
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
