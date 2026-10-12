import type { TimeResult } from "./types";

type IndexedRow = { row: TimeResult; index: number };
type AtomicRange = { rows: IndexedRow[]; occurrences: number };

/** Compare resolved meaning, keeping mention identity and disclosures separate. */
function peerSignature(row: TimeResult): string {
  return JSON.stringify([
    row.endpoint,
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
  let start = false,
    end = false;
  for (const { row } of ordered) {
    if (
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

    const signature = peerSignature(row);
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
 */
export function collapseRepeatedAtomicRanges(
  rows: readonly TimeResult[],
  eligibleRangeIds: ReadonlySet<string>,
): TimeResult[] {
  const byRange = new Map<string, IndexedRow[]>();
  rows.forEach((row, index) => {
    if (!row.rangeId || !eligibleRangeIds.has(row.rangeId)) return;
    const peers = byRange.get(row.rangeId);
    if (peers) peers.push({ row, index });
    else byRange.set(row.rangeId, [{ row, index }]);
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
      range.rows.map(({ row }) => peerSignature(row)),
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
