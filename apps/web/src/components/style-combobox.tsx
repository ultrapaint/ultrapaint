import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { ChevronDownIcon } from "lucide-react";
import type * as React from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { splitPalettes } from "../lib/token-options.tsx";
import { CutText } from "./cut-text.tsx";

export interface StyleOption {
  /** Muted text after the label, e.g. the size the step resolves to. */
  description?: string;
  /** Its value is the editor's own (Clear's), so the list neither shows it nor searches it. */
  internal?: boolean;
  label: string;
  preview?: React.ReactNode;
  /**
   * The palette's shade the option is (`blue-600` of Blue at 600), drawn as a swatch in its
   * palette's row while nothing is typed.
   */
  shade?: PaletteShade;
  /** The value the option sets, e.g. `$color-primary` or `16`. */
  value: string;
}

/** A colour option's place in its palette: the palette, the step, and the colour its swatch is. */
export interface PaletteShade {
  readonly color: string;
  readonly palette: string;
  readonly step: number;
}

interface Item extends StyleOption {
  /** Built from the query rather than taken from the design system's options. */
  custom?: boolean;
  /** A palette's place at a step it has no shade at: kept, unseen, so the steps line up. */
  empty?: boolean;
  /** What a way's token comes to, after its name: `#2563eb`. */
  shown?: string;
  /** A way onto the design system for the value outside it, drawn at the top (ADR 0136). */
  way?: "nearest" | "new";
}

/** The nearest token to a value outside the design system, as its list offers it (ADR 0136). */
export interface NearestRow {
  /** What it is called: `primary`, `spacing-4.5`. */
  readonly name: string;
  /** What it comes to: `#2563eb`, `18px`. */
  readonly shown: string;
  /** What picking it sets, as an option's value does. */
  readonly value: string;
}

/** What New token from this value… picks, which no field takes as a value. */
const NEW_TOKEN = "__newToken";

/**
 * The ways onto the design system the list starts with while nothing is typed and the value is
 * outside it: Use nearest, when a token is near, then New token from this value….
 */
export const waysFor = (
  nearest: NearestRow | null,
  newToken: boolean
): Item[] => [
  ...(nearest
    ? [
        {
          description: nearest.name,
          label: "Use nearest",
          value: nearest.value,
          way: "nearest" as const,
          ...(nearest.shown !== nearest.name && { shown: nearest.shown }),
        },
      ]
    : []),
  ...(newToken
    ? [
        {
          internal: true,
          label: "New token from this value…",
          value: NEW_TOKEN,
          way: "new" as const,
        },
      ]
    : []),
];

export const ArbitraryDot = ({ className }: { className?: string }) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <span
          aria-label="Outside the design system"
          className={cn("size-1.5 shrink-0 rounded-full bg-warning", className)}
          role="img"
        />
      }
    />
    <TooltipContent>Outside the design system</TooltipContent>
  </Tooltip>
);

/**
 * The field's group, named by its title, which the system tooltip shows over it. The tooltip is
 * there with or without a title, so a title that comes or goes never mounts the field again.
 */
const NamedGroup = ({
  children,
  title,
}: {
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  title: string | undefined;
}) => (
  <Tooltip>
    <TooltipTrigger render={children} />
    {title ? <TooltipContent>{title}</TooltipContent> : null}
  </Tooltip>
);

/** What an empty list says: what to type, or that what was typed is no value. */
const emptyText = (typed: boolean, query: string) => {
  if (!typed) {
    return "No values match";
  }
  return query ? "Not a value this field takes" : "Type a value";
};

/** Whether a query finds an option: by its label, its description, or a value the list shows. */
export const matches = (o: StyleOption, q: string) =>
  `${o.label} ${o.internal ? "" : o.value} ${o.description ?? ""}`
    .toLowerCase()
    .includes(q);

/** The muted text after an option's label: its description, then its value when that says more. */
export const hintsOf = (o: StyleOption): string[] => [
  ...(o.description ? [o.description] : []),
  ...(o.internal || o.description === o.value ? [] : [o.value]),
];

/**
 * The list for a query: the options it finds, and the value it types, when it can be one,
 * first. An internal value typed is neither an option found nor a value of its own.
 */
export const itemsFor = (
  options: readonly StyleOption[],
  query: string,
  custom?: (query: string) => string | null
): Item[] => {
  const typed = query.trim();
  const q = typed.toLowerCase();
  const found: Item[] = q ? options.filter((o) => matches(o, q)) : [...options];
  const value = q && custom ? custom(typed) : null;
  if (!value || options.some((o) => o.internal && o.value === value)) {
    return found;
  }
  const known = options.find((o) => o.value === value);
  return known
    ? [known, ...found.filter((o) => o !== known)]
    : [...found, { custom: true, label: typed, value }];
};

interface StyleComboboxProps {
  /** Opens the list as soon as it is drawn: the field was just added, to be given a value. */
  autoOpen?: boolean;
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
  /**
   * The nearest token to the value while it is outside the design system, offered first as Use
   * nearest; asked for when the list opens.
   */
  nearest?: (() => NearestRow | null) | undefined;
  /**
   * Offers New token from this value… while the value is outside the design system; picked, it
   * is told the field, to name the token by.
   */
  onNewToken?: ((field: HTMLElement) => void) | undefined;
  onPick: (cls: string) => void;
  /**
   * The value the list has highlighted while it is open (an option gone through, a value typed),
   * to be drawn before it is picked; null once none is.
   */
  onPreview?: (value: string | null) => void;
  options: readonly StyleOption[];
  /** Whether a value is outside the design system, marked so; none is when it is left out. */
  outside?: (value: string) => boolean;
  /** The field's name, shown in the system tooltip over it. */
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
  const [activated, setActivated] = useState<Activation | null>(
    props.autoOpen ? "open" : null
  );
  return activated ? (
    <ActiveCombobox {...props} activated={activated} />
  ) : (
    <IdleCombobox {...props} onActivate={setActivated} />
  );
};

const INPUT_CLASS =
  "h-full min-w-0 flex-1 cursor-default bg-transparent px-2 font-body tabular-nums outline-none placeholder:text-muted-foreground focus:cursor-text disabled:cursor-not-allowed";
const TRIGGER_CLASS =
  "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none";

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
    <NamedGroup title={title}>
      <InputGroup
        aria-label={title}
        className={cn("min-w-0 flex-1", className)}
        data-disabled={disabled}
      >
        {leading ? (
          <InputGroupAddon className="py-0 pr-0 pl-2 font-body">
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
        <InputGroupAddon align="inline-end" className="min-w-0 gap-1 py-0 pr-1">
          {hint && !selected ? (
            <CutText className="min-w-0 max-w-24 truncate font-body-small">
              {hint}
            </CutText>
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
    </NamedGroup>
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
  nearest,
  onNewToken,
  onPick,
  onPreview,
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

  const ways =
    open && arbitrary && query.trim() === ""
      ? waysFor(nearest?.() ?? null, onNewToken !== undefined)
      : [];
  // While nothing is typed, a colour field's palettes are rows of swatches (ADR 0146).
  const swatches = query.trim() === "" ? swatchGridOf(ways, options) : null;
  const items = swatches
    ? swatches.flatMap((row) => row.cells)
    : [...ways, ...itemsFor(options, query, custom)];
  // The item the keyboard or the pointer is on: a swatch is read under the palettes.
  const [highlighted, setHighlighted] = useState<Item | null>(null);
  // The grid's items by their values, for the arrow keys to hand the highlight to.
  const cells = useRef(new Map<string, HTMLElement>());
  const cellRef = (value: string) => (element: HTMLElement | null) => {
    if (element) {
      cells.current.set(value, element);
    } else {
      cells.current.delete(value);
    }
  };
  /**
   * Up and down into or out of a palette go by step, which the grid's own keys cannot: they take
   * the nearest place in the row, and Base UI's only the place at or before it.
   */
  const onKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement> & {
      preventBaseUIHandler?: () => void;
    }
  ) => {
    const direction = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!(swatches && highlighted && direction)) {
      return;
    }
    const next = stepTo(swatches, highlighted.value, direction);
    const element = next && cells.current.get(next.value);
    if (!element) {
      return;
    }
    e.preventDefault();
    e.preventBaseUIHandler?.();
    // Base UI keeps the focus in the input and leaves items no way in but the pointer's: a move
    // over an item highlights it (WebKit counts a move only when the pointer did move).
    element.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, movementX: 1 })
    );
    element.scrollIntoView?.({ block: "nearest" });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      onPreview?.(null);
    }
  };
  const onItemHighlighted = (item: Item | undefined) => {
    setHighlighted(item ?? null);
    onPreview?.(item && item.way !== "new" ? item.value : null);
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
    if (item?.way === "new") {
      if (group.current) {
        onNewToken?.(group.current);
      }
      return;
    }
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
      grid={swatches !== null}
      inputValue={open ? query : (selected?.label ?? display)}
      isItemEqualToValue={isEqual}
      items={items}
      itemToStringLabel={toLabel}
      onInputValueChange={onInputValueChange}
      onItemHighlighted={onItemHighlighted}
      onOpenChange={onOpenChange}
      onValueChange={onValueChange}
      open={open}
      value={selected}
    >
      <NamedGroup title={title}>
        <InputGroup
          aria-label={title}
          className={cn("min-w-0 flex-1", className)}
          data-disabled={disabled}
          ref={group}
        >
          {leading ? (
            <InputGroupAddon className="py-0 pr-0 pl-2 font-body">
              {leading}
            </InputGroupAddon>
          ) : null}
          <ComboboxPrimitive.Input
            className={INPUT_CLASS}
            data-slot="input-group-control"
            onFocus={selectAll}
            onKeyDown={onKeyDown}
            placeholder={selected?.label ?? display}
          />
          <InputGroupAddon
            align="inline-end"
            className="min-w-0 gap-1 py-0 pr-1"
          >
            {hint && !selected ? (
              <CutText className="min-w-0 max-w-24 truncate font-body-small">
                {hint}
              </CutText>
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
      </NamedGroup>
      <ComboboxContent className="w-auto min-w-[max(10rem,var(--anchor-width))]">
        <ComboboxEmpty>
          {emptyText(custom !== undefined, query.trim().toLowerCase())}
        </ComboboxEmpty>
        <ComboboxList>
          {swatches
            ? swatches.map((row, i) =>
                row.palette ? (
                  <Fragment key={`palette:${row.palette}`}>
                    <PaletteSwatches cellRef={cellRef} row={row} />
                    {swatches[i + 1]?.palette ? null : (
                      <SwatchReadout
                        swatch={
                          highlighted?.shade
                            ? highlighted
                            : (selected?.shade && selected) || null
                        }
                      />
                    )}
                  </Fragment>
                ) : (
                  row.cells.map((item) => (
                    <ComboboxPrimitive.Row key={keyOf(item)}>
                      <ListItem
                        item={item}
                        outside={outside}
                        ref={cellRef(item.value)}
                      />
                    </ComboboxPrimitive.Row>
                  ))
                )
              )
            : (item: Item) => (
                <ListItem item={item} key={keyOf(item)} outside={outside} />
              )}
        </ComboboxList>
      </ComboboxContent>
    </ComboboxPrimitive.Root>
  );
};

const keyOf = (item: Item) => (item.way ? `way:${item.way}` : item.value);

/** One row of the list: an option, a way onto the system, or the value typed. */
const ListItem = ({
  item,
  outside,
  ref,
}: {
  item: Item;
  outside: ((value: string) => boolean) | undefined;
  ref?: React.Ref<HTMLDivElement>;
}) => (
  <ComboboxItem
    className={cn(
      "pr-7",
      item.custom && "border-t border-dashed first:border-t-0",
      item.way === "new" && "border-b"
    )}
    ref={ref}
    value={item}
  >
    <ItemRow item={item} outside={outside} />
  </ComboboxItem>
);

/**
 * A row of the grid: a palette's, its places from the lightest (an empty one hidden where it has
 * no shade, which no key or pointer lands on), or a list row of one item.
 */
interface GridRow {
  readonly cells: readonly Item[];
  readonly palette?: string;
}

/**
 * A colour field's items laid out as the grid draws them, or null when it has no palette: the
 * ways onto the system and the other options a row each, the palettes, then Clear. Its items in
 * order are the combobox's, whose highlight goes by their place.
 */
const swatchGridOf = (
  ways: readonly Item[],
  options: readonly StyleOption[]
): readonly GridRow[] | null => {
  const { list, palettes } = splitPalettes(options);
  if (palettes.length === 0) {
    return null;
  }
  const rowOf = (item: Item): GridRow => ({ cells: [item] });
  return [
    ...ways.map(rowOf),
    ...list.filter((o) => !o.internal).map(rowOf),
    ...palettes.map((palette) => ({
      cells: palette.shades.map(
        (shade, i) =>
          shade ?? {
            empty: true,
            label: "",
            value: `__empty:${palette.name}:${i}`,
          }
      ),
      palette: palette.name,
    })),
    ...list.filter((o) => o.internal).map(rowOf),
  ];
};

/**
 * Where up or down goes from an item when it leaves or enters a palette, or null to leave it to
 * the list: from a list row to a palette's first shade; from a palette to the nearest shade at
 * the same place, the lower of two as near; to a list row's item.
 */
const stepTo = (
  rows: readonly GridRow[],
  value: string,
  direction: number
): Item | null => {
  const from = rows.findIndex((row) =>
    row.cells.some((c) => c.value === value)
  );
  const source = rows[from];
  const target = rows[from + direction];
  if (!(source && target && (source.palette || target.palette))) {
    return null;
  }
  const shades = target.cells.filter((c) => !c.empty);
  if (!source.palette) {
    return shades[0] ?? null;
  }
  const place = source.cells.findIndex((c) => c.value === value);
  const distance = (c: Item) => Math.abs(target.cells.indexOf(c) - place);
  return shades.reduce<Item | null>(
    (best, c) => (best === null || distance(c) < distance(best) ? c : best),
    null
  );
};

/** A palette's row: its name, then a swatch at each of its places, lightest first. */
const PaletteSwatches = ({
  cellRef,
  row,
}: {
  cellRef: (value: string) => React.Ref<HTMLDivElement>;
  row: GridRow;
}) => (
  <ComboboxPrimitive.Row
    aria-label={row.palette}
    className="flex items-center gap-1 px-2 py-1"
  >
    <span
      aria-hidden
      className="w-16 shrink-0 truncate pr-1 font-body-small text-muted-foreground"
    >
      {row.palette}
    </span>
    {row.cells.map((cell) => (
      <ComboboxPrimitive.Item
        aria-label={cell.empty ? undefined : cell.label}
        className="size-4 shrink-0 cursor-pointer rounded-sm border border-foreground/15 outline-none data-highlighted:ring-2 data-highlighted:ring-ring data-selected:ring-2 data-selected:ring-foreground data-highlighted:ring-offset-1 data-highlighted:ring-offset-popover data-selected:ring-offset-1 data-selected:ring-offset-popover"
        disabled={cell.empty}
        key={cell.value}
        ref={cellRef(cell.value)}
        style={
          cell.empty
            ? { visibility: "hidden" }
            : { background: cell.shade?.color }
        }
        value={cell}
      />
    ))}
  </ComboboxPrimitive.Row>
);

/** The name and value of the swatch the keyboard or the pointer is on, or of the field's own. */
const SwatchReadout = ({ swatch }: { swatch: StyleOption | null }) => (
  <div
    aria-hidden
    className="flex h-6 items-center gap-2 px-2 font-body-small text-muted-foreground"
    data-slot="swatch-readout"
  >
    {swatch?.shade ? (
      <>
        <span className="text-foreground">{swatch.label}</span>
        <span>{swatch.shade.color}</span>
      </>
    ) : null}
  </div>
);

const Option = ({ item }: { item: StyleOption }) => (
  <>
    {item.preview}
    <span className="truncate">{item.label}</span>
    <span className="ml-auto flex items-center gap-1.5 pl-3 font-body-small text-muted-foreground">
      {hintsOf(item).map((hint) => (
        <span key={hint}>{hint}</span>
      ))}
    </span>
  </>
);

/** One item of the list as it is drawn: a way onto the system, a value typed, or an option. */
const ItemRow = ({
  item,
  outside,
}: {
  item: Item;
  outside: ((value: string) => boolean) | undefined;
}) => {
  if (item.way) {
    return <WayItem item={item} />;
  }
  if (item.custom) {
    return (
      <ArbitraryItem arbitrary={outside?.(item.value) ?? false} item={item} />
    );
  }
  return <Option item={item} />;
};

const WayItem = ({ item }: { item: Item }) => (
  <>
    <span className="truncate">{item.label}</span>
    {item.way === "nearest" ? (
      <span className="ml-auto flex items-center gap-1.5 pl-3 font-body-small text-muted-foreground">
        <span>{item.description}</span>
        {item.shown ? <span>{item.shown}</span> : null}
      </span>
    ) : null}
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
    <span className="ml-auto pl-3 font-body-small text-muted-foreground">
      {item.value}
    </span>
  </>
);
