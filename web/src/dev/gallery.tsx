import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { TextField } from "react-aria-components/TextField";
import { Label } from "react-aria-components/Label";
import { Text } from "react-aria-components/Text";
import App from "../App";
import { ActionButton } from "../components/ui/ActionButton";
import { ControlIcon } from "../components/ui/ControlIcon";
import { Input } from "../components/ui/Input";
import { ChoiceSelect, ZoneChoice } from "../components/Choices";
import { DateChoice } from "../components/DateChoice";
import { Disclosure } from "../components/Disclosure";
import { useTouchFeedback } from "../components/useTouchFeedback";
import "../style.css";
import "./gallery.css";

const query = new URLSearchParams(location.search);
const theme = query.get("theme") === "light" ? "light" : "dark";
const fault = query.get("fault");
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.design =
  query.get("design") === "aqua" ? "aqua" : "command";

function Icon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
    >
      <path d="M10 3v14M3 10h14" />
    </svg>
  );
}
function Gallery() {
  useTouchFeedback();
  const [presses, setPresses] = useState(0);
  const [open, setOpen] = useState(true);
  const [zone, setZone] = useState("UTC");
  const [date, setDate] = useState("2026-04-09");
  const [format, setFormat] = useState("24");
  const [outcome, setOutcome] = useState("idle");
  return (
    <main
      className={`gallery ${fault === "groups" ? "fault-groups" : ""}`}
      data-gallery="local-development-only"
    >
      <header>
        <h1>Time to Local control gallery</h1>
        <p>Local deterministic fixtures · {theme}</p>
      </header>
      <section aria-label="Shared actions" className="gallery-card">
        <h2>Shared actions</h2>
        <div className="gallery-row" data-testid="quiet-row">
          <ActionButton
            data-testid="paste"
            className={fault === "paste" ? "fault-paste" : undefined}
            onPress={() => setPresses((v) => v + 1)}
          >
            Paste
          </ActionButton>
          <ActionButton className="muted">Clear</ActionButton>
          <ActionButton variant="outline">
            <Icon /> Text and icon
          </ActionButton>
          <ActionButton
            variant="iconAction"
            aria-label={fault === "name" ? undefined : "Add example"}
          >
            <Icon />
          </ActionButton>
        </div>
        <p role="status">Actions committed: {presses}</p>
        <div className="gallery-row">
          <ActionButton variant="primary">Copy</ActionButton>
          <ActionButton isDisabled onPress={() => setPresses((v) => v + 1)}>
            Disabled
          </ActionButton>
          <ActionButton
            variant="primary"
            isPending
            onPress={() => setPresses((v) => v + 1)}
          >
            Saving
          </ActionButton>
          <ActionButton variant="outline">
            Replace with imported text from an older message
          </ActionButton>
        </div>
        <div className="gallery-row">
          <ActionButton variant="primary" data-copy-state="success">
            <ControlIcon name="check" className="copy-check" size="1em" />{" "}
            Copied
          </ActionButton>
          <ActionButton variant="primary" data-copy-state="failure">
            Retry
          </ActionButton>
          <ActionButton onPress={() => setOutcome("success")}>
            Complete local example
          </ActionButton>
          <ActionButton
            onPress={() =>
              setOutcome(fault === "outcome" ? "success" : "error")
            }
          >
            Reject local example
          </ActionButton>
        </div>
        <p role="status">
          {outcome === "idle"
            ? "Ready"
            : outcome === "success"
              ? "Copied successfully"
              : "Copy failed. Select the text and copy manually."}
        </p>
      </section>
      <section aria-label="Fields and menus" className="gallery-card">
        <h2>Fields and menus</h2>
        <TextField>
          <Label>Message search</Label>
          <Input placeholder="Search local examples" />
          <Text slot="description" className="field-note">
            Text stays on this device.
          </Text>
        </TextField>
        <TextField isInvalid defaultValue="Unknown place">
          <Label>Invalid source</Label>
          <Input />
          <Text slot="description" className="field-note">
            Choose a timezone or city from the list.
          </Text>
        </TextField>
        <label htmlFor="gallery-zone">Source timezone</label>
        <ZoneChoice
          id="gallery-zone"
          label="Source timezone"
          value={zone}
          onChange={setZone}
          placeholder="Device timezone · UTC"
          triggerLabel="Show source timezones"
        />
        <p className="field-note">
          For “3pm” without a timezone. A timezone in the message takes
          priority.
        </p>
        <Disclosure open={open} onOpenChange={setOpen}>
          <label htmlFor="gallery-format">Time format</label>
          <ChoiceSelect
            id="gallery-format"
            label="Time format"
            value={format}
            onChange={setFormat}
            options={[
              { id: "24", label: "24-hour (15:00)" },
              { id: "12", label: "12-hour (3:00 PM)" },
            ]}
          />
          <p className="field-note">How to display and copy converted times.</p>
          <DateChoice
            id="gallery-date"
            label="Reference date"
            value={date}
            onChange={setDate}
          />
          <p className="field-note">
            For an older message saying “tomorrow”, choose its date here.
          </p>
        </Disclosure>
      </section>
      <p>
        Workspace compositions use the actual app at{" "}
        <a href="/__gallery/?view=workspace">the workspace gallery</a>: empty
        results, ranges, alternatives and precision are driven through its real
        editor.
      </p>
      <footer>
        <p>Your text stays on this device.</p>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {query.get("view") === "workspace" ? <App /> : <Gallery />}
  </StrictMode>,
);
