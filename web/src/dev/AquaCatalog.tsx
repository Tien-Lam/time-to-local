import { useState } from "react";
import { TextField } from "react-aria-components/TextField";
import { Label } from "react-aria-components/Label";
import { Text } from "react-aria-components/Text";
import { ActionButton } from "../components/ui/ActionButton";
import { Checkbox } from "../components/ui/Checkbox";
import { Input } from "../components/ui/Input";
import {
  StatusIndicator,
  type IndicatorState,
} from "../components/ui/StatusIndicator";

const states: [IndicatorState, string][] = [
  ["idle", "Ready to convert"],
  ["pending", "Updating"],
  ["paused", "Paused"],
  ["ready", "1 time converted"],
  ["warning", "Check time"],
  ["ambiguous", "2 interpretations"],
  ["error", "Check input"],
];

/** Development-only parts catalogue using the same owners as production. */
export function AquaCatalog() {
  const [checked, setChecked] = useState(false);
  const [sample, setSample] = useState("Ready");
  return (
    <>
      <section className="gallery-card" aria-label="Aqua materials and states">
        <h2>Aqua materials and states</h2>
        <p>
          Gel and pearl push capsules, softened popup rectangles, inset fields
          and glass status beads. Exercise hover, keyboard focus and press on
          the actual controls.
        </p>
        <div className="gallery-row">
          <ActionButton variant="primary" isDisabled>
            Disabled gel
          </ActionButton>
          <ActionButton variant="outline" isDisabled>
            Disabled pearl
          </ActionButton>
          <ActionButton variant="outline" isPending>
            Waiting pearl
          </ActionButton>
        </div>
        <div className="gallery-row aqua-status-samples">
          {states.map(([state, label]) => (
            <StatusIndicator key={state} state={state}>
              {label}
            </StatusIndicator>
          ))}
        </div>
      </section>
      <section className="gallery-card" aria-label="Aqua native fields">
        <h2>Native fields and checkbox</h2>
        <TextField>
          <Label>Search field</Label>
          <Input type="search" placeholder="Search local examples" />
        </TextField>
        <TextField isDisabled defaultValue="Unavailable field">
          <Label>Disabled field</Label>
          <Input />
        </TextField>
        <TextField isInvalid defaultValue="Unknown place">
          <Label>Invalid field</Label>
          <Input aria-describedby="aqua-invalid-help" />
          <Text
            slot="description"
            id="aqua-invalid-help"
            className="field-note"
          >
            Choose a timezone or city from the list.
          </Text>
        </TextField>
        <label className="diagnostic-toggle">
          <Checkbox
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>Interactive checkbox</span>
        </label>
        <label className="diagnostic-toggle">
          <Checkbox defaultChecked />
          <span>Checked checkbox</span>
        </label>
        <label className="diagnostic-toggle">
          <Checkbox disabled />
          <span>Disabled checkbox</span>
        </label>
        <label className="diagnostic-toggle">
          <Checkbox disabled defaultChecked />
          <span>Disabled checked checkbox</span>
        </label>
        <label htmlFor="aqua-editor">Message textarea</label>
        <textarea
          id="aqua-editor"
          rows={3}
          defaultValue="April 9, 2026 3pm in Tokyo"
        />
        <div className="manual-copy">
          <label htmlFor="aqua-manual-copy">Manual copy textarea</label>
          <textarea
            id="aqua-manual-copy"
            readOnly
            rows={2}
            value="16:00 · Thu, 9 Apr 2026 · UTC+10:00 Sydney"
          />
        </div>
      </section>
      <section className="gallery-card" aria-label="Aqua support surfaces">
        <h2>Support surface samples</h2>
        <p>
          Material samples only. The workspace view exercises the real import,
          update and installation flows.
        </p>
        <div className="update-banner">
          <p>An update is ready. Activate it when you choose.</p>
          <ActionButton
            variant="outline"
            onPress={() =>
              setSample("Update action selected in the local sample")
            }
          >
            Update now
          </ActionButton>
        </div>
        <div className="import-choice">
          <p>Pasted text arrived. Replace the current message?</p>
          <div>
            <ActionButton
              variant="outline"
              onPress={() =>
                setSample("Replace action selected in the local sample")
              }
            >
              Replace message
            </ActionButton>
            <ActionButton
              onPress={() =>
                setSample("Current message retained in the local sample")
              }
            >
              Keep current
            </ActionButton>
          </div>
        </div>
        <div className="install-help">
          <h3>Keep Time to Local handy</h3>
          <p>Add the app through your browser’s installation menu.</p>
          <ActionButton
            variant="outline"
            onPress={() =>
              setSample(
                "Installation guidance acknowledged in the local sample",
              )
            }
          >
            Got it
          </ActionButton>
        </div>
        <p role="status">{sample}</p>
      </section>
    </>
  );
}
