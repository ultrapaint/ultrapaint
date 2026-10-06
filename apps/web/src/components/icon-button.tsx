import type * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * An icon says nothing to a screen reader: the button is named by its tooltip when that is
 * text, and by `label` otherwise, which it must then be given.
 */
type Named =
  | { label?: string; tooltip: string }
  | { label: string; tooltip?: React.ReactNode };

/** Ghost icon Button with an optional shadcn Tooltip. */
export const IconButton = ({
  label,
  tooltip,
  variant = "ghost",
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button> & Named) => {
  const button = (
    <Button
      aria-label={label ?? (typeof tooltip === "string" ? tooltip : undefined)}
      size={size}
      variant={variant}
      {...props}
    />
  );
  if (!tooltip) {
    return button;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
};
