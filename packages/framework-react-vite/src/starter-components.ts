/**
 * The starter's components (ADR 0040): one for each of ultrapaint's system components, by the same
 * name, taking the same props, its parts marked with the system component's `data-slot`s (the root
 * `root`, as a look names it), its variants in a `cva` whose axes and members are the
 * system component's, and on Base UI where the system component is. A system component's slots are parts here: a
 * Dialog's footer is a `DialogFooter` among its children, as the Code tab writes it. Implementing
 * a design then gives each its component file's look, part by part.
 */
import { applicationFileOf } from "@ultrapaint/contracts/catalogue";

const CHECK_ICON = `<svg
            aria-hidden="true"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            viewBox="0 0 24 24"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>`;

const CHEVRON_ICON = `<svg
            aria-hidden="true"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>`;

/** A popup's surface: a select's, a menu's, a popover's. */
const POPUP =
  "origin-(--transform-origin) rounded-md bg-popover text-popover-foreground text-sm shadow-lg outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

/** How a compound component finds its parts among its children. */
const PARTS = `import { Children, isValidElement, type ReactNode } from "react";

/**
 * A component's children sorted out: the rest first, then what each of \`parts\` holds, the
 * children of every element of that part (a DialogFooter's buttons).
 */
export function split(children: ReactNode, ...parts: readonly unknown[]): ReactNode[][] {
  const all = Children.toArray(children);
  const partOf = (child: ReactNode) => (isValidElement(child) ? parts.indexOf(child.type) : -1);
  return [
    all.filter((child) => partOf(child) === -1),
    ...parts.map((_, at) =>
      all
        .filter((child) => partOf(child) === at)
        .flatMap((child) =>
          isValidElement<{ children?: ReactNode }>(child) ? Children.toArray(child.props.children) : []
        )
    ),
  ];
}

/** A part of a component: it holds what goes there, and its component puts it in place. */
export function part(name: string) {
  const Part = ({ children }: { children?: ReactNode }) => children;
  Part.displayName = name;
  return Part;
}
`;

/** How a Select, a Menu and Tabs read their items, as the system components do. */
const ITEMS = `/** An item of a list: its label, or its label with a picture for an item drawn with one. */
export type Item = string | { image?: string; label: string };

/**
 * A list's items, each with its label: given as labels, as \`{ label, image }\`, or as one string
 * of labels with commas between them. An item with no label is left out.
 */
export function itemsOf(items: readonly Item[] | string): { image?: string; label: string }[] {
  const list: readonly Item[] = typeof items === "string" ? items.split(",").map((item) => item.trim()) : items;
  return list
    .map((item) => (typeof item === "string" ? { label: item } : item))
    .filter((item) => item.label !== "");
}
`;

const BUTTON = `import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent font-medium text-sm leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 data-loading:opacity-75 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "md",
      variant: "primary",
    },
    variants: {
      size: {
        icon: "size-9",
        lg: "h-11 px-6 text-[0.9375rem]",
        md: "h-9 px-4",
        sm: "h-8 px-3 text-[0.8125rem]",
      },
      variant: {
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "h-auto px-0 text-primary underline underline-offset-4",
        outline: "border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      },
    },
  }
);

/** The action of a screen or a form; a spinner before its label while it is loading. */
function Button({
  children,
  className,
  disabled,
  loading = false,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <button
      className={cn(buttonVariants({ className, size, variant }))}
      data-loading={loading || undefined}
      data-slot="root"
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
          data-slot="button-spinner"
        />
      ) : null}
      {children}
    </button>
  );
}

export { Button, buttonVariants };
`;

const BADGE = `import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2.5 py-0.5 font-semibold text-xs [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
        secondary: "bg-secondary text-secondary-foreground",
      },
    },
  }
);

/** A short label: a status, a count, a tag. */
function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ className, variant }))} data-slot="root" {...props} />;
}

export { Badge, badgeVariants };
`;

const SPINNER = `import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";

const spinnerVariants = cva(
  "inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent",
  {
    defaultVariants: {
      size: "md",
    },
    variants: {
      size: {
        lg: "size-6",
        md: "size-4",
        sm: "size-3 border-[1.5px]",
      },
    },
  }
);

/** Something is under way. */
function Spinner({
  className,
  size = "md",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof spinnerVariants>) {
  return (
    <span
      aria-label="Loading"
      className={cn(spinnerVariants({ className, size }))}
      data-slot="root"
      role="status"
      {...props}
    />
  );
}

export { Spinner, spinnerVariants };
`;

const AVATAR = `import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const avatarVariants = cva(
  "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary font-medium text-secondary-foreground",
  {
    defaultVariants: {
      size: "md",
    },
    variants: {
      size: {
        lg: "size-14 text-lg",
        md: "size-10 text-sm",
        sm: "size-8 text-xs",
      },
    },
  }
);

/** A picture of a person, or their initials when there is none. */
function Avatar({
  className,
  fallback,
  size = "md",
  src,
  ...props
}: AvatarPrimitive.Root.Props & VariantProps<typeof avatarVariants> & { fallback?: string; src?: string }) {
  return (
    <AvatarPrimitive.Root className={cn(avatarVariants({ className, size }))} data-slot="root" {...props}>
      {src ? <AvatarPrimitive.Image className="size-full object-cover" data-slot="avatar-image" src={src} /> : null}
      <AvatarPrimitive.Fallback data-slot="avatar-fallback">{fallback}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export { Avatar, avatarVariants };
`;

const CARD = `import type * as React from "react";
import { cn } from "@/lib/cn";
import { part, split } from "@/lib/parts";

/** What goes in a card's header in place of its title and description. */
const CardHeader = part("CardHeader");
/** What goes in a card's footer: its actions. */
const CardFooter = part("CardFooter");

/** A surface that groups content: a header with a title and a description, content, a footer. */
function Card({
  children,
  className,
  description,
  title,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & { description?: string; title?: string }) {
  const [content, header, footer] = split(children, CardHeader, CardFooter);
  return (
    <div
      className={cn(
        "flex flex-col gap-6 rounded-lg border bg-card py-6 text-card-foreground shadow-sm",
        className
      )}
      data-slot="root"
      {...props}
    >
      {header.length > 0 || title || description ? (
        <div className="flex flex-col gap-1.5 px-6" data-slot="card-header">
          {header.length > 0 ? (
            header
          ) : (
            <>
              {title ? (
                <div className="font-semibold leading-tight" data-slot="card-title">
                  {title}
                </div>
              ) : null}
              {description ? (
                <div className="text-muted-foreground text-sm" data-slot="card-description">
                  {description}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {content.length > 0 ? (
        <div className="flex flex-col gap-3 px-6" data-slot="card-content">
          {content}
        </div>
      ) : null}
      {footer.length > 0 ? (
        <div className="flex items-center gap-2 px-6" data-slot="card-footer">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export { Card, CardFooter, CardHeader };
`;

const SEPARATOR = `import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const separatorVariants = cva("shrink-0 bg-border", {
  defaultVariants: {
    orientation: "horizontal",
  },
  variants: {
    orientation: {
      horizontal: "h-px w-full",
      vertical: "w-px self-stretch",
    },
  },
});

/** A line between groups of content. */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props & VariantProps<typeof separatorVariants>) {
  return (
    <SeparatorPrimitive
      className={cn(separatorVariants({ className, orientation }))}
      data-slot="root"
      orientation={orientation ?? "horizontal"}
      {...props}
    />
  );
}

export { Separator, separatorVariants };
`;

/** A field's label and the box a value is typed in, as the Input and the Textarea share them. */
const FIELD_LABEL =
  '<span className="font-medium text-foreground text-sm leading-tight" data-slot="field-label">';
const FIELD_BOX =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

const INPUT = `import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { part, split } from "@/lib/parts";

/** The icon at the start of the field's box: an envelope in an email field. */
const InputIcon = part("InputIcon");

const inputVariants = cva(
  "${FIELD_BOX}",
  {
    defaultVariants: {
      size: "md",
    },
    variants: {
      size: {
        lg: "h-11",
        md: "h-9",
        sm: "h-8",
      },
    },
  }
);

/** A text field, with an optional label above it and an icon at the start of its box. */
function Input({
  children,
  className,
  invalid,
  label,
  size = "md",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> &
  VariantProps<typeof inputVariants> & { invalid?: boolean; label?: string }) {
  const [, icon] = split(children, InputIcon);
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(inputVariants({ size }), icon.length > 0 && "ps-9")}
      data-slot="input"
      {...props}
    />
  );
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)} data-slot="root">
      {label ? ${FIELD_LABEL}{label}</span> : null}
      {icon.length > 0 ? (
        <span className="relative flex min-w-0 flex-col">
          <span
            className="pointer-events-none absolute inset-y-0 start-3 flex items-center gap-1 text-muted-foreground data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0"
            data-disabled={props.disabled || undefined}
            data-slot="input-icon"
          >
            {icon}
          </span>
          {input}
        </span>
      ) : (
        input
      )}
    </label>
  );
}

export { Input, InputIcon, inputVariants };
`;

const TEXTAREA = `import type * as React from "react";
import { cn } from "@/lib/cn";

/** A text field of several lines, with an optional label above it. */
function Textarea({
  className,
  invalid,
  label,
  rows = 3,
  ...props
}: React.ComponentProps<"textarea"> & { invalid?: boolean; label?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)} data-slot="root">
      {label ? ${FIELD_LABEL}{label}</span> : null}
      <textarea
        aria-invalid={invalid || undefined}
        className="${FIELD_BOX} min-h-16 resize-y py-2"
        data-slot="textarea"
        rows={rows}
        {...props}
      />
    </label>
  );
}

export { Textarea };
`;

const CHECKBOX = `import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "@/lib/cn";

/** A box that is ticked or not, with its label. */
function Checkbox({ className, label, ...props }: CheckboxPrimitive.Root.Props & { label?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's control, inside the label, is a button with its role.
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)} data-slot="root">
      <CheckboxPrimitive.Root
        className="inline-grid size-4 shrink-0 place-items-center rounded-[0.25rem] border border-input bg-transparent text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50"
        data-slot="checkbox"
        {...props}
      >
        <CheckboxPrimitive.Indicator className="flex" data-slot="checkbox-indicator">
          ${CHECK_ICON}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label ? <span data-slot="field-label">{label}</span> : null}
    </label>
  );
}

export { Checkbox };
`;

const SWITCH = `import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/cn";

/** A switch that is on or off, with its label. */
function Switch({ className, label, ...props }: SwitchPrimitive.Root.Props & { label?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's control, inside the label, is a button with its role.
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)} data-slot="root">
      <SwitchPrimitive.Root
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50"
        data-slot="switch"
        {...props}
      >
        <SwitchPrimitive.Thumb
          className="block size-4 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-4"
          data-slot="switch-thumb"
        />
      </SwitchPrimitive.Root>
      {label ? <span data-slot="field-label">{label}</span> : null}
    </label>
  );
}

export { Switch };
`;

const TABS = `import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { type Item, itemsOf } from "@/lib/items";

/** Tabs, one panel at a time: the children are the selected tab's panel. */
function Tabs({
  children,
  className,
  items = [],
  value,
}: {
  children?: React.ReactNode;
  className?: string;
  items?: readonly Item[] | string;
  value?: string;
}) {
  const labels = itemsOf(items).map((item) => item.label);
  const selected = value ?? labels[0];
  return (
    <TabsPrimitive.Root className={cn("flex flex-col gap-4", className)} data-slot="root" defaultValue={selected}>
      <TabsPrimitive.List className="relative flex gap-1 border-b" data-slot="tabs-list">
        {labels.map((label) => (
          <TabsPrimitive.Tab
            className="cursor-pointer px-3 py-2 font-medium text-muted-foreground text-sm outline-none hover:text-foreground data-active:text-foreground"
            data-slot="tab"
            key={label}
            value={label}
          >
            {label}
          </TabsPrimitive.Tab>
        ))}
        <TabsPrimitive.Indicator
          className="absolute bottom-[-1px] left-(--active-tab-left) h-0.5 w-(--active-tab-width) bg-primary transition-[left,width]"
          data-slot="tabs-indicator"
        />
      </TabsPrimitive.List>
      <TabsPrimitive.Panel className="flex flex-col gap-3" data-slot="tab-panel" value={selected}>
        {children}
      </TabsPrimitive.Panel>
    </TabsPrimitive.Root>
  );
}

export { Tabs };
`;

const SELECT = `import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "@/lib/cn";
import { type Item, itemsOf } from "@/lib/items";

/** A choice of one among a list, which opens below its trigger. */
function Select({
  className,
  disabled,
  items = [],
  label,
  onValueChange,
  open,
  placeholder = "Choose…",
  value,
}: {
  className?: string;
  disabled?: boolean;
  items?: readonly Item[] | string;
  label?: string;
  onValueChange?: (value: string | null) => void;
  open?: boolean;
  placeholder?: string;
  value?: string;
}) {
  const options = itemsOf(items);
  return (
    <SelectPrimitive.Root
      defaultOpen={open}
      defaultValue={value ?? null}
      disabled={disabled}
      items={options.map((option) => ({ label: option.label, value: option.label }))}
      onValueChange={onValueChange}
    >
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)} data-slot="root">
        {label ? (
          <SelectPrimitive.Label className="font-medium text-foreground text-sm leading-tight" data-slot="field-label">
            {label}
          </SelectPrimitive.Label>
        ) : null}
        <SelectPrimitive.Trigger
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-popup-open:border-ring"
          data-slot="select-trigger"
        >
          <SelectPrimitive.Value
            className="truncate data-placeholder:text-muted-foreground"
            data-slot="select-value"
            placeholder={placeholder}
          />
          <SelectPrimitive.Icon className="flex text-muted-foreground" data-slot="select-icon">
            ${CHEVRON_ICON}
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
      </div>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner alignItemWithTrigger={false} className="z-50 outline-none" sideOffset={6}>
          <SelectPrimitive.Popup
            className="${POPUP} max-h-(--available-height) min-w-(--anchor-width) overflow-auto p-1"
            data-slot="select-popup"
          >
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectPrimitive.Item
                  className="relative flex cursor-default select-none items-center gap-2 rounded-sm py-1.5 pr-2 pl-7 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  data-slot="select-item"
                  key={option.label}
                  value={option.label}
                >
                  <SelectPrimitive.ItemIndicator className="absolute left-2 flex" data-slot="select-item-indicator">
                    ${CHECK_ICON}
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { Select };
`;

const MENU = `import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";
import { type Item, itemsOf } from "@/lib/items";

/** A menu of actions, opened by its trigger: the children. An item \`-\` is a separator. */
function Menu({
  align = "start",
  children,
  items = [],
  onSelect,
  open,
}: {
  align?: "start" | "center" | "end";
  children?: React.ReactNode;
  items?: readonly Item[] | string;
  onSelect?: (item: string) => void;
  open?: boolean;
}) {
  return (
    <MenuPrimitive.Root defaultOpen={open}>
      <MenuPrimitive.Trigger
        className="inline-flex items-center gap-2"
        data-slot="root"
        nativeButton={false}
        render={<span />}
      >
        {children}
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner align={align} className="z-50 outline-none" sideOffset={6}>
          <MenuPrimitive.Popup className="${POPUP} min-w-40 p-1" data-slot="menu-popup">
            {itemsOf(items).map(({ label }, at) =>
              label === "-" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: separators have no other name.
                <MenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" data-slot="menu-separator" key={\`-\${at}\`} />
              ) : (
                <MenuPrimitive.Item
                  className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  data-slot="menu-item"
                  key={label}
                  onClick={() => onSelect?.(label)}
                >
                  {label}
                </MenuPrimitive.Item>
              )
            )}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export { Menu };
`;

const POPOVER = `import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type * as React from "react";
import { part, split } from "@/lib/parts";

/** What opens a popover. */
const PopoverTrigger = part("PopoverTrigger");

/**
 * A panel that opens next to its trigger without blocking the page: a PopoverTrigger among the
 * children opens it, the rest are its content.
 */
function Popover({
  children,
  open,
  side = "bottom",
  title,
}: {
  children?: React.ReactNode;
  open?: boolean;
  side?: "bottom" | "top" | "left" | "right";
  title?: string;
}) {
  const [content, trigger] = split(children, PopoverTrigger);
  return (
    <PopoverPrimitive.Root defaultOpen={open}>
      <PopoverPrimitive.Trigger
        className="inline-flex items-center gap-2"
        data-slot="trigger"
        nativeButton={false}
        render={<span />}
      >
        {trigger}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner className="z-50 outline-none" side={side} sideOffset={8}>
          <PopoverPrimitive.Popup className="${POPUP} w-72 p-4" data-slot="popover">
            {title ? (
              <PopoverPrimitive.Title className="mb-2 font-semibold text-[0.9375rem]" data-slot="popover-title">
                {title}
              </PopoverPrimitive.Title>
            ) : null}
            <div className="flex flex-col gap-2" data-slot="popover-content">
              {content}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export { Popover, PopoverTrigger };
`;

const TOOLTIP = `import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type * as React from "react";

/** A hint that shows when its trigger, the children, is hovered or focused. */
function Tooltip({
  children,
  content,
  open,
  side = "top",
}: {
  children?: React.ReactNode;
  content?: string;
  open?: boolean;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Provider delay={300}>
      <TooltipPrimitive.Root defaultOpen={open}>
        <TooltipPrimitive.Trigger className="inline-flex items-center gap-2" data-slot="root" render={<span />}>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner className="z-50" side={side} sideOffset={8}>
            <TooltipPrimitive.Popup
              className="max-w-64 origin-(--transform-origin) rounded-sm bg-primary px-2.5 py-1.5 text-primary-foreground text-xs leading-snug transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
              data-slot="tooltip"
            >
              {content}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export { Tooltip };
`;

const DIALOG = `import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { part, split } from "@/lib/parts";

/** What opens the dialog. */
const DialogTrigger = part("DialogTrigger");
/** What goes in the dialog's header in place of its title and description. */
const DialogHeader = part("DialogHeader");
/** The dialog's actions. */
const DialogFooter = part("DialogFooter");

const dialogVariants = cva(
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-auto rounded-lg border bg-background p-6 text-foreground shadow-lg outline-none transition-[opacity,scale] duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:border-b-0",
  {
    defaultVariants: {
      size: "md",
    },
    variants: {
      size: {
        lg: "w-[min(42rem,100%-2rem)]",
        md: "w-[min(32rem,100%-2rem)]",
        sm: "w-[min(24rem,100%-2rem)]",
      },
    },
  }
);

/**
 * A dialog over the page, which blocks it: a header with a title and a description, content (the
 * children), and a footer. Centred on a wide screen, a sheet at the bottom of a narrow one.
 */
function Dialog({
  children,
  description,
  open,
  size = "md",
  title,
}: VariantProps<typeof dialogVariants> & {
  children?: React.ReactNode;
  description?: string;
  open?: boolean;
  title?: string;
}) {
  const [content, trigger, header, footer] = split(children, DialogTrigger, DialogHeader, DialogFooter);
  return (
    <DialogPrimitive.Root defaultOpen={open}>
      {trigger.length > 0 ? (
        <DialogPrimitive.Trigger
          className="inline-flex items-center gap-2"
          data-slot="trigger"
          nativeButton={false}
          render={<span />}
        >
          {trigger}
        </DialogPrimitive.Trigger>
      ) : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
          data-slot="dialog-backdrop"
        />
        <DialogPrimitive.Popup className={dialogVariants({ size })} data-slot="dialog">
          {header.length > 0 || title || description ? (
            <div className="flex flex-col gap-2 pr-6" data-slot="dialog-header">
              {header.length > 0 ? (
                header
              ) : (
                <>
                  {title ? (
                    <DialogPrimitive.Title className="font-semibold text-lg leading-snug" data-slot="dialog-title">
                      {title}
                    </DialogPrimitive.Title>
                  ) : null}
                  {description ? (
                    <DialogPrimitive.Description className="text-muted-foreground text-sm" data-slot="dialog-description">
                      {description}
                    </DialogPrimitive.Description>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          {content.length > 0 ? (
            <div className="flex flex-col gap-3" data-slot="dialog-content">
              {content}
            </div>
          ) : null}
          {footer.length > 0 ? (
            <div className="flex justify-end gap-2 max-sm:flex-col-reverse" data-slot="dialog-footer">
              {footer}
            </div>
          ) : null}
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute top-4 right-4 grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            data-slot="dialog-close"
          >
            <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export { Dialog, DialogFooter, DialogHeader, DialogTrigger, dialogVariants };
`;

const TOAST = `import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";

const toastVariants = cva(
  "flex flex-col gap-1 rounded-lg border px-4 py-3.5 text-sm shadow-lg",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-popover text-popover-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
      },
    },
  }
);

/**
 * A notification in the screen's corner: a title, a description and its actions, the children.
 * Shown while \`open\`; an application usually shows it from a toaster of its own.
 */
function Toast({
  children,
  className,
  description,
  open = false,
  title,
  variant = "default",
}: VariantProps<typeof toastVariants> & {
  children?: React.ReactNode;
  className?: string;
  description?: string;
  open?: boolean;
  title?: string;
}) {
  if (!open) {
    return null;
  }
  return (
    <div className="fixed right-4 bottom-4 z-50 w-88 max-w-[calc(100%-2rem)] max-sm:right-3 max-sm:left-3 max-sm:w-auto max-sm:max-w-none">
      <div className={cn(toastVariants({ className, variant }))} data-slot="root" role="status">
        <div className="font-semibold" data-slot="toast-title">
          {title}
        </div>
        {description ? (
          <div className="opacity-85" data-slot="toast-description">
            {description}
          </div>
        ) : null}
        {children ? (
          <div className="mt-2 flex gap-2" data-slot="toast-action">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { Toast, toastVariants };
`;

/** The starter's components, one per system component, by file inside `src/` (`applicationFileOf`). */
export const STARTER_COMPONENTS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries({
      Avatar: AVATAR,
      Badge: BADGE,
      Button: BUTTON,
      Card: CARD,
      Checkbox: CHECKBOX,
      Dialog: DIALOG,
      Input: INPUT,
      Menu: MENU,
      Popover: POPOVER,
      Select: SELECT,
      Separator: SEPARATOR,
      Spinner: SPINNER,
      Switch: SWITCH,
      Tabs: TABS,
      Textarea: TEXTAREA,
      Toast: TOAST,
      Tooltip: TOOLTIP,
    }).map(([name, text]) => [
      `components/ui/${applicationFileOf(name)}.tsx`,
      text,
    ])
  ),
  "lib/items.ts": ITEMS,
  "lib/parts.ts": PARTS,
};

/** The starter's first screen, made of its components. */
export const STARTER_APP = `import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** The first screen: replace it with yours, designed in Ultrapaint and implemented here. */
export const App = () => (
  <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
    <Badge variant="secondary">New</Badge>
    <Card description="Design it in Ultrapaint, then implement it here." title="Your application">
      <Input label="Email" placeholder="you@example.com" type="email" />
      <CardFooter>
        <Button>Get started</Button>
      </CardFooter>
    </Card>
  </main>
);
`;
