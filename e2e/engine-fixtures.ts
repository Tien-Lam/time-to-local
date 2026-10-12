import { expect, type Page } from "@playwright/test";
import { readdir } from "node:fs/promises";
import fixtures from "../tests/fixtures/temporal.json";
export async function verifyProductionFixtures(page: Page) {
  const asset = (await readdir("dist/assets")).find((name) =>
    /^worker-.*\.js$/.test(name),
  )!;
  const outputs = await page.evaluate(
    async ({ asset, fixtures }) => {
      const worker = new Worker(`/assets/${asset}`, { type: "module" }),
        outputs: any[] = [];
      try {
        for (let i = 0; i < fixtures.length; i++) {
          const f = fixtures[i];
          const response = await new Promise<any>((resolve, reject) => {
            worker.onmessage = (e) => resolve(e.data);
            worker.onerror = reject;
            worker.postMessage({
              id: i,
              text: f.text,
              options: {
                now: "2026-04-06T12:00:00Z",
                sourceZone: "UTC",
                targetZone: "Australia/Sydney",
                locale: "en-AU",
                hourCycle: "24",
                dateOrder: "mdy",
                ...f,
              },
            });
          });
          outputs.push(response);
        }
        return outputs;
      } finally {
        worker.terminate();
      }
    },
    { asset, fixtures },
  );
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i],
      output = outputs[i];
    expect(output.error, f.name).toBeUndefined();
    expect(
      output.conversion.results.flatMap((r: any) =>
        r.instant ? [r.instant] : [],
      ),
      f.name,
    ).toEqual(f.instants);
    expect(
      output.conversion.results.flatMap((r: any) =>
        r.dateOnly ? [r.dateOnly] : [],
      ),
      f.name,
    ).toEqual(("dates" in f ? f.dates : []) || []);
    if ("endpoints" in f)
      expect(
        output.conversion.results.map((r: any) => String(r.endpoint)),
        f.name,
      ).toEqual(f.endpoints);
    if ("sourceIndices" in f)
      expect(
        output.conversion.results.map((r: any) => r.sourceIndex),
        f.name,
      ).toEqual(f.sourceIndices);
    if ("originals" in f)
      expect(
        output.conversion.results.map((r: any) => r.original),
        f.name,
      ).toEqual(f.originals);
    if ("assumptions" in f)
      expect(
        output.conversion.results.map((r: any) => r.assumptions),
        f.name,
      ).toEqual(f.assumptions);
    if ("sourceZones" in f)
      expect(
        output.conversion.results.map((r: any) => r.sourceZone),
        f.name,
      ).toEqual(f.sourceZones);
    if ("rangeIds" in f)
      expect(
        output.conversion.results.map((r: any) => r.rangeId ?? null),
        f.name,
      ).toEqual(f.rangeIds);
    if ("cardinality" in f)
      expect(output.conversion.results, f.name).toHaveLength(f.cardinality!);
    if ("sourceLabels" in f)
      expect(
        output.conversion.results.map((r: any) => r.sourceLabel),
        f.name,
      ).toEqual(f.sourceLabels);
    if ("rowOccurrences" in f)
      expect(
        output.conversion.results.map((r: any) => r.occurrences),
        f.name,
      ).toEqual(f.rowOccurrences);
    if (f.interpretations !== undefined)
      for (let n = 0; n < f.interpretations.length; n++) {
        const interpretation = f.interpretations[n];
        if (interpretation === null)
          expect(
            output.conversion.results[n].interpretation,
            f.name,
          ).toBeUndefined();
        else
          expect(output.conversion.results[n].interpretation, f.name).toContain(
            interpretation,
          );
      }
    if (f.sourceCores !== undefined && f.sourceBounds !== undefined)
      for (let n = 0; n < f.sourceCores.length; n++) {
        const row = output.conversion.results[n],
          bounds = f.sourceBounds[n];
        expect(row.original, f.name).toContain(f.sourceCores[n]);
        expect(row.original, f.name).toBe(
          f.text.slice(row.sourceIndex, row.sourceIndex + row.original.length),
        );
        expect(row.sourceIndex, f.name).toBeGreaterThanOrEqual(bounds.start);
        expect(
          row.sourceIndex + row.original.length,
          f.name,
        ).toBeLessThanOrEqual(bounds.end);
      }
    if ("warning" in f)
      expect(output.conversion.warnings.join("\n"), f.name).toContain(
        f.warning!,
      );
    else expect(output.conversion.warnings, f.name).toEqual([]);
  }
}
