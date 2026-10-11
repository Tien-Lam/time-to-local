import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./ui/Collapsible";
import { useRef, type ReactNode } from "react";
import { ControlIcon } from "./ui/ControlIcon";

/** Commit intrinsic close geometry before another control can be pressed. */
export function Disclosure({
  open,
  onOpenChange,
  children,
  label = "Message interpretation",
  id = "interpretation-options",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  label?: string;
  id?: string;
}) {
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Collapsible
      className={
        id === "interpretation-options" ? "options" : "settings-disclosure"
      }
      isExpanded={open}
      onExpandedChange={(next) => {
        // Programmatic/virtual activation need not move focus before collapse.
        // Preserve the previous native disclosure's focused-child correction.
        if (!next && content.current?.contains(document.activeElement))
          trigger.current?.focus();
        onOpenChange(next);
      }}
    >
      <CollapsibleTrigger
        ref={trigger}
        className={
          id === "interpretation-options"
            ? "options-trigger"
            : "settings-trigger"
        }
        type="button"
        aria-label={
          label === "Message interpretation"
            ? "Message interpretation (More options)"
            : label
        }
      >
        <ControlIcon name="chevron" className="disclosure-chevron" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent
        ref={content}
        className={
          id === "interpretation-options" ? "option-fields" : "settings-fields"
        }
        hidden={!open}
        inert={!open}
        aria-hidden={!open}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
