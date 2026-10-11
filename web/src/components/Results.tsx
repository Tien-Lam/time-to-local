import { ActionButton } from "./ui/ActionButton";
import { ControlIcon } from "./ui/ControlIcon";
import { formatResult, rangeLabel } from "../engine/time";
import {
  assumptionSummary,
  humanDate,
  rangePair,
  referenceSummary,
  sourceDescription,
} from "../engine/presentation";
import type { ResultGroup } from "../engine/presentation";
import type { ConversionOptions, TimeResult } from "../engine/types";

type CopyState = { id: string; state: "success" | "failure" } | undefined;

function CopyFeedback({
  id,
  state,
  label = "Copy",
}: {
  id: string;
  state: CopyState;
  label?: string;
}) {
  return state?.id === id && state.state === "success" ? (
    <>
      <ControlIcon name="check" className="copy-check" size="1em" /> Copied
    </>
  ) : state?.id === id && state.state === "failure" ? (
    "Retry"
  ) : (
    label
  );
}

export function ResultCard({
  group,
  options,
  copyState,
  onCopy,
  onCopyRange,
  onInterpret,
}: {
  group: ResultGroup;
  options: ConversionOptions;
  copyState: CopyState;
  onCopy: (result: TimeResult) => void;
  onCopyRange: (pair: [TimeResult, TimeResult], id: string) => void;
  onInterpret: (field: "date-order" | "reference-date") => void;
}) {
  const pair = rangePair(group);
  const rangeId = `copy-${group.id}`;
  const originals = [...new Set(group.entries.map((entry) => entry.original))];
  const alternatives = Math.max(
    ...group.entries.map(
      (entry) =>
        group.entries.filter((item) => item.group === entry.group).length,
    ),
  );
  return (
    <>
      {group.ambiguous && (
        <div className="interpretation-warning warning">
          <strong className="ambiguity">
            {alternatives} possible interpretations
          </strong>
          <p>
            Choose an interpretation. Confirm the sender’s timezone
            {group.entries.some((entry) =>
              entry.interpretation?.includes("clocks move back"),
            )
              ? " and which occurrence they mean"
              : ""}{" "}
            before copying.
          </p>
        </div>
      )}
      {pair && (
        <div className="range-heading">
          <strong>Time range</strong>
          <ActionButton
            type="button"
            variant="primary"
            className="range-copy"
            data-copy-state={
              copyState?.id === rangeId ? copyState.state : "idle"
            }
            aria-label={`Copy range ${pair
              .map((entry) => {
                const d = formatResult(entry, options);
                return `${d.time} · ${d.date} · ${d.zone}`;
              })
              .join(" to ")}`}
            onPress={() => onCopyRange(pair, rangeId)}
          >
            <CopyFeedback id={rangeId} state={copyState} label="Copy range" />
          </ActionButton>
        </div>
      )}
      <div className={pair ? "range-endpoints" : undefined}>
        {group.entries.map((result) => {
          const d = formatResult(result, options);
          const range = rangeLabel(result);
          const reference = referenceSummary(result, options.locale || "en-AU");
          return (
            <div className="result" key={result.id}>
              <div className="result-context">
                <p>
                  From{" "}
                  <span className="source-label">{result.sourceLabel}</span>
                  {result.interpretation && (
                    <span className="occurrence-label">
                      {" "}
                      ·{" "}
                      {sourceDescription(result).slice(
                        result.sourceLabel.length + 3,
                      )}
                    </span>
                  )}
                </p>
              </div>
              {result.numericDate && (
                <div className="numeric-interpretation">
                  <p>
                    Read as{" "}
                    {humanDate(result.numericDate.date, options.locale, true)} ·{" "}
                    {result.numericDate.order === "mdy"
                      ? "Month/day"
                      : "Day/month"}
                  </p>
                  <ActionButton
                    type="button"
                    className="text-button"
                    onPress={() => onInterpret("date-order")}
                  >
                    Change date order
                  </ActionButton>
                </div>
              )}
              <div
                className="result-top"
                data-precision={/\d:\d{2}:\d{2}/.test(d.time)}
              >
                <div className="result-output">
                  {range && <p className="range-label">{range}</p>}
                  {d.time && (
                    <div className="hero-time">
                      {d.time
                        .split(/(\s+[ap]m)$/i)
                        .filter(Boolean)
                        .map((part, index) => (
                          <span
                            className={
                              index === 0 ? "time-number" : "clock-suffix"
                            }
                            key={index}
                          >
                            {part}
                          </span>
                        ))}
                    </div>
                  )}
                  <p
                    className={`result-date${result.dateOnly ? " hero-date" : ""}`}
                  >
                    {d.date}
                  </p>
                  <p className="result-zone">
                    {d.zone}
                    {d.dateShift !== 0 && (
                      <span className="day-shift">
                        {d.dateShift > 0 ? "+" : ""}
                        {d.dateShift} day
                        {Math.abs(d.dateShift) !== 1 ? "s" : ""}
                      </span>
                    )}
                  </p>
                </div>
                <ActionButton
                  type="button"
                  variant={pair ? "outline" : "primary"}
                  className={pair ? "copy-button endpoint-copy" : undefined}
                  data-copy-state={
                    copyState?.id === result.id ? copyState.state : "idle"
                  }
                  aria-label={`Copy ${range ? range + ": " : ""}${d.time ? d.time + " · " : ""}${d.date} · ${d.zone} · ${sourceDescription(result)}`}
                  onPress={() => onCopy(result)}
                >
                  <CopyFeedback
                    id={result.id}
                    state={copyState}
                    label={
                      pair
                        ? `Copy ${range.toLowerCase()}`
                        : group.ambiguous
                          ? "Copy this"
                          : "Copy"
                    }
                  />
                </ActionButton>
              </div>
              {result.dateOnly && (
                <p className="assumption">
                  A date without a time cannot be shifted between timezones.
                </p>
              )}
              {reference && (
                <div className="reference-summary">
                  <p>{reference}</p>
                  <ActionButton
                    type="button"
                    className="text-button"
                    onPress={() => onInterpret("reference-date")}
                  >
                    Change reference date
                  </ActionButton>
                </div>
              )}
              {result.assumptions.length > 0 && (
                <details className="provenance">
                  <summary>
                    {assumptionSummary(result, options.locale || "en-AU")}
                  </summary>
                  {result.assumptions.map((value) => (
                    <p className="assumption" key={value}>
                      {value}
                    </p>
                  ))}
                </details>
              )}
              {result.occurrences > 1 && (
                <p className="assumption">
                  Mentioned {result.occurrences} times
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="result-source">
        {originals.map((original) => (
          <p key={original}>Original: “{original}”</p>
        ))}
      </div>
    </>
  );
}
