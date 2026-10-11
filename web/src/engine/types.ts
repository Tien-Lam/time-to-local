export interface ConversionOptions {
  now?: string;
  sourceZone: string;
  targetZone: string;
  referenceDate?: string;
  dateOrder?: "mdy" | "dmy";
  locale?: string;
  hourCycle?: "auto" | "12" | "24";
}

export interface TimeResult {
  id: string;
  group: string;
  original: string;
  sourceIndex: number;
  endpoint?: "start" | "end";
  /** Shared only by endpoints parsed as one range, never inferred by the UI. */
  rangeId?: string;
  numericDate?: { date: string; order: "mdy" | "dmy" };
  instant?: string;
  dateOnly?: string;
  sourceZone: string;
  sourceLabel: string;
  interpretation?: string;
  assumptions: string[];
  occurrences: number;
}

export interface Conversion {
  results: TimeResult[];
  warnings: string[];
}

export interface DisplayTime {
  time: string;
  date: string;
  zone: string;
  dateShift: number;
}
