import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Ghost icon Button with an optional shadcn Tooltip. */
export const IconButton = ({
  tooltip,
  variant = "ghost",
  size = "icon",
  ...props
}: React.ComponentProps<typeof Button> & { tooltip?: React.ReactNode }) => {
  const button = (
    <Button
      variant={variant}
      size={size}
      aria-label={typeof tooltip === "string" ? tooltip : undefined}
      {...props}
    />
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
};
