import type * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/**
 * Single-choice segmented control: a muted track, the chosen option a raised chip, as the tabs
 * draw theirs. An option drawn as an icon is named by its `title`, which its tooltip shows.
 */
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
      className={cn(
        "h-7 w-full min-w-0 gap-0.5 rounded-md bg-muted p-0.5",
        className
      )}
      disabled={disabled}
      onValueChange={onValueChange}
      size="sm"
      spacing={0.5}
      value={value === null ? [] : [value]}
    >
      {options.map((o) => {
        const item = (
          <ToggleGroupItem
            aria-label={o.title}
            // Equal while the labels fit; a longer one takes the room it needs from the others.
            className="h-full min-w-fit flex-1 rounded-[calc(var(--radius-md)-2px)] px-1.5 font-body font-medium text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs dark:aria-pressed:bg-input [&_svg:not([class*='size-'])]:size-4"
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
