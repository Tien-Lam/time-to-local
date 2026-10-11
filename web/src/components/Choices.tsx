import { ResizeSafePopover } from "./ResizeSafePopover";
import { useMemo, useRef, useState } from "react";
import {
  Select,
  SelectValue,
  Button,
  ListBox,
  ListBoxItem,
  Text,
} from "react-aria-components/Select";
import { Input } from "./ui/Input";
import { ControlIcon } from "./ui/ControlIcon";
import { ComboBox } from "react-aria-components/ComboBox";
import { Group } from "react-aria-components/Group";
import {
  AMBIGUOUS,
  cityAliases,
  offsetZone,
  resolveCity,
  zoneIds,
  zoneName,
} from "../engine/zones";
import { diagnostic } from "../platform/diagnostics";

type Option = { id: string; label: string; description?: string };
type ChoiceProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
};
export function Chevron() {
  return <ControlIcon name="chevron" />;
}
function ChoiceItems({
  options,
  byValue = false,
  emptyMessage = "No matches. Try a city, timezone or UTC offset.",
}: {
  options: Option[];
  byValue?: boolean;
  emptyMessage?: string;
}) {
  return (
    <ListBox
      className="choice-list"
      items={options}
      // A suggestion appearing under the pointer must not become the value
      // committed by Tab. Arrow navigation and option presses still select.
      shouldFocusOnHover={byValue ? false : undefined}
      renderEmptyState={() => (
        <div className="choice-empty">{emptyMessage}</div>
      )}
    >
      {(item) => (
        <ListBoxItem
          id={item.id}
          textValue={byValue ? item.id : item.label}
          data-value={item.id}
          className="choice-item"
        >
          <div className="choice-item-text">
            <Text slot="label">{item.label}</Text>
            {item.description && (
              <Text slot="description">{item.description}</Text>
            )}
          </div>
          <ControlIcon name="check" className="choice-check" />
        </ListBoxItem>
      )}
    </ListBox>
  );
}
export function ChoiceSelect({
  id,
  label,
  value,
  onChange,
  options,
  describedBy,
}: ChoiceProps & { options: Option[]; describedBy?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Select
      className="choice-select"
      isOpen={open}
      onOpenChange={setOpen}
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      onChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <Button
        id={id}
        aria-label={label}
        data-value={value}
        className="choice-trigger"
      >
        <SelectValue>
          {options.find((option) => option.id === value)?.label}
        </SelectValue>
        <Chevron />
      </Button>
      <ResizeSafePopover
        className="choice-popover"
        inert={!open}
        aria-hidden={!open}
        placement="bottom start"
        offset={8}
        containerPadding={12}
      >
        <ChoiceItems options={options} />
      </ResizeSafePopover>
    </Select>
  );
}

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replaceAll("_", " ")
    .trim();
const zoneLabels = new Set(zoneIds.map((zone) => normalize(zoneName(zone))));
const timezoneOptions: Option[] = [
  { id: "UTC", label: "UTC" },
  ...zoneIds
    .filter((zone) => zone !== "UTC")
    .map((zone) => ({ id: zone, label: zoneName(zone), description: zone })),
  ...cityAliases
    .filter((city) => !zoneLabels.has(normalize(city)))
    .map((city) => ({
      id: city,
      label:
        city.length <= 3
          ? city.toUpperCase()
          : city.replace(/\b\w/g, (c) => c.toUpperCase()),
      description: resolveCity(city).zones[0],
    })),
];
// Abbreviations denote fixed offsets; choosing a regional city would silently
// replace their meaning in summer. Require an explicit choice of fixed offset.
for (const [abbreviation, meanings] of Object.entries(AMBIGUOUS)) {
  for (const [minutes, meaning] of meanings) {
    const id = offsetZone(minutes);
    const existing = timezoneOptions.find((option) => option.id === id);
    if (existing) existing.description += ` · ${abbreviation}: ${meaning}`;
    else
      timezoneOptions.push({
        id,
        label: `UTC${id}`,
        description: `${abbreviation}: ${meaning} · fixed offset`,
      });
  }
}
const searchText = new Map(
  timezoneOptions.map((option) => [
    option.id,
    normalize(`${option.id} ${option.label} ${option.description || ""}`),
  ]),
);
const optionIds = new Set(timezoneOptions.map((option) => option.id));

export function ZoneChoice({
  id,
  label,
  value,
  onChange,
  placeholder,
  describedBy,
  invalid,
  triggerLabel,
}: ChoiceProps & {
  placeholder: string;
  describedBy?: string;
  invalid?: boolean;
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // React Aria builds ListBox collections even while their popovers are closed.
  // Keep the selected item available for first keyboard focus. Populate the full
  // collection on first opening and retain it through dismissal and exit.
  const [choicesLoaded, setChoicesLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const selectedOptions = useMemo(
    () => timezoneOptions.filter((option) => option.id === value),
    [value],
  );
  const options = choicesLoaded ? timezoneOptions : selectedOptions;
  const displayValue =
    !editing && selectedOptions.length ? selectedOptions[0].label : value;
  const current = useRef(value);
  current.current = value;
  const commit = (next: string) => {
    if (next !== current.current) {
      current.current = next;
      onChange(next);
    }
  };
  const ambiguous = Object.hasOwn(AMBIGUOUS, value.trim().toUpperCase());
  return (
    <ComboBox
      className="choice-combo"
      onOpenChange={(next) => {
        if (next) setChoicesLoaded(true);
        setOpen(next);
      }}
      aria-label={label}
      inputValue={displayValue}
      onInputChange={(next) => {
        if (next !== displayValue) commit(next);
      }}
      value={optionIds.has(value) ? value : null}
      onChange={(key) => {
        if (key !== null) commit(String(key));
      }}
      defaultItems={options}
      defaultFilter={(text, query) =>
        (searchText.get(text) || normalize(text)).includes(normalize(query))
      }
      allowsCustomValue
      allowsEmptyCollection
      isInvalid={invalid}
      validationBehavior="aria"
    >
      <Group className="choice-control">
        <Input
          id={id}
          placeholder={placeholder}
          aria-describedby={describedBy}
          autoComplete="off"
          onFocus={() => {
            setEditing(true);
            diagnostic("ui.zone-focus", {
              field: id === "target-zone" ? "target-zone" : "source-zone",
            });
          }}
          onBlur={() => setEditing(false)}
        />
        <Button
          className="choice-toggle"
          aria-label={triggerLabel}
          onPress={() =>
            diagnostic("ui.zone-open", {
              field: id === "target-zone" ? "target-zone" : "source-zone",
            })
          }
        >
          <Chevron />
        </Button>
      </Group>
      <ResizeSafePopover
        className="choice-popover"
        inert={!open}
        aria-hidden={!open}
        placement="bottom start"
        offset={8}
        containerPadding={12}
        isNonModal
      >
        {ambiguous && (
          <p className="choice-guidance">
            {value.trim().toUpperCase()} has multiple meanings. Choose a fixed
            offset below, or search for the sender’s city. Regional cities
            account for daylight saving time.
          </p>
        )}
        <ChoiceItems options={options} byValue />
      </ResizeSafePopover>
    </ComboBox>
  );
}
