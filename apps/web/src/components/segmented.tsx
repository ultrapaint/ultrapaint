import type * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Single-choice segmented control built on the shadcn ToggleGroup. */
export const Segmented = <T extends string>({
  value,
  onChange,
  options,
  className,
  disabled,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  className?: string;
  disabled?: boolean;
}) => (
  <ToggleGroup
    variant="outline"
    size="sm"
    spacing={0}
    disabled={disabled}
    value={value === null ? [] : [value]}
    onValueChange={(next) => {
      // Clicking the pressed item yields an empty group; a segmented control keeps its value.
      const v = next[0] as T | undefined;
      if (v !== undefined) onChange(v);
    }}
    className={cn("w-full min-w-0", className)}
  >
    {options.map((o) => {
      const item = (
        <ToggleGroupItem key={o.value} value={o.value} aria-label={o.title} className="flex-1">
          {o.label}
        </ToggleGroupItem>
      );
      if (!o.title) return item;
      return (
        <Tooltip key={o.value}>
          <TooltipTrigger render={item} />
          <TooltipContent>{o.title}</TooltipContent>
        </Tooltip>
      );
    })}
  </ToggleGroup>
);
