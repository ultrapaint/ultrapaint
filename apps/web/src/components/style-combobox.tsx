import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import {
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";

export interface StyleOption {
  /** Muted text after the label, e.g. the size the step resolves to. */
  description?: string;
  label: string;
  preview?: React.ReactNode;
  /** The class the option writes, e.g. `pt-4`. */
  value: string;
}

interface Item extends StyleOption {
  /** Built from the query rather than taken from the design system's options. */
  custom?: boolean;
}

// Leading variants, which may hold brackets of their own: `group-data-[size=sm]:hover:`.
const VARIANTS_RE = /^(?:[^:[\]]*(?:\[[^\]]*\])?[^:[\]]*:)+/;

/**
 * `p-[13px]`, `hover:bg-[#ff0000]`, `[mask-type:alpha]`: a value outside the design system's
 * scale. Brackets in a variant alone (`group-data-[size=sm]:px-4`) don't count.
 */
const isArbitraryClass = (cls: string | undefined): boolean =>
  cls ? cls.replace(VARIANTS_RE, "").includes("[") : false;

const ArbitraryDot = ({ className }: { className?: string }) => (
  <span
    className={cn("size-1.5 shrink-0 rounded-full bg-warning", className)}
    title="Arbitrary value, outside the design system. Prefer a value from the list."
  />
);

const matches = (o: StyleOption, q: string) =>
  `${o.label} ${o.value} ${o.description ?? ""}`.toLowerCase().includes(q);

/**
 * Searchable field over the classes a style can take. The list is the design system's options;
 * when the query matches none of them, `custom` turns it into a class (usually arbitrary) offered
 * last and marked, so the defined values stay the easy path.
 */
export const StyleCombobox = ({
  current,
  display,
  options,
  onPick,
  custom,
  disabled,
  leading,
  hint,
  title,
  className,
}: {
  /** The class currently setting the value, if any. */
  current: string | undefined;
  /** Text shown while closed when `current` is not one of the options, e.g. the computed value. */
  display: string;
  options: readonly StyleOption[];
  onPick: (cls: string) => void;
  /** Class for a free-form query, or null when the query can't become one. */
  custom?: (query: string) => string | null;
  disabled?: boolean;
  leading?: React.ReactNode;
  /**
   * Muted text at the end of the field, e.g. where the value comes from. Left out when the value is
   * one of the options, whose label already says it.
   */
  hint?: string;
  title?: string;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === current) ?? null;
  const arbitrary = isArbitraryClass(current);

  const q = query.trim().toLowerCase();
  let items: Item[] = q ? options.filter((o) => matches(o, q)) : [...options];
  const customClass = q && custom ? custom(query.trim()) : null;
  if (customClass) {
    const known = options.find((o) => o.value === customClass);
    items = known
      ? [known, ...items.filter((o) => o !== known)]
      : [...items, { custom: true, label: query.trim(), value: customClass }];
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
    }
  };
  const onInputValueChange = (
    v: string,
    details: ComboboxPrimitive.Root.ChangeEventDetails
  ) => {
    if (details.reason === "input-change") {
      setQuery(v);
    }
  };
  const onValueChange = (item: Item | null) => {
    if (item && item.value !== current) {
      onPick(item.value);
    }
  };
  const selectAll = (e: React.FocusEvent<HTMLInputElement>) =>
    e.target.select();
  const isEqual = (a: Item, b: Item) => a.value === b.value;
  const toLabel = (i: Item) => i.label;

  return (
    <ComboboxPrimitive.Root<Item>
      autoHighlight
      disabled={disabled}
      filter={null}
      inputValue={open ? query : (selected?.label ?? display)}
      isItemEqualToValue={isEqual}
      items={items}
      itemToStringLabel={toLabel}
      onInputValueChange={onInputValueChange}
      onOpenChange={onOpenChange}
      onValueChange={onValueChange}
      open={open}
      value={selected}
    >
      <InputGroup
        className={cn("h-6 min-w-0 flex-1", className)}
        data-disabled={disabled}
        title={title}
      >
        {leading ? (
          <InputGroupAddon className="py-0 pl-1.5 font-body font-normal">
            {leading}
          </InputGroupAddon>
        ) : null}
        <ComboboxPrimitive.Input
          className="h-full min-w-0 flex-1 bg-transparent px-1.5 font-body outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          data-slot="input-group-control"
          onFocus={selectAll}
          placeholder={selected?.label ?? display}
        />
        <InputGroupAddon
          align="inline-end"
          className="min-w-0 gap-1 py-0 pr-0.5"
        >
          {hint && !selected ? (
            <span
              className="min-w-0 max-w-24 truncate font-code font-normal"
              title={hint}
            >
              {hint}
            </span>
          ) : null}
          {arbitrary ? <ArbitraryDot /> : null}
          <ComboboxPrimitive.Trigger
            className="flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-muted disabled:pointer-events-none"
            disabled={disabled}
          >
            <ChevronDownIcon className="size-3" />
          </ComboboxPrimitive.Trigger>
        </InputGroupAddon>
      </InputGroup>
      <ComboboxContent className="w-auto min-w-[max(10rem,var(--anchor-width))]">
        <ComboboxEmpty>
          {custom ? "Type a value" : "No matching values"}
        </ComboboxEmpty>
        <ComboboxList>
          {(item: Item) => (
            <ComboboxItem
              className={cn(
                "pr-7",
                item.custom && "border-t border-dashed first:border-t-0"
              )}
              key={item.value}
              value={item}
            >
              {item.custom ? (
                <ArbitraryItem item={item} />
              ) : (
                <Option item={item} />
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </ComboboxPrimitive.Root>
  );
};

const Option = ({ item }: { item: StyleOption }) => (
  <>
    {item.preview}
    <span className="truncate">{item.label}</span>
    <span className="ml-auto flex items-center gap-1.5 pl-3 font-code text-muted-foreground">
      {item.description ? <span>{item.description}</span> : null}
      {item.description === item.value ? null : <span>{item.value}</span>}
      {isArbitraryClass(item.value) ? <ArbitraryDot /> : null}
    </span>
  </>
);

const ArbitraryItem = ({ item }: { item: Item }) => {
  const arbitrary = isArbitraryClass(item.value);
  return (
    <>
      {arbitrary ? <ArbitraryDot /> : null}
      <span className={cn("truncate", arbitrary && "text-warning")}>
        {arbitrary ? "Use arbitrary" : "Use"}
      </span>
      <span className="ml-auto pl-3 font-code text-muted-foreground">
        {item.value}
      </span>
    </>
  );
};
