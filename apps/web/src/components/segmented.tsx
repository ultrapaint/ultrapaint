import { cn } from "cn";
import type * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
}) => {
  const onValueChange = (next: readonly unknown[]) => {
    // Clicking the pressed item yields an empty group; a segmented control keeps its value.
    const v = next[0] as T | undefined;
    if (v !== undefined) {
      onChange(v);
    }
  };
  return (
    <ToggleGroup
      className={cn("w-full min-w-0", className)}
      disabled={disabled}
      onValueChange={onValueChange}
      size="sm"
      spacing={0}
      value={value === null ? [] : [value]}
      variant="outline"
    >
      {options.map((o) => {
        const item = (
          <ToggleGroupItem
            aria-label={o.title}
            className="flex-1"
            key={o.value}
            value={o.value}
          >
            {o.label}
          </ToggleGroupItem>
        );
        if (!o.title) {
          return item;
        }
        return (
          <Tooltip key={o.value}>
            <TooltipTrigger render={item} />
            <TooltipContent>{o.title}</TooltipContent>
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
};
