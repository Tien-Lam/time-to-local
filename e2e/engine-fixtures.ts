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
    if (f.rangeIds !== undefined)
      expect(
        output.conversion.results.map((r: any) => r.rangeId),
        f.name,
      ).toEqual(f.rangeIds.map((id) => id ?? undefined));
    if (f.interpretations !== undefined)
      expect(
        output.conversion.results.map((r: any) => r.interpretation),
        f.name,
      ).toEqual(f.interpretations.map((value) => value ?? undefined));
    if ("assumption" in f)
      expect(
        output.conversion.results.flatMap((r: any) => r.assumptions).join("\n"),
        f.name,
      ).toContain(f.assumption!);
    if ("occurrences" in f)
      expect(output.conversion.results[0].occurrences, f.name).toBe(
        f.occurrences!,
      );
    if ("warning" in f)
      expect(output.conversion.warnings.join("\n"), f.name).toContain(
        f.warning!,
      );
    else expect(output.conversion.warnings, f.name).toEqual([]);
  }
}
