import { describe, expect, test } from "bun:test";
import { convert, MAX_INPUT } from "../web/src/engine/convert";
import { copyText, formatResult } from "../web/src/engine/time";
import { offsetZone, resolveCity } from "../web/src/engine/zones";
import fixtures from "./fixtures/temporal.json";
import type { ConversionOptions } from "../web/src/engine/types";
const options: ConversionOptions = {
  now: "2026-04-06T12:00:00Z",
  sourceZone: "UTC",
  targetZone: "Australia/Sydney",
  locale: "en-AU",
  hourCycle: "24",
  dateOrder: "mdy",
};
describe("independently specified temporal fixtures", () => {
  for (const f of fixtures)
    test(f.name, () => {
      const result = convert(f.text, {
        ...options,
        ...f,
        dateOrder: ("dateOrder" in f ? f.dateOrder : options.dateOrder) as
          "mdy" | "dmy",
      });
      expect(
        result.results.flatMap((r) => (r.instant ? [r.instant] : [])),
      ).toEqual(f.instants);
      expect(
        result.results.flatMap((r) => (r.dateOnly ? [r.dateOnly] : [])),
      ).toEqual(("dates" in f ? f.dates : []) || []);
      if (f.endpoints)
        expect(result.results.map((r) => String(r.endpoint))).toEqual(
          f.endpoints,
        );
      if ("warning" in f)
        expect(result.warnings.join("\n")).toContain(f.warning!);
      else expect(result.warnings).toEqual([]);
      if ("assumption" in f)
        expect(
          result.results.flatMap((r) => r.assumptions).join("\n"),
        ).toContain(f.assumption!);
      if ("occurrences" in f)
        expect(result.results[0].occurrences).toBe(f.occurrences!);
      if (f.sourceIndices !== undefined)
        expect(result.results.map((r) => r.sourceIndex)).toEqual(
          f.sourceIndices,
        );
      if (f.originals !== undefined)
        expect(result.results.map((r) => r.original)).toEqual(f.originals);
      if (f.assumptions !== undefined)
        expect(result.results.map((r) => r.assumptions)).toEqual(f.assumptions);
      if (f.sourceZones !== undefined)
        expect(result.results.map((r) => r.sourceZone)).toEqual(f.sourceZones);
      if (f.interpretations !== undefined)
        expect(result.results.map((r) => r.interpretation)).toEqual(
          f.interpretations.map((value: string | null) => value ?? undefined),
        );
      if (f.rangeIds !== undefined)
        expect(result.results.map((r) => r.rangeId)).toEqual(
          f.rangeIds.map((id: string | null) => id ?? undefined),
        );
    });
});
test("paragraph isolation retains mixed-message date-only suppression", () => {
  expect(
    convert("January 19, 2027", options).results.map((r) => r.dateOnly),
  ).toEqual(["2027-01-19"]);
  const results = convert(
    "Call at 8pm UTC.\n\nJanuary 19, 2027 is a separate announcement.",
    options,
  ).results;
  expect(results).toHaveLength(1);
  expect(results[0].dateOnly).toBeUndefined();
  expect(results[0].instant).toBe("2026-04-06T20:00:00Z");
});
test("formatting rolls into next day and copy includes full context", () => {
  const result = convert("April 9, 2026 3pm EST", options).results[0];
  const display = formatResult(result, options);
  expect(display.time).toBe("06:00");
  expect(display.date).toContain("10 Apr 2026");
  expect(display.dateShift).toBe(1);
  expect(copyText(result, options)).toContain("UTC+10:00");
  expect(copyText(result, options)).toContain("EST");
});
test("negative fractional offset never invents a location", () => {
  expect(offsetZone(-210)).toBe("-03:30");
  const result = convert("April 9, 2026 3pm UTC-03:30", options).results[0];
  expect(result.sourceLabel).toBe("UTC-03:30");
  expect(formatResult(result, { ...options, targetZone: "-03:30" }).zone).toBe(
    "UTC-03:30",
  );
});
test("short fuzzy city and unknown guesses are rejected", () => {
  expect(resolveCity("Tok")).toEqual({ zones: [] });
  expect(resolveCity("Atlantis")).toEqual({ zones: [] });
});
test("valid input at limit converts; arbitrary numbers and milliseconds stay unparsed", () => {
  const text = "April 9, 2026 3pm UTC";
  expect(
    convert(text + " ".repeat(MAX_INPUT - text.length), options).results[0]
      .instant,
  ).toBe("2026-04-09T15:00:00Z");
  for (const text of [
    "1775736000000",
    "1200000000",
    "2082758400",
    "Room 1500",
    "$15.00",
  ])
    expect(convert(text, options).results.filter((r) => r.instant)).toEqual([]);
});
test("range keeps textual identities and both endpoints", () => {
  const results = convert("April 9, 2026 11pm-1am UTC", options).results;
  expect(results.map((r) => r.endpoint)).toEqual(["start", "end"]);
  expect(results.map((r) => r.sourceIndex)).toEqual([0, 0]);
  expect(results.map((r) => r.original)).toEqual([
    "April 9, 2026 11pm-1am UTC",
    "April 9, 2026 11pm-1am UTC",
  ]);
});
test("input limit and invalid target give actionable errors", () => {
  expect(() => convert("x".repeat(MAX_INPUT + 1), options)).toThrow("10,000");
  expect(() =>
    convert("3pm UTC", { ...options, targetZone: "Atlantis" }),
  ).toThrow("valid timezone");
});
test("reference date override leaves source zone independent of target", () => {
  const result = convert("Tomorrow at 9am UTC", {
    ...options,
    referenceDate: "2026-07-01",
    targetZone: "Asia/Tokyo",
  });
  expect(result.results[0].instant).toBe("2026-07-02T09:00:00Z");
});
test("reference assumptions describe incomplete dates without claiming fully specified dates used the reference", () => {
  const fixed = { ...options, referenceDate: "2026-04-09" };
  for (const text of ["July 15, 2026 at 3pm UTC", "July 15, 2026"])
    expect(convert(text, fixed).results[0].assumptions).toEqual([]);
  expect(convert("July 15 at 3pm UTC", fixed).results[0].assumptions).toEqual([
    "Year assumed: 2026",
    "Reference date used: 2026-04-09",
  ]);
  expect(
    convert("April 9, 2026\nMeet at 3pm UTC", fixed).results[0].assumptions,
  ).toEqual(["Date from message context: 2026-04-09"]);
});
test("range reference annotations follow inherited date provenance instead of endpoint certainty", () => {
  const fullRanges = [
    {
      text: "April 9, 2026 3pm UTC to 5pm JST",
      instants: ["2026-04-09T15:00:00Z", "2026-04-09T08:00:00Z"],
    },
    {
      text: "April 9, 2026 3pm UTC to 5pm UTC",
      instants: ["2026-04-09T15:00:00Z", "2026-04-09T17:00:00Z"],
    },
    {
      text: "3pm to April 9, 2026 5pm UTC",
      instants: ["2026-04-09T15:00:00Z", "2026-04-09T17:00:00Z"],
    },
    {
      text: "April 9, 2026 3pm UTC to April 10 at 5pm JST",
      instants: ["2026-04-09T15:00:00Z", "2026-04-10T08:00:00Z"],
    },
  ];
  for (const referenceDate of ["2024-01-01", "2030-12-31"])
    for (const { text, instants } of fullRanges) {
      const results = convert(text, { ...options, referenceDate }).results;
      expect(results.map((r) => r.instant)).toEqual(instants);
      for (const result of results)
        expect(
          result.assumptions.filter((a) =>
            a.startsWith("Reference date used:"),
          ),
        ).toEqual([]);
    }
  for (const { text, instants, referenceEndpoints } of [
    {
      text: "Tomorrow at 3pm UTC to 5pm JST",
      instants: ["2024-01-02T15:00:00Z", "2024-01-02T08:00:00Z"],
      referenceEndpoints: [true, true],
    },
    {
      text: "April 9 at 3pm UTC to 5pm JST",
      instants: ["2024-04-09T15:00:00Z", "2024-04-09T08:00:00Z"],
      referenceEndpoints: [true, true],
    },
    {
      text: "April 9, 2026 3pm UTC to tomorrow at 5pm JST",
      instants: ["2026-04-09T15:00:00Z", "2024-01-02T08:00:00Z"],
      referenceEndpoints: [false, true],
    },
  ]) {
    const results = convert(text, {
      ...options,
      referenceDate: "2024-01-01",
    }).results;
    expect(results.map((r) => r.instant)).toEqual(instants);
    expect(
      results.map((r) =>
        r.assumptions.includes("Reference date used: 2024-01-01"),
      ),
    ).toEqual(referenceEndpoints);
  }
});
test("range year disclosures follow inherited explicit years across overnight and year boundaries", () => {
  const cases = [
    {
      text: "Maintenance June 26, 2027 from 10pm UTC\nto 2am UTC.",
      instants: ["2027-06-26T22:00:00Z", "2027-06-27T02:00:00Z"],
    },
    {
      text: "June 26, 2027 10pm UTC to June 27, 2027 2am UTC",
      instants: ["2027-06-26T22:00:00Z", "2027-06-27T02:00:00Z"],
    },
    {
      text: "10pm UTC to June 27, 2027 2am UTC",
      instants: ["2027-06-26T22:00:00Z", "2027-06-27T02:00:00Z"],
    },
    {
      text: "December 31, 2027 11pm UTC to January 1 at 1am UTC",
      instants: ["2027-12-31T23:00:00Z", "2028-01-01T01:00:00Z"],
    },
    {
      text: "December 31 at 11pm UTC to January 1, 2028 at 1am UTC",
      instants: ["2027-12-31T23:00:00Z", "2028-01-01T01:00:00Z"],
    },
    {
      text: "June 26, 2027 at 10pm ET to 2am ET",
      instants: ["2027-06-27T02:00:00Z", "2027-06-27T06:00:00Z"],
    },
  ];
  for (const referenceDate of ["2024-01-01", "2030-12-31"])
    for (const { text, instants } of cases) {
      const results = convert(text, { ...options, referenceDate }).results;
      expect(results.map((r) => r.instant)).toEqual(instants);
      expect(results.map((r) => r.endpoint)).toEqual(["start", "end"]);
      expect(results[0].rangeId).toBeTruthy();
      expect(results[1].rangeId).toBe(results[0].rangeId);
      expect(
        results.flatMap((r) =>
          r.assumptions.filter(
            (a) =>
              a.startsWith("Year assumed:") ||
              a.startsWith("Reference date used:"),
          ),
        ),
      ).toEqual([]);
    }
});
test("omitted and relative range years retain their reference disclosures", () => {
  for (const { text, instants, assumptions } of [
    {
      text: "June 26 at 10pm UTC to 2am UTC",
      instants: ["2024-06-26T22:00:00Z", "2024-06-27T02:00:00Z"],
      assumptions: [
        ["Year assumed: 2024", "Reference date used: 2024-01-01"],
        ["Year assumed: 2024", "Reference date used: 2024-01-01"],
      ],
    },
    {
      text: "Tomorrow at 10pm UTC to 2am UTC",
      instants: ["2024-01-02T22:00:00Z", "2024-01-03T02:00:00Z"],
      assumptions: [
        ["Reference date used: 2024-01-01"],
        ["Year assumed: 2024", "Reference date used: 2024-01-01"],
      ],
    },
    {
      text: "June 26, 2027 at 10pm UTC to tomorrow at 2am UTC",
      instants: ["2027-06-26T22:00:00Z", "2024-01-02T02:00:00Z"],
      assumptions: [[], ["Reference date used: 2024-01-01"]],
    },
  ]) {
    const results = convert(text, {
      ...options,
      referenceDate: "2024-01-01",
    }).results;
    expect(results.map((r) => r.instant)).toEqual(instants);
    expect(results.map((r) => r.assumptions)).toEqual(assumptions);
  }
});
