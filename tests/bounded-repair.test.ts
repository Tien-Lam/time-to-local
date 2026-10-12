import { describe, expect, test } from "bun:test";
import { convert } from "../web/src/engine/convert";
import fixtures from "./fixtures/temporal.json";
import type { ConversionOptions } from "../web/src/engine/types";

const options: ConversionOptions = {
  now: "2026-04-06T12:00:00Z",
  sourceZone: "UTC",
  targetZone: "UTC",
  locale: "en-AU",
  hourCycle: "24",
  dateOrder: "mdy",
};
const fallback = [
  "Date assumed: 2026-04-06",
  "Reference date used: 2026-04-06",
];

function clockRow(text: string, core: string) {
  const rows = convert(text, options).results.filter((r) =>
    r.original.includes(core),
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("DEVELOPMENT #154 independently specified competing controls", () => {
  for (const value of [
    "September 20, 2026 planning",
    "September 2026 planning",
    "tomorrow planning",
    "next Thursday planning",
    "in two days planning",
    "noon planning",
    "12:45 UTC planning",
    "[September 20, 2026](https://example.invalid/agenda)",
    "[noon](https://example.invalid/agenda)",
  ])
    test(`genuine optional assertion ${value} declines whole-record ownership`, () => {
      const text = `Date: August 19, 2026\nTime: 08:35 UTC\nTitle: ${value}`;
      const row = clockRow(text, "08:35 UTC");
      expect(row.instant).toBe("2026-04-06T08:35:00Z");
      expect(row.assumptions).toEqual(fallback);
      expect(row.endpoint).toBeUndefined();
      expect(row.rangeId).toBeUndefined();
    });

  for (const text of [
    "Time: 08:35 UTC\nDate: August 19, 2026\nTitle: September planning",
    "Date: August 19, 2026\nTime: 08:35 UTC\nTitle: September planning\nTitle: October planning",
    "Date: August 19, 2026\nTime: 08:35 UTC\nSpeaker: September planning",
    "Date: August 19, 2026\nTime: 08:35 UTC\nDate: August 20, 2026",
  ])
    test(`invalid record structure cannot gain ownership from a harmless title: ${text}`, () => {
      const row = clockRow(text, "08:35 UTC");
      expect(row.instant).toBe("2026-04-06T08:35:00Z");
      expect(row.assumptions).toEqual(fallback);
    });

  test("Location remains activity even when it names an actual source region", () => {
    const row = clockRow(
      "Date: August 19, 2026\nLocation: Pacific Time\nTime: 08:35 UTC",
      "08:35 UTC",
    );
    expect(row.instant).toBe("2026-08-19T08:35:00Z");
    expect(row.sourceZone).toBe("+00:00");
    expect(row.assumptions).toEqual(["Date from message context: 2026-08-19"]);
  });

  test("a native meridiem modifier remains part of the genuine clock", () => {
    const results = convert(
      "August 19, 2026\n- 8 in the morning UTC\n- 09:25 UTC next",
      options,
    ).results;
    expect(results.map((r) => r.instant)).toEqual([
      "2026-08-19T08:00:00Z",
      "2026-08-19T09:25:00Z",
    ]);
    expect(results.map((r) => r.assumptions)).toEqual(
      Array.from({ length: 2 }, () => [
        "Date from message context: 2026-08-19",
      ]),
    );
    expect(results[0].original).toBe("8 in the morning UTC");
    expect(results.map((r) => r.rangeId)).toEqual([undefined, undefined]);
  });

  test("explicit event date overrides that sibling while later sibling keeps owner", () => {
    const results = convert(
      "August 19, 2026\n- 08:15 UTC on September 21, 2026\n- 09:25 UTC Morning briefing",
      options,
    ).results;
    expect(results.map((r) => r.instant)).toEqual([
      "2026-09-21T08:15:00Z",
      "2026-08-19T09:25:00Z",
    ]);
    expect(results[0].assumptions).toEqual([]);
    expect(results[1].assumptions).toEqual([
      "Date from message context: 2026-08-19",
    ]);
  });

  for (const activity of [
    "- Midnight Snack",
    ": Midnight Snack",
    "[noon](https://example.invalid/agenda)",
  ])
    test(`unresolved independent exact time in activity declines ownership: ${activity}`, () => {
      const results = convert(
        `August 19, 2026\n- 08:15 UTC ${activity}\n- 09:25 UTC next`,
        options,
      ).results;
      expect(
        results.some((r) =>
          r.assumptions.includes("Date from message context: 2026-08-19"),
        ),
      ).toBe(false);
      const next = results.filter((r) => r.original.includes("09:25 UTC"));
      expect(next).toHaveLength(1);
      expect(next[0].instant).toBe("2026-04-06T09:25:00Z");
      expect(next[0].assumptions).toEqual(fallback);
    });

  test("double hyphens cannot invent range identity or overnight date rollover", () => {
    const results = convert(
      "August 19, 2026\n- 11pm UTC -- 1am UTC\n- 02:15 UTC next",
      options,
    ).results;
    expect(results.every((r) => !r.rangeId && !r.endpoint)).toBe(true);
    expect(results.some((r) => r.instant === "2026-08-20T01:00:00Z")).toBe(
      false,
    );
  });

  test("unknown city plus activity is not guessed as a valid prefix", () => {
    const result = convert(
      "August 19, 2026\n- 08:15 in Atlantis Morning briefing",
      options,
    );
    expect(result.results).toEqual([]);
    expect(result.warnings.join("\n")).toContain("Couldn't identify");
  });

  test("a documented unique city typo keeps truthful interpretation disclosure", () => {
    const result = convert(
      "August 19, 2026\n- 08:15 in Tokyp Morning briefing",
      options,
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].instant).toBe("2026-08-18T23:15:00Z");
    expect(result.results[0].sourceZone).toBe("Asia/Tokyo");
    expect(result.results[0].original).toBe("08:15 in Tokyp");
    expect(result.results[0].assumptions.join("\n")).toContain(
      "City interpreted",
    );
  });

  test("unknown adjacent zone is never discarded as harmless activity", () => {
    const result = convert(
      "August 19, 2026\n- 08:15 XYZ Morning briefing",
      options,
    );
    expect(result.results).toEqual([]);
    expect(result.warnings.join("\n")).toContain("Unknown timezone");
  });

  test("today retains actual calendar reference dependence", () => {
    const rows = convert("Today at midnight UTC", options).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].instant).toBe("2026-04-06T00:00:00Z");
    expect(rows[0].assumptions).toEqual(["Reference date used: 2026-04-06"]);
  });

  test("relative weekday preserves required reference and an accurate optional civil date disclosure", () => {
    const rows = convert("next Thursday at noon UTC", options).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].instant).toBe("2026-04-16T12:00:00Z");
    // Narrow DEVELOPMENT obligations; exact optional-label policy/order is open.
    const reference = "Reference date used: 2026-04-06";
    const optionalDate = "Date assumed: 2026-04-16";
    expect(rows[0].assumptions.filter((a) => a === reference)).toHaveLength(1);
    expect(
      rows[0].assumptions.filter((a) => a === optionalDate).length,
    ).toBeLessThanOrEqual(1);
    expect(
      rows[0].assumptions.every((a) => a === reference || a === optionalDate),
    ).toBe(true);
  });

  test("explicit quoted events survive fences and do not seed separate clocks", () => {
    const text =
      "> August 19, 2026 at noon UTC\n\n```text\nSeptember 21, 2026\n```\n09:25 UTC";
    const results = convert(text, options).results;
    const explicit = results.find((r) => r.original.includes("noon"));
    const independent = results.find((r) => r.original.includes("09:25 UTC"));
    expect(explicit?.instant).toBe("2026-08-19T12:00:00Z");
    expect(explicit?.assumptions).toEqual([]);
    expect(independent?.instant).toBe("2026-04-06T09:25:00Z");
    expect(independent?.assumptions).toEqual(fallback);
  });
});

describe("DEVELOPMENT host/source/target and complete DTO stability", () => {
  test("all independently frozen repair fixtures have target-independent full DTOs and repeated full DTO stability", () => {
    for (const fixture of fixtures.filter((f) =>
      f.name.startsWith("DEVELOPMENT #154/#155"),
    )) {
      const fOptions = {
        ...options,
        ...fixture,
        dateOrder: "mdy" as const,
        hourCycle: "24" as const,
      };
      const baseline = convert(fixture.text, {
        ...fOptions,
        targetZone: "UTC",
      });
      for (const targetZone of ["Pacific/Honolulu", "Asia/Tokyo", "+05:45"])
        expect(
          convert(fixture.text, { ...fOptions, targetZone }),
          fixture.name,
        ).toEqual(baseline);
      expect(
        convert(fixture.text, { ...fOptions, targetZone: "UTC" }),
        fixture.name,
      ).toEqual(baseline);
    }
  });

  for (const sourceZone of [
    "UTC",
    "America/Los_Angeles",
    "+05:45",
    "-03:30",
  ] as const)
    test(`stated date provenance and exact source choice: ${sourceZone}`, () => {
      const expected = {
        UTC: "2026-08-19T12:00:00Z",
        "America/Los_Angeles": "2026-08-19T19:00:00Z",
        "+05:45": "2026-08-19T06:15:00Z",
        "-03:30": "2026-08-19T15:30:00Z",
      }[sourceZone];
      const result = convert(
        `August 19, 2026 at noon ${sourceZone.startsWith("+") || sourceZone.startsWith("-") ? `UTC${sourceZone}` : sourceZone}`,
        { ...options, sourceZone },
      ).results;
      expect(result).toHaveLength(1);
      expect(result[0].instant).toBe(expected);
      expect(result[0].assumptions).toEqual([]);
    });

  test("omitted year and reference disclosure use source-local date across New Year", () => {
    const heading = "January 2\n- noon";
    const cases = [
      {
        sourceZone: "+05:45",
        now: "2026-12-31T22:30:00Z",
        instant: "2027-01-02T06:15:00Z",
        reference: "2027-01-01",
      },
      {
        sourceZone: "America/Los_Angeles",
        now: "2027-01-01T02:30:00Z",
        instant: "2027-01-02T20:00:00Z",
        reference: "2026-12-31",
      },
      {
        sourceZone: "-03:30",
        now: "2027-01-01T02:30:00Z",
        instant: "2027-01-02T15:30:00Z",
        reference: "2026-12-31",
      },
    ];
    for (const entry of cases)
      for (const targetZone of ["UTC", "Pacific/Honolulu", "Asia/Tokyo"]) {
        const result = convert(
          `${heading} ${entry.sourceZone.startsWith("+") || entry.sourceZone.startsWith("-") ? `UTC${entry.sourceZone}` : entry.sourceZone}`,
          { ...options, ...entry, targetZone },
        ).results;
        expect(result).toHaveLength(1);
        expect(result[0].instant).toBe(entry.instant);
        expect(result[0].assumptions).toEqual([
          "Date from message context: 2027-01-02",
          "Year assumed: 2027",
          `Reference date used: ${entry.reference}`,
        ]);
      }
  });
});
