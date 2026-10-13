import type { ComponentProps } from "react";

/** Native checkbox semantics; the caller owns its label and checked state. */
export function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      {...props}
      type="checkbox"
      data-slot="checkbox"
      className={["ui-checkbox", className].filter(Boolean).join(" ")}
    />
  );
}
