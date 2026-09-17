import type * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  preview?: React.ReactNode;
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
}) => (
  <Select<string>
    value={value}
    onValueChange={(v) => v !== null && onChange(v)}
    disabled={disabled}
  >
    <SelectTrigger size={size} className={cn("w-full min-w-0", className)}>
      <SelectValue placeholder={placeholder} className="truncate">
        {(v: string | null) => options.find((o) => o.value === v)?.label ?? placeholder}
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
