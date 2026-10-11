import { expect, test } from "bun:test";
import { convert } from "../web/src/engine/convert";
import {
  copyRangeText,
  rangePair,
  referenceSummary,
  resultGroups,
  resultSummary,
  sourceDescription,
} from "../web/src/engine/presentation";
import type { ConversionOptions } from "../web/src/engine/types";
const options: ConversionOptions = {
  now: "2026-04-06T12:00:00Z",
  sourceZone: "UTC",
  targetZone: "UTC",
  hourCycle: "24",
  locale: "en-AU",
  dateOrder: "mdy",
};

test("overlapping ranges keep both shared endpoints and their own copy context", () => {
  const result = convert(
    "April 9, 2026 9am-11am UTC; April 9, 2026 10am-11am UTC",
    options,
  );
  expect(result.results.map((entry) => entry.instant)).toEqual([
    "2026-04-09T09:00:00Z",
    "2026-04-09T11:00:00Z",
    "2026-04-09T10:00:00Z",
    "2026-04-09T11:00:00Z",
  ]);
  const groups = resultGroups(result.results);
  expect(resultSummary(groups)).toBe("2 ranges converted");
  expect(groups).toHaveLength(2);
  expect(copyRangeText(rangePair(groups[0])!, options).split("\n")[0]).toBe(
    "09:00–11:00 · Thu, 9 Apr 2026 · UTC",
  );
  expect(copyRangeText(rangePair(groups[1])!, options).split("\n")[0]).toBe(
    "10:00–11:00 · Thu, 9 Apr 2026 · UTC",
  );
});
test("range copy retains endpoint dates and both zones across DST", () => {
  const pair = rangePair(
    resultGroups(
      convert("March 8, 2026 1am-4am in New York", options).results,
    )[0],
  )!;
  expect(pair.map((entry) => entry.instant)).toEqual([
    "2026-03-08T06:00:00Z",
    "2026-03-08T08:00:00Z",
  ]);
  const copied = copyRangeText(pair, {
    ...options,
    targetZone: "America/New_York",
  });
  expect(copied.split("\n")[0]).toBe(
    "01:00 · Sun, 8 Mar 2026 · UTC-05:00 New York → 04:00 · Sun, 8 Mar 2026 · UTC-04:00 New York",
  );
  const overnight = rangePair(
    resultGroups(convert("April 9, 2026 11pm-1am UTC", options).results)[0],
  )!;
  expect(copyRangeText(overnight, options).split("\n")[0]).toBe(
    "23:00 · Thu, 9 Apr 2026 · UTC → 01:00 · Fri, 10 Apr 2026 · UTC",
  );
});
test("ambiguous endpoints cannot become an invented copyable interval", () => {
  const groups = resultGroups(
    convert("April 9, 2026 9am-11am CST", options).results,
  );
  expect(groups).toHaveLength(1);
  expect(groups[0].entries.map((entry) => entry.instant)).toEqual([
    "2026-04-09T15:00:00Z",
    "2026-04-09T01:00:00Z",
    "2026-04-09T17:00:00Z",
    "2026-04-09T03:00:00Z",
  ]);
  expect(resultSummary(groups)).toBe("1 range · choose an interpretation");
  expect(rangePair(groups[0])).toBeUndefined();
});
test("independent times stay independent and DST-fold labels retain source and offset", () => {
  const groups = resultGroups(
    convert("November 1, 2026 1:30am in New York", options).results,
  );
  expect(resultSummary(groups)).toBe("1 time · choose an interpretation");
  expect(sourceDescription(groups[0].entries[0])).toBe(
    "New York · First occurrence (clocks move back) · UTC-04:00",
  );
  expect(sourceDescription(groups[0].entries[1])).toBe(
    "New York · Second occurrence (clocks move back) · UTC-05:00",
  );
  expect(
    resultSummary(
      resultGroups(
        convert("April 9, 2026 3pm UTC\nApril 10, 2026 9am in Tokyo", options)
          .results,
      ),
    ),
  ).toBe("2 times converted");
});
test("numeric date provenance follows selected message date order without labeling ISO timestamps", () => {
  for (const [order, date, instant] of [
    ["mdy", "2026-04-09", "2026-04-09T15:00:00Z"],
    ["dmy", "2026-09-04", "2026-09-04T15:00:00Z"],
  ] as const) {
    const result = convert("04/09/2026 3pm UTC", {
      ...options,
      dateOrder: order,
    }).results[0];
    expect(result.instant).toBe(instant);
    expect(result.numericDate).toEqual({ date, order });
  }
  expect(
    convert("2026-04-09T15:00:00Z", options).results[0].numericDate,
  ).toBeUndefined();
});
test("DST gap recovery respects explicit message-zone precedence", () => {
  const text = "March 8, 2026 2:30am in New York";
  for (const sourceZone of ["UTC", "Asia/Tokyo"]) {
    const result = convert(text, { ...options, sourceZone });
    expect(result.results).toEqual([]);
    expect(result.warnings[0]).toBe(
      "2026-03-08 02:30:00 doesn't exist in New York because the clocks move forward. Edit the time or timezone in your message.",
    );
  }
  expect(
    convert("March 8, 2026 2:30am", {
      ...options,
      sourceZone: "America/New_York",
    }).warnings[0],
  ).toContain("change Source timezone in Message interpretation");
});
test("reference summary explains the source-local day", () => {
  const result = convert("Tomorrow at 3pm PT", {
    ...options,
    now: "2026-10-11T00:30:00Z",
  }).results[0];
  expect(result.instant).toBe("2026-10-11T22:00:00Z");
  expect(referenceSummary(result, "en-AU")).toBe(
    "Reference: Sat, 10 Oct 2026 in Los Angeles",
  );
});
