import { describe, expect, test } from "bun:test";
import { collapseRepeatedAtomicRanges } from "../web/src/engine/range-dedup";
import type { TimeResult } from "../web/src/engine/types";

// Independent DTO examples exercise the public atomic inventory contract.
// These are invented inputs, not captured converter predictions.
function peer(
  rangeId: string,
  endpoint: "start" | "end",
  overrides: Partial<TimeResult> = {},
): TimeResult {
  return {
    id: `${rangeId}-${endpoint}`,
    group: `group-${rangeId}-${endpoint}`,
    rangeId,
    endpoint,
    original: `${rangeId} authored range`,
    sourceIndex: rangeId === "first" ? 12 : 80,
    instant:
      endpoint === "start" ? "2026-08-19T08:15:00Z" : "2026-08-19T09:25:00Z",
    sourceZone: "+00:00",
    sourceLabel: "UTC",
    assumptions: ["Date from message context: 2026-08-19"],
    occurrences: 1,
    ...overrides,
  };
}
function pair(rangeId: string, overrides: Partial<TimeResult> = {}) {
  return [peer(rangeId, "start", overrides), peer(rangeId, "end", overrides)];
}
function alternatives(
  rangeId: string,
  entries: Array<Partial<TimeResult> & { endInstant?: string }>,
) {
  return (["start", "end"] as const).flatMap((endpoint) =>
    entries.map(({ endInstant, ...entry }, index) =>
      peer(rangeId, endpoint, {
        ...entry,
        ...(endpoint === "end" && endInstant ? { instant: endInstant } : {}),
        id: `${rangeId}-${endpoint}-alternative-${index}`,
      }),
    ),
  );
}
function collapse(rows: readonly TimeResult[], ids = ["first", "second"]) {
  return collapseRepeatedAtomicRanges(rows, new Set(ids));
}
function point(overrides: Partial<TimeResult> = {}): TimeResult {
  const {
    endpoint: _endpoint,
    rangeId: _rangeId,
    ...row
  } = peer("point", "start");
  return {
    ...row,
    id: "independent-point",
    group: "point-group",
    sourceIndex: 45,
    ...overrides,
  };
}

describe("DEVELOPMENT #155 whole-range atomic inventory", () => {
  test("equal complete ranges retain every first-source identity and sum occurrences", () => {
    const first = pair("first", { occurrences: 2 });
    const second = pair("second", {
      occurrences: 3,
      original: "later spelling of the same range",
      assumptions: ["Later mention disclosure must not replace first"],
    });
    const rows = [...first, ...second];
    const before = structuredClone(rows);
    expect(collapse(rows)).toEqual(
      first.map((r) => ({ ...r, occurrences: 5 })),
    );
    expect(rows).toEqual(before);
    expect(collapse(rows)).toEqual(
      first.map((r) => ({ ...r, occurrences: 5 })),
    );
  });

  test("frozen DTO inputs are untouched and output mutation cannot change an input", () => {
    const rows = [...pair("first"), ...pair("second")];
    const before = structuredClone(rows);
    for (const row of rows) {
      Object.freeze(row.assumptions);
      Object.freeze(row);
    }
    Object.freeze(rows);
    const output = collapse(rows);
    expect(output).toEqual(
      before.slice(0, 2).map((r) => ({ ...r, occurrences: 2 })),
    );
    output[0].occurrences = 99;
    expect(rows).toEqual(before);
  });

  test("intervening point sharing an endpoint remains independent and positioned", () => {
    const first = pair("first"),
      standalone = point();
    expect(collapse([...first, standalone, ...pair("second")])).toEqual([
      ...first.map((r) => ({ ...r, occurrences: 2 })),
      standalone,
    ]);
  });

  test("first mention is chosen by literal source ordinal, never incoming array order", () => {
    const first = pair("first"),
      second = pair("second");
    expect(collapse([...second, ...first])).toEqual(
      first.map((r) => ({ ...r, occurrences: 2 })),
    );
  });

  for (const [name, endpoint, change] of [
    ["different end sharing start", "end", { instant: "2026-08-19T10:35:00Z" }],
    [
      "different start sharing end",
      "start",
      { instant: "2026-08-19T07:05:00Z" },
    ],
    ["second precision", "end", { instant: "2026-08-19T09:25:01Z" }],
    ["fractional precision", "start", { instant: "2026-08-19T08:15:00.001Z" }],
    ["different calendar day", "start", { instant: "2026-08-20T08:15:00Z" }],
    [
      "fixed and regional identity",
      "start",
      { sourceZone: "Atlantic/Reykjavik" },
    ],
    ["UTC and explicit zero identity", "start", { sourceZone: "UTC" }],
    ["different asserted label", "end", { sourceLabel: "GMT" }],
    [
      "different interpretation",
      "end",
      { interpretation: "different interpretation" },
    ],
    [
      "numeric date convention",
      "start",
      { numericDate: { date: "2026-08-19", order: "dmy" } },
    ],
  ] as const)
    test(`${name} preserves both inventories`, () => {
      const rows = [
        ...pair("first"),
        ...pair("second").map((r) =>
          r.endpoint === endpoint ? ({ ...r, ...change } as TimeResult) : r,
        ),
      ];
      expect(collapse(rows)).toEqual(rows);
    });

  test("date-only endpoints compare civil day as well as endpoint role", () => {
    const first = pair("first").map((r) => ({
      ...r,
      instant: undefined,
      dateOnly: r.endpoint === "start" ? "2026-08-19" : "2026-08-20",
    }));
    const second = pair("second").map((r) => ({
      ...r,
      instant: undefined,
      dateOnly: r.endpoint === "start" ? "2026-08-19" : "2026-08-21",
    }));
    expect(collapse([...first, ...second])).toEqual([...first, ...second]);
  });

  test("complete alternative inventories collapse corresponding peers together", () => {
    const inventory = (id: string) =>
      alternatives(id, [
        {
          interpretation: "US Central",
          sourceZone: "-06:00",
          sourceLabel: "CST",
        },
        {
          interpretation: "China Standard",
          sourceZone: "+08:00",
          sourceLabel: "CST",
          instant: "2026-08-19T00:15:00Z",
          endInstant: "2026-08-19T01:25:00Z",
        },
      ]);
    const first = inventory("first"),
      second = inventory("second");
    expect(collapse([...first, ...second])).toEqual(
      first.map((r) => ({ ...r, occurrences: 2 })),
    );
  });

  test("alternative multiplicity and order remain part of the whole inventory", () => {
    const first = alternatives("first", [
      { interpretation: "A" },
      { interpretation: "B", sourceZone: "+01:00" },
    ]);
    const reordered = alternatives("second", [
      { interpretation: "B", sourceZone: "+01:00" },
      { interpretation: "A" },
    ]);
    expect(collapse([...first, ...reordered])).toEqual([
      ...first,
      ...reordered,
    ]);
    const repeated = alternatives("second", [
      { interpretation: "A" },
      { interpretation: "A" },
      { interpretation: "B", sourceZone: "+01:00" },
    ]);
    expect(collapse([...first, ...repeated])).toEqual([...first, ...repeated]);
  });

  test("one missing alternative endpoint cannot collapse otherwise matching peers", () => {
    const complete = alternatives("first", [
      { interpretation: "A" },
      { interpretation: "B", sourceZone: "+01:00" },
    ]);
    const incomplete = alternatives("second", [
      { interpretation: "A" },
      { interpretation: "B", sourceZone: "+01:00" },
    ]).slice(0, -1);
    expect(collapse([...complete, ...incomplete])).toEqual([
      ...complete,
      ...incomplete,
    ]);
  });

  test("start-only, end-only and DST-gap missing endpoints remain independent", () => {
    for (const endpoint of ["start", "end"] as const) {
      const rows = [peer("first", endpoint), peer("second", endpoint)];
      expect(collapse(rows)).toEqual(rows);
    }
    const first = pair("first", { sourceZone: "America/New_York" });
    const gap = peer("second", "end", { sourceZone: "America/New_York" });
    expect(collapse([...first, gap])).toEqual([...first, gap]);
  });

  test("one-sided eligibility, empty identities and legacy ranges are unchanged", () => {
    const rows = [...pair("first"), ...pair("second")];
    expect(collapse(rows, [])).toEqual(rows);
    expect(collapse(rows, ["first"])).toEqual(rows);
    expect(collapse(rows, ["second"])).toEqual(rows);
    const noIdentity = rows.map((r) => ({ ...r, rangeId: "" }));
    expect(collapse(noIdentity, [""])).toEqual(noIdentity);
  });

  test("endpoint-free rows bearing malformed range identity cannot erase genuine ranges", () => {
    const first = pair("first"),
      malformed = pair("second").map((r) => ({ ...r, endpoint: undefined }));
    expect(collapse([...first, ...malformed])).toEqual([
      ...first,
      ...malformed,
    ]);
  });

  for (const kind of ["duplicate id", "shared endpoint group"] as const)
    test(`invalid ${kind} remains protected after positive DTO correction`, () => {
      const first = pair("first"),
        second = pair("second");
      second[1] = {
        ...second[1],
        ...(kind === "duplicate id"
          ? { id: second[0].id }
          : { group: second[0].group }),
      };
      const rows = [...first, ...second];
      expect(collapse(rows)).toEqual(rows);
    });

  for (const field of ["sourceIndex", "original"] as const)
    test(`inconsistent alternative ${field} remains protected`, () => {
      const inventory = (id: string) =>
        alternatives(id, [
          { interpretation: "A" },
          { interpretation: "B", sourceZone: "+01:00" },
        ]);
      const first = inventory("first"),
        second = inventory("second");
      second[1] = {
        ...second[1],
        ...(field === "sourceIndex"
          ? { sourceIndex: 81 }
          : { original: "different literal source" }),
      };
      const rows = [...first, ...second];
      expect(collapse(rows)).toEqual(rows);
    });
});
