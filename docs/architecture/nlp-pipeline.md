# Web conversion pipeline

Time to Local parses messages locally in a disposable browser worker. The launch path uses pinned Chrono and bundled Temporal, without a model download or conversion service.

```mermaid
flowchart LR
    input[Editable message] --> worker[Cancellable worker]
    worker --> parse[Chrono and bounded extensions]
    parse --> context[Source date and range context]
    context --> zones[Offsets, regions, cities and ambiguity]
    zones --> temporal[Exact instants and DST alternatives]
    temporal --> merge[Stable result identity and duplicates]
    merge --> format[Target timezone and display preferences]
    format --> results[Date, time, zone and Copy]
```

## Parsing and source context

`engine/parser.ts` clones the pinned English Chrono parsers for month/day and day/month conventions. Bounded extensions handle military hours, shorthand meridiem and between-ranges. `convert.ts` receives the reference instant, default source zone, target zone and numeric-date order explicitly.

The reference day is resolved in the source zone. Date context may apply within a sentence/list and resets across unrelated text. Date/time merging rejects a sentence-ending period or an unrelated bare paragraph break before either can hide the original boundary; explicit `at`/`on` connectors and existing standalone date headings retain their behavior. A rejected preceding date cannot subsequently become implicit context for the clock. Ranges retain endpoint order and overnight dates. Inherited explicit range years remain explicit for disclosure; only reference-derived years can produce an assumed-year annotation. Dates without times remain dates; in messages containing clocks, standalone dates serve as context rather than extra result rows. Unix seconds use a bounded supported interval.

`engine/date-context.ts` prepares each original message before parsing. A complete month-name/day heading (either textual order, optional ordinal/year and consistent weekday) can own immediately following clock-first bullet or numbered items at the same indentation. Plain, trailing-colon, one-to-six-hash Markdown and bold headings qualify; one blank before the first item is allowed. Prose, a nonclock first item, a blank inside the list, changed indentation, another heading, competing dates, quotes or fences end ownership. An explicit event date overrides that event while later siblings retain their heading date.

A blank-delimited record can also supply context when it contains exactly one `Date` before exactly one `Time`, with case-insensitive labels and optional non-temporal `Title`, `Activity` or `Location` fields. Validation examines the whole block, so late duplicates, unknown fields, Time-first order and temporal optional values decline association. Location does not supply a timezone. Tables, numeric headings, raw HTML/YAML, bracketed date headings and general prose inference remain outside this extension.

Preparation replaces scoped standalone owner text and list markers with equal-length opaque barriers while preserving line breaks, indentation and UTF-16 offsets. Valid standalone Date values also receive barriers in declined records, preventing native cross-line association before whole-block rejection; same-line explicit date/clock events retain their meaning. These barriers prevent Chrono from consuming a sibling bullet as a range endpoint or merging a removed date into a clock. Actual clock/range detections remain authoritative; returned spans crossing a barrier are declined. Conversion distinguishes owned, blocked and ordinary legacy context, preventing structural dates and explicit sibling overrides from leaking beyond their domain. Date-only messages restore their saved ordinary date detections. Newly inherited results retain the original clock/range source span and disclose `Date from message context`; omitted owner years also disclose the assumed year and source-local reference date.

Within structural domains, an adjacent explicit zone ends the source span before activity text. Removing parser-owned leading whitespace advances the original source index by the same amount. Parser-confirmed clock separators after plain UTC/GMT stay separate from signed-offset validation: native parsing retains single-hyphen ranges and double-hyphen independent points, while malformed signed offsets still require correction.

Textual owners resolve through the existing month-first parser for both textual orders, independently of the numeric-date preference used to extract events. Each source-zone choice resolves its own reference and closest year, then checks any weekday against that date; the target zone never selects the date. Existing clock/range grammar, precision, source-zone alternatives and DST behavior remain in effect. A double hyphen does not create a range or overnight rollover.

## Timezone interpretation

Explicit offsets and standard/daylight abbreviations remain fixed offsets. Regional PT/ET/CT/MT and IANA zones use event-date DST rules. Supported ambiguous abbreviations retain all labeled alternatives. Curated offline city aliases and unique bounded typo matches need no geocoder.

Temporal returns both valid instants for a repeated DST local time and a warning for a nonexistent local time. Unknown zones/cities and unsupported vague expressions require correction rather than an invented answer. See [the product contract](../planning/web-product-contract.md) for exact independent examples.

## Merge and display

Results keep their source identity, date and range endpoint. Duplicate mentions increment occurrences; an explicit source can replace an equivalent assumed source. Target changes only reformat existing results. Display and copying preserve the full date, offset/zone, seconds and milliseconds when supplied. [Merge rules](merge-philosophy.md) explain the boundaries.

## Request lifecycle and privacy

`App.tsx` creates a disposable worker for each conversion. Request IDs and invalidation prevent late results from replacing edited/cleared input. Errors retain editable text. Conversion text stays in memory; only preferences persist by default. A supported POST share or explicit update uses a short-lived, single-use local handoff.

The build bundles UI/parser/polyfill/worker/CSS/icons/notices on the same origin. Atomic service-worker preparation confirms all required assets before reporting Offline ready. New versions wait for explicit activation; partial installations retain the working cache.

Optional learned span detection is a separate research/benchmark ticket. It must justify its browser size, latency and accuracy before enhancing the deterministic path. See [ML research](../planning/lightweight-browser-ml-research.md).
