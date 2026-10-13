import type { ReactNode } from "react";

export type IndicatorState =
  "idle" | "ready" | "pending" | "paused" | "warning" | "ambiguous" | "error";

/** Visual state and caller-owned wording; live announcements remain with App. */
export function StatusIndicator({
  state,
  children,
}: {
  state: IndicatorState;
  children: ReactNode;
}) {
  return (
    <span className="live-indicator" data-state={state}>
      {children}
    </span>
  );
}
