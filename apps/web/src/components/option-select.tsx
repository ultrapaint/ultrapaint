import { cn } from "cn";
import type * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface SelectOption {
  /** Muted second line in the list, e.g. the class the option writes. */
  description?: string;
  label: string;
  preview?: React.ReactNode;
  value: string;
}

/** Data-driven wrapper around the shadcn Select for flat option lists. */
export const OptionSelect = ({
  value,
  onChange,
  options,
  placeholder = "—",
  size = "default",
  className,
  disabled,
  hint,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  size?: "sm" | "default";
  className?: string;
  disabled?: boolean;
  /** Muted text at the end of the trigger, e.g. where the current value comes from. */
  hint?: string;
}) => {
  const onValueChange = (v: string | null) => {
    if (v !== null) {
      onChange(v);
    }
  };
  return (
    <Select<string>
      disabled={disabled}
      onValueChange={onValueChange}
      value={value}
    >
      <SelectTrigger className={cn("w-full min-w-0", className)} size={size}>
        <SelectValue className="truncate" placeholder={placeholder}>
          {(v: string | null) =>
            options.find((o) => o.value === v)?.label ?? placeholder
          }
        </SelectValue>
        {hint ? (
          <span
            className="min-w-0 max-w-[55%] shrink truncate font-mono text-[10px] text-muted-foreground"
            title={hint}
          >
            {hint}
          </span>
        ) : null}
      </SelectTrigger>
      <SelectContent className="w-auto min-w-[max(8rem,var(--anchor-width))]">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.preview}
            {o.description ? (
              <span className="flex flex-col">
                <span>{o.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground leading-tight">
                  {o.description}
                </span>
              </span>
            ) : (
              o.label
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
