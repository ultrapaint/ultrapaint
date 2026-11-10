import type * as React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";

export interface SelectOption {
  /** Muted second line in the list, e.g. the class the option writes. */
  description?: string;
  /** Options with the same group are listed together under its name, in first-seen order. */
  group?: string;
  label: string;
  preview?: React.ReactNode;
  value: string;
}

/** The options under their groups, the groups in the order they first appear. */
const groupsOf = (options: readonly SelectOption[]) => {
  const groups = new Map<string, SelectOption[]>();
  for (const o of options) {
    const key = o.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups];
};

const Item = ({ option: o }: { option: SelectOption }) => (
  <SelectItem value={o.value}>
    {o.preview}
    {o.description ? (
      <span className="flex flex-col">
        <span>{o.label}</span>
        <span className="font-code text-muted-foreground">{o.description}</span>
      </span>
    ) : (
      o.label
    )}
  </SelectItem>
);

/** Data-driven wrapper around the shadcn Select for flat or grouped option lists. */
export const OptionSelect = ({
  value,
  onChange,
  options,
  placeholder = "—",
  size = "default",
  className,
  disabled,
  hint,
  id,
  "aria-label": ariaLabel,
}: {
  /** The select's name where no label points at its `id`. */
  "aria-label"?: string;
  /** What a label's `htmlFor` names: the trigger's. */
  id?: string;
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
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn("w-full min-w-0", className)}
        id={id}
        size={size}
      >
        <SelectValue className="truncate" placeholder={placeholder}>
          {(v: string | null) =>
            options.find((o) => o.value === v)?.label ?? placeholder
          }
        </SelectValue>
        {hint ? (
          <span
            className="min-w-0 max-w-[55%] shrink truncate font-code text-muted-foreground"
            title={hint}
          >
            {hint}
          </span>
        ) : null}
      </SelectTrigger>
      <SelectContent className="w-auto min-w-[max(8rem,var(--anchor-width))]">
        {options.some((o) => o.group)
          ? groupsOf(options).map(([name, items]) => (
              <SelectGroup key={name}>
                {name ? <SelectLabel>{name}</SelectLabel> : null}
                {items.map((o) => (
                  <Item key={o.value} option={o} />
                ))}
              </SelectGroup>
            ))
          : options.map((o) => <Item key={o.value} option={o} />)}
      </SelectContent>
    </Select>
  );
};
