import type { TimeResult } from "./types";

export type AuthoredClockPrecision =
  "hour" | "minute" | "second" | `fraction/${1 | 2 | 3 | 4 | 5 | 6}`;
type IndexedRow = {
  row: TimeResult;
  index: number;
  precision?: AuthoredClockPrecision;
};
type AtomicRange = { rows: IndexedRow[]; occurrences: number };

/** Compare resolved meaning, keeping mention identity and disclosures separate. */
function peerSignature(
  row: TimeResult,
  precision: AuthoredClockPrecision,
): string {
  return JSON.stringify([
    row.endpoint,
    precision,
    row.instant ?? null,
    row.dateOnly ?? null,
    row.sourceZone,
    row.sourceLabel,
    row.interpretation ?? null,
    row.numericDate ? [row.numericDate.date, row.numericDate.order] : null,
  ]);
}

/** A partial or inconsistent peer inventory must never become a duplicate. */
function completeRange(rows: IndexedRow[]): AtomicRange | undefined {
  const ordered = [...rows].sort(
    (a, b) => a.row.sourceIndex - b.row.sourceIndex || a.index - b.index,
  );
  const occurrences = ordered[0].row.occurrences;
  if (!Number.isSafeInteger(occurrences) || occurrences < 1) return;

  const sources = new Map<string, string>();
  const signatures = new Set<string>();
  const ids = new Set<string>();
  const groupEndpoints = new Map<string, string>();
  const endpointPrecisions = new Map<string, AuthoredClockPrecision>();
  let start = false,
    end = false;
  for (const { row, precision } of ordered) {
    if (
      !precision ||
      !/^(?:hour|minute|second|fraction\/[1-6])$/.test(precision) ||
      (row.endpoint !== "start" && row.endpoint !== "end") ||
      !row.id ||
      ids.has(row.id) ||
      !row.group ||
      !row.original ||
      !Number.isInteger(row.sourceIndex) ||
      row.sourceIndex < 0 ||
      !row.sourceZone ||
      !row.sourceLabel ||
      !!row.instant === !!row.dateOnly ||
      row.occurrences !== occurrences
    )
      return;
    ids.add(row.id);
    const groupEndpoint = groupEndpoints.get(row.group);
    if (groupEndpoint !== undefined && groupEndpoint !== row.endpoint) return;
    groupEndpoints.set(row.group, row.endpoint);

    if (row.endpoint === "start") {
      if (end) return;
      start = true;
    } else end = true;

    // Alternatives of one endpoint describe the same literal source owner.
    const source = JSON.stringify([row.sourceIndex, row.original, row.group]);
    const previous = sources.get(row.endpoint);
    if (previous !== undefined && previous !== source) return;
    sources.set(row.endpoint, source);

    const previousPrecision = endpointPrecisions.get(row.endpoint);
    if (previousPrecision !== undefined && previousPrecision !== precision)
      return;
    endpointPrecisions.set(row.endpoint, precision);

    const signature = peerSignature(row, precision);
    if (signatures.has(signature)) return;
    signatures.add(signature);
  }
  if (!start || !end) return;
  return { rows: ordered, occurrences };
}

/**
 * Collapse only complete repeated ranges whose IDs the converter has established
 * as eligible bounded owners. Match the entire ordered peer inventory, never
 * individual endpoints. Protected rows and their relative order stay unchanged;
 * retained range rows keep the earliest source's complete presentation metadata.
 * Neither the input array nor any input row is mutated.
 * Private metadata uses exact row object identities. Missing/unknown precision
 * or inconsistent endpoint alternatives protect the entire range inventory.
 */
export function collapseRepeatedAtomicRanges(
  rows: readonly TimeResult[],
  eligibleRangeIds: ReadonlySet<string>,
  authoredPrecision?: ReadonlyMap<TimeResult, AuthoredClockPrecision>,
): TimeResult[] {
  const byRange = new Map<string, IndexedRow[]>();
  rows.forEach((row, index) => {
    if (!row.rangeId || !eligibleRangeIds.has(row.rangeId)) return;
    const peers = byRange.get(row.rangeId);
    const indexed = { row, index, precision: authoredPrecision?.get(row) };
    if (peers) peers.push(indexed);
    else byRange.set(row.rangeId, [indexed]);
  });

  const ranges: AtomicRange[] = [];
  for (const peers of byRange.values()) {
    const range = completeRange(peers);
    if (range) ranges.push(range);
  }
  ranges.sort(
    (a, b) =>
      a.rows[0].row.sourceIndex - b.rows[0].row.sourceIndex ||
      a.rows[0].index - b.rows[0].index,
  );

  const duplicates = new Map<string, AtomicRange[]>();
  for (const range of ranges) {
    const signature = JSON.stringify(
      range.rows.map(({ row, precision }) => peerSignature(row, precision!)),
    );
    const matching = duplicates.get(signature);
    if (matching) matching.push(range);
    else duplicates.set(signature, [range]);
  }

  const replacements = new Map<number, TimeResult>();
  const removed = new Set<number>();
  for (const matching of duplicates.values()) {
    if (matching.length < 2) continue;
    const occurrences = matching.reduce(
      (total, range) => total + range.occurrences,
      0,
    );
    // Keep the whole inventory unchanged if its occurrence sum is unsafe.
    if (!Number.isSafeInteger(occurrences)) continue;
    const first = matching[0];
    for (const { row, index } of first.rows)
      replacements.set(index, { ...row, occurrences });
    for (const range of matching.slice(1))
      for (const { index } of range.rows) removed.add(index);
  }

  return rows.flatMap((row, index) =>
    removed.has(index) ? [] : [replacements.get(index) ?? row],
  );
}
