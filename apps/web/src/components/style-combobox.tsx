import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
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
  /** The value the option sets, e.g. `$color-primary` or `16`. */
  value: string;
}

interface Item extends StyleOption {
  /** Built from the query rather than taken from the design system's options. */
  custom?: boolean;
}

const ArbitraryDot = ({ className }: { className?: string }) => (
  <span
    className={cn("size-1.5 shrink-0 rounded-full bg-warning", className)}
    title="Arbitrary value, outside the design system. Prefer a value from the list."
  />
);

const matches = (o: StyleOption, q: string) =>
  `${o.label} ${o.value} ${o.description ?? ""}`.toLowerCase().includes(q);

interface StyleComboboxProps {
  className?: string;
  /** The value currently set, if any. */
  current: string | undefined;
  /** Value for a free-form query, or null when the query can't become one. */
  custom?: (query: string) => string | null;
  disabled?: boolean;
  /** Text shown while closed when `current` is not one of the options, e.g. the computed value. */
  display: string;
  /**
   * Muted text at the end of the field, e.g. where the value comes from. Left out when the value is
   * one of the options, whose label already says it.
   */
  hint?: string;
  leading?: React.ReactNode;
  onPick: (cls: string) => void;
  options: readonly StyleOption[];
  /** Whether a value is outside the design system, marked so; none is when it is left out. */
  outside?: (value: string) => boolean;
  title?: string;
}

/** How a field became a combobox: focused from the keyboard, or clicked, which opens it. */
type Activation = "focus" | "open";

/**
 * Searchable field over the values a style can take. The list is the design system's options;
 * when the query matches none of them, `custom` turns it into a value offered last, and marked
 * when it is `outside` the design system, so the defined values stay the easy path.
 *
 * It is drawn as a plain field that looks the same until it is focused or clicked: the inspector
 * shows thirty of them and is drawn again for each selection, and a combobox is costly to set up
 * while only the one in use needs to be one.
 */
export const StyleCombobox = (props: StyleComboboxProps) => {
  const [activated, setActivated] = useState<Activation | null>(null);
  return activated ? (
    <ActiveCombobox {...props} activated={activated} />
  ) : (
    <IdleCombobox {...props} onActivate={setActivated} />
  );
};

const INPUT_CLASS =
  "h-full min-w-0 flex-1 bg-transparent px-1.5 font-body outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed";
const TRIGGER_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-muted disabled:pointer-events-none";

/** The field as it looks closed: what it shows, and nothing to set up. */
const IdleCombobox = ({
  className,
  current,
  disabled,
  display,
  hint,
  leading,
  onActivate,
  options,
  outside,
  title,
}: StyleComboboxProps & { onActivate: (how: Activation) => void }) => {
  const selected = options.find((o) => o.value === current) ?? null;
  const open = (e: React.PointerEvent) => {
    if (!disabled && e.button === 0) {
      e.preventDefault();
      onActivate("open");
    }
  };
  return (
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
      <input
        aria-expanded={false}
        aria-haspopup="listbox"
        className={INPUT_CLASS}
        data-slot="input-group-control"
        disabled={disabled}
        onFocus={() => onActivate("focus")}
        onPointerDown={open}
        placeholder={selected?.label ?? display}
        readOnly
        role="combobox"
        value={selected?.label ?? display}
      />
      <InputGroupAddon align="inline-end" className="min-w-0 gap-1 py-0 pr-0.5">
        {hint && !selected ? (
          <span
            className="min-w-0 max-w-24 truncate font-code font-normal"
            title={hint}
          >
            {hint}
          </span>
        ) : null}
        {current && outside?.(current) ? <ArbitraryDot /> : null}
        <button
          aria-label="Open"
          className={TRIGGER_CLASS}
          disabled={disabled}
          onPointerDown={open}
          tabIndex={-1}
          type="button"
        >
          <ChevronDownIcon className="size-3" />
        </button>
      </InputGroupAddon>
    </InputGroup>
  );
};

/** The combobox itself, once the field is in use: focused, and open when it was clicked. */
const ActiveCombobox = ({
  activated,
  className,
  current,
  custom,
  disabled,
  display,
  hint,
  leading,
  onPick,
  options,
  outside,
  title,
}: StyleComboboxProps & { activated: Activation }) => {
  const [open, setOpen] = useState(activated === "open");
  const group = useRef<HTMLDivElement>(null);
  // It takes the place of the field that was focused or clicked: the focus goes on to it.
  useEffect(() => {
    group.current
      ?.querySelector<HTMLInputElement>('[data-slot="input-group-control"]')
      ?.focus();
  }, []);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === current) ?? null;
  const arbitrary = current ? (outside?.(current) ?? false) : false;

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
        ref={group}
        title={title}
      >
        {leading ? (
          <InputGroupAddon className="py-0 pl-1.5 font-body font-normal">
            {leading}
          </InputGroupAddon>
        ) : null}
        <ComboboxPrimitive.Input
          className={INPUT_CLASS}
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
            className={TRIGGER_CLASS}
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
                <ArbitraryItem
                  arbitrary={outside?.(item.value) ?? false}
                  item={item}
                />
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
    </span>
  </>
);

const ArbitraryItem = ({
  arbitrary,
  item,
}: {
  arbitrary: boolean;
  item: Item;
}) => (
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
