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
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  size?: "sm" | "default";
  className?: string;
  disabled?: boolean;
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
      </SelectTrigger>
      <SelectContent className="w-auto min-w-[max(8rem,var(--anchor-width))]">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.preview}
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
