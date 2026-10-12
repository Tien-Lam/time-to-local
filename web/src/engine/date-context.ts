/** Original UTF-16 offsets; preparation never changes the document's length. */
export type Span = { start: number; end: number };
export type DateToken = {
  span: Span;
  text: string;
  weekday?: number;
};
type Item = { value: Span; indent: string; uninterrupted: boolean };
export type ContextOwner = {
  kind: "heading-list" | "record";
  date: DateToken;
  domain: Span;
  items: Item[];
  eligible: boolean;
};
export type ContextDecision =
  | { kind: "owned"; owner: ContextOwner; event: Span }
  | { kind: "blocked" }
  | { kind: "legacy" };
export type ContextEvent = Span & { clock: boolean; range?: boolean };
export interface ContextPlan {
  decisionFor(event: Span): ContextDecision;
  maySeedLegacyContext(event: Span): boolean;
  crossesEventBoundary(left: Span, right: Span): boolean;
  resetsLegacyContextBetween(leftEnd: number, rightStart: number): boolean;
}
export interface PreparedMessage {
  parserText: string;
  semanticText: string;
  masks: Span[];
  owners: ContextOwner[];
  savedDates: Array<{ span: Span; text: string }>;
  planFor(events: ContextEvent[]): ContextPlan;
}
type Line = Span & { content: string; contentEnd: number; fenced: boolean };
const months =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const weekday =
  "(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\\.?";
const day = "\\d{1,2}(?:st|nd|rd|th)?";
const completeDate = new RegExp(
  `^(?:(${weekday})[, \\t]+)?((?:${months}[ \\t]+${day}|${day}[ \\t]+${months})(?:,?[ \\t]+\\d{4})?)(?:[ \\t]+\\((${weekday})\\))?$`,
  "i",
);
const dateCandidate = new RegExp(
  `\\b(?:${months}[ \\t]+${day}|${day}[ \\t]+${months})\\b`,
  "i",
);
const marker = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(.*)$/;
const overlap = (a: Span, b: Span) => a.start < b.end && a.end > b.start;
const contains = (a: Span, b: Span) => a.start <= b.start && a.end >= b.end;

/** Same-line links with balanced destinations, angle URIs and quoted titles. */
function metadataSpans(text: string): Span[] {
  const masks: Span[] = [],
    links: Span[] = [];
  for (let index = 0; index < text.length;) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] !== "[") {
      index++;
      continue;
    }
    let labelEnd = index + 1,
      brackets = 1;
    for (; labelEnd < text.length; labelEnd++) {
      const char = text[labelEnd];
      if (char === "\r" || char === "\n") break;
      if (char === "\\") {
        const next = text[labelEnd + 1];
        if (next === undefined || next === "\r" || next === "\n") break;
        labelEnd++;
      } else if (char === "[") brackets++;
      else if (char === "]" && --brackets === 0) break;
    }
    if (brackets || text[labelEnd + 1] !== "(") {
      index = labelEnd + 1;
      continue;
    }
    let end = labelEnd + 2,
      parentheses = 1,
      first = end;
    while (text[first] === " " || text[first] === "\t") first++;
    let angle = false,
      titleBoundary = false,
      quote: string | undefined;
    for (; end < text.length; end++) {
      const char = text[end];
      if (char === "\r" || char === "\n") break;
      if (char === "\\") {
        const next = text[end + 1];
        if (next === undefined || next === "\r" || next === "\n") break;
        end++;
        titleBoundary = false;
        continue;
      }
      if (quote) {
        if (char === quote) quote = undefined;
        continue;
      }
      if (angle) {
        if (char === ">") angle = false;
        continue;
      }
      if (char === "<" && end === first) {
        angle = true;
        continue;
      }
      // A URL apostrophe is not a title delimiter. Titles start after real,
      // unescaped destination whitespace and may contain unmatched parentheses.
      if ((char === '"' || char === "'") && titleBoundary) {
        quote = char;
        titleBoundary = false;
        continue;
      }
      titleBoundary = char === " " || char === "\t";
      if (char === "(") parentheses++;
      else if (char === ")" && --parentheses === 0) break;
    }
    if (!parentheses) {
      masks.push({ start: labelEnd + 2, end });
      links.push({ start: index, end: end + 1 });
    }
    index = end + 1;
  }
  let linkIndex = 0;
  for (const match of text.matchAll(/https?:\/\/\S+/gi)) {
    const start = match.index!;
    // Visible link labels remain assertions; destinations are already masked.
    while (linkIndex < links.length && links[linkIndex].end <= start)
      linkIndex++;
    const link = links[linkIndex];
    if (link && link.start <= start && start < link.end) continue;
    masks.push({ start, end: start + match[0].length });
  }
  return masks;
}

function opaqueText(text: string, masks: Span[]): string {
  const units = text.split("");
  for (const mask of masks)
    for (let index = mask.start; index < mask.end; index++) units[index] = "|";
  return units.join("");
}

/** Share exactly the same metadata semantics with optional-field inspection. */
export function maskMetadata(text: string): string {
  return opaqueText(text, metadataSpans(text));
}

/** The converter's existing connector for two separately detected zone clocks. */
export function qualifiedRangeBetween(text: string): boolean {
  return /^\s+(?:(?:(?:in|at)\s+)?[\p{L} .'-]+?|(?:[A-Z][A-Za-z0-9_+-]*\/)+[A-Za-z0-9_+-]+)\s+(?:to|until|through|till|[-–])\s*$/iu.test(
    text,
  );
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  let fence: { char: string; length: number } | undefined;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline + 1;
    const contentEnd =
      newline < 0 ? end : text[newline - 1] === "\r" ? newline - 1 : newline;
    const content = text.slice(start, contentEnd);
    const delimiter = content.match(/^\s*(`{3,}|~{3,})/);
    const fenced = !!fence || !!delimiter;
    if (delimiter) {
      if (!fence)
        fence = { char: delimiter[1][0], length: delimiter[1].length };
      else if (
        delimiter[1][0] === fence.char &&
        delimiter[1].length >= fence.length &&
        !content.slice(delimiter[0].length).trim()
      )
        fence = undefined;
    }
    lines.push({ start, end, contentEnd, content, fenced });
    start = end;
  }
  return lines;
}

/** Shape alone cannot establish an owner; validate uses the production parser. */
function dateToken(
  line: Line,
  raw: string,
  offset: number,
): DateToken | undefined {
  let value = raw.trim().replace(/:$/, "").trim();
  value = value.replace(/^#{1,6}[ \t]+/, "");
  if (value.startsWith("**") && value.endsWith("**"))
    value = value.slice(2, -2).trim().replace(/:$/, "").trim();
  const match = value.match(completeDate);
  if (!match || (match[1] && match[3])) return;
  const name = match[1] || match[3];
  const position = raw.indexOf(match[2]);
  return {
    span: {
      start: line.start + offset + position,
      end: line.start + offset + position + match[2].length,
    },
    text: match[2],
    ...(name
      ? {
          weekday:
            ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(
              name.slice(0, 3).toLowerCase(),
            ) + 1,
        }
      : {}),
  };
}

/**
 * Build opaque structural barriers before Chrono's parsers/refiners run. The
 * callback only examines bounded original values, using the existing parser.
 */
export function prepareMessage(
  text: string,
  inspect: (
    value: string,
    kind: "date" | "standalone-date" | "temporal" | "clock",
  ) => boolean,
): PreparedMessage {
  const lines = linesOf(text),
    owners: ContextOwner[] = [],
    masks: Span[] = [],
    savedDates: Array<{ span: Span; text: string }> = [];
  const covered = new Set<number>();

  // Validate a complete blank-delimited record, including fields after Time.
  for (let first = 0; first < lines.length;) {
    if (!lines[first].content.trim()) {
      first++;
      continue;
    }
    let last = first + 1;
    while (last < lines.length && lines[last].content.trim()) last++;
    const block = lines.slice(first, last);
    const fields = block.map((line) => {
      const match = line.content.match(/^([ \t]*)([A-Za-z]+):[ \t]*(.*)$/);
      return match
        ? {
            line,
            label: match[2].toLowerCase(),
            text: match[3],
            value: {
              start: line.contentEnd - match[3].length,
              end: line.contentEnd,
            },
          }
        : undefined;
    });
    if (
      fields.some((field) => field && ["date", "time"].includes(field.label))
    ) {
      const dates = fields.filter((field) => field?.label === "date"),
        times = fields.filter((field) => field?.label === "time");
      const date = dates[0],
        time = times[0];
      const token = date
        ? dateToken(date.line, date.text, date.value.start - date.line.start)
        : undefined;
      const seen = new Set<string>();
      const eligible =
        !!token &&
        !!time &&
        dates.length === 1 &&
        times.length === 1 &&
        date!.value.start < time.value.start &&
        fields.every((field) => {
          if (
            !field ||
            field.line.fenced ||
            !["date", "time", "title", "activity", "location"].includes(
              field.label,
            ) ||
            seen.has(field.label)
          )
            return false;
          seen.add(field.label);
          return (
            ["date", "time"].includes(field.label) ||
            !inspect(field.text, "temporal")
          );
        }) &&
        inspect(token.text, "date");
      const domain = { start: block[0].start, end: block.at(-1)!.end };
      owners.push({
        kind: "record",
        date: token || { span: domain, text: "" },
        domain,
        items: time
          ? [{ value: time.value, indent: "", uninterrupted: true }]
          : [],
        eligible,
      });
      for (let index = first; index < last; index++) covered.add(index);
      // A declined record must not let a standalone Date field directly
      // merge into a later unlabeled clock before whole-block validation.
      // Preserve its ordinary date-only detection via the saved original.
      for (const field of dates) {
        if (!field) continue;
        if (inspect(field.text, "standalone-date")) {
          masks.push(field.value);
          savedDates.push({ span: field.value, text: field.text });
        }
      }
    }
    first = last;
  }

  for (let first = 0; first < lines.length; first++) {
    const header = lines[first];
    if (
      covered.has(first) ||
      marker.test(header.content) ||
      !dateCandidate.test(header.content) ||
      inspect(header.content, "clock")
    )
      continue;
    // A date followed by prose alone retains the established legacy behavior.
    let last = first + 1,
      blanks = 0,
      foundList = false;
    while (last < lines.length && !covered.has(last)) {
      const line = lines[last];
      if (
        /^\s*#{1,6}\s/.test(line.content) ||
        (!marker.test(line.content) && dateCandidate.test(line.content))
      )
        break;
      if (!line.content.trim()) {
        if (++blanks > 1 && !foundList) break;
      } else {
        if (marker.test(line.content)) foundList = true;
        else if (foundList) break;
        blanks = 0;
      }
      last++;
    }
    if (!foundList) continue;
    const token = dateToken(header, header.content, 0),
      domain = { start: header.start, end: lines[last - 1].end },
      items: Item[] = [];
    let uninterrupted = true,
      indent: string | undefined,
      initialBlank = 0;
    for (let index = first + 1; index < last; index++) {
      const line = lines[index],
        match = line.content.match(marker);
      if (!line.content.trim()) {
        if (items.length || ++initialBlank > 1) uninterrupted = false;
      } else if (!match) uninterrupted = false;
      else {
        if (line.fenced) uninterrupted = false;
        indent ??= match[1];
        if (match[1] !== indent) uninterrupted = false;
        masks.push({
          start: line.start + match[1].length,
          end: line.start + match[1].length + match[2].length,
        });
        items.push({
          value: {
            start: line.contentEnd - match[4].length,
            end: line.contentEnd,
          },
          indent: match[1],
          uninterrupted,
        });
      }
    }
    const eligible =
      !!token &&
      !header.fenced &&
      !/^\s*>/.test(header.content) &&
      inspect(token.text, "date");
    owners.push({
      kind: "heading-list",
      date: token || { span: domain, text: "" },
      domain,
      items,
      eligible,
    });
    const headerSpan = {
      start: header.start + (header.content.match(/^[ \t]*/)?.[0].length || 0),
      end: header.contentEnd,
    };
    masks.push(headerSpan);
    savedDates.push({
      span: headerSpan,
      text: text.slice(headerSpan.start, headerSpan.end),
    });
    first = last - 1;
  }
  // Destination metadata never contributes temporal assertions in the indexed
  // structural domains. Keep visible labels and every original UTF-16 offset.
  const metadataMasks = owners.flatMap((owner) =>
    metadataSpans(text.slice(owner.domain.start, owner.domain.end)).map(
      (mask) => ({
        start: mask.start + owner.domain.start,
        end: mask.end + owner.domain.start,
      }),
    ),
  );
  masks.push(...metadataMasks);

  return {
    parserText: opaqueText(text, masks),
    semanticText: opaqueText(text, metadataMasks),
    masks,
    owners,
    savedDates,
    planFor(events) {
      const owned: Array<{ owner: ContextOwner; event: Span }> = [];
      for (const owner of owners) {
        let valid = owner.eligible;
        for (const item of owner.items) {
          const detected = events.filter((event) => overlap(item.value, event));
          const first = detected[0];
          // The genuine first event must begin at the item value. Explicit
          // dates within that clock/range are allowed; independent dates stop it.
          valid &&=
            item.uninterrupted &&
            !!first &&
            first.clock &&
            first.start === item.value.start &&
            detected.every(
              (event) => event.clock && contains(item.value, event),
            );
          if (owner.kind === "record")
            valid &&=
              detected.length === 1 ||
              (detected.length === 2 &&
                detected.every((event) => !event.range) &&
                qualifiedRangeBetween(
                  text.slice(detected[0].end, detected[1].start),
                ));
          if (valid) owned.push({ owner, event: item.value });
        }
      }
      const decisionFor = (event: Span): ContextDecision => {
        const entry = owned.find((entry) => contains(entry.event, event));
        if (entry) return { kind: "owned", ...entry };
        return owners.some((owner) => overlap(owner.domain, event))
          ? { kind: "blocked" }
          : { kind: "legacy" };
      };
      return {
        decisionFor,
        maySeedLegacyContext: (event) => decisionFor(event).kind === "legacy",
        crossesEventBoundary(left, right) {
          const a = decisionFor(left),
            b = decisionFor(right);
          return (
            (a.kind !== "legacy" || b.kind !== "legacy") &&
            !(a.kind === "owned" && b.kind === "owned" && a.event === b.event)
          );
        },
        resetsLegacyContextBetween(leftEnd, rightStart) {
          return owners.some(
            (owner) =>
              owner.domain.start <= rightStart && owner.domain.end >= leftEnd,
          );
        },
      };
    },
  };
}
