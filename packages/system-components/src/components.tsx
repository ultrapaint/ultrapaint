/**
 * The system components, drawn (ADR 0040): Base UI's behaviour, every part marked with its `data-slot`
 * for the look (`look.ts`, then the design's specs) to style. The renderer gives each one the
 * props of its instance, its children (the default slot) and the nodes of its other slots
 * (`slots`), and the node's marks and box (`data-ed-*`, `style`), which go on the element that is
 * the instance on the page.
 *
 * An overlay is its trigger in the page's flow and its popup in the frame's body: drawn open, the
 * popup carries the node's marks too, so it can be pointed at and measured; its parts are marked
 * for the specs (`data-ed-p`) as they are not inside the instance's element.
 */
import { Avatar } from "@base-ui/react/avatar";
import { Checkbox } from "@base-ui/react/checkbox";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { Separator } from "@base-ui/react/separator";
import { Switch } from "@base-ui/react/switch";
import { Tabs } from "@base-ui/react/tabs";
import { Tooltip } from "@base-ui/react/tooltip";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useComponentFrame, useOverlayOpen } from "./frame.ts";

/** What the renderer gives a system component besides its instance's props. */
export interface SystemComponentProps {
  readonly children?: ReactNode;
  readonly onClickCapture?: (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => void;
  /** The nodes of each named slot. */
  readonly slots?: Readonly<Record<string, ReactNode>>;
  readonly style?: CSSProperties;
  readonly [prop: string]: unknown;
}

/** The marks of the node (`data-*`), its box and a link's handler: what the instance's element carries. */
const marksOf = (props: SystemComponentProps) => {
  const marks: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("data-") && value !== undefined) {
      marks[key] = value;
    }
  }
  return marks;
};

/**
 * The marks a portalled part carries: the node's (so it is pointed at and measured as the
 * instance), and the component's for the specs as a portal (`data-ed-p`), not as its root.
 */
const portalMarksOf = (props: SystemComponentProps) => {
  const { "data-ed-c": component, ...marks } = marksOf(props);
  return component === undefined ? marks : { ...marks, "data-ed-p": component };
};

const str = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" ? String(value) : fallback;
};
const bool = (value: unknown) => value === true;
/** A list prop: an array, or a string of comma-separated items as a person might type it. */
const items = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => str(item)).filter((item) => item !== "");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};
/** Whether a slot was given anything to draw. */
const has = (node: ReactNode) =>
  node !== undefined && node !== null && node !== false;

/** The marks the specs find a portal by: the component as a portal, its variant props, a pinned state. */
const specMarksOf = (props: SystemComponentProps) => ({
  "data-ed-p": props["data-ed-c"],
  "data-ed-state": props["data-ed-state"],
  "data-ed-v": props["data-ed-v"],
});

/** The frame's body, where popups go; nothing without a frame (a test, a picture still building). */
const usePortal = () => useComponentFrame().container ?? undefined;

/* ---------------- Inline ---------------- */

export function Button(props: SystemComponentProps) {
  const loading = bool(props.loading);
  return (
    <button
      type="button"
      {...marksOf(props)}
      data-loading={loading || undefined}
      data-size={str(props.size, "md")}
      data-slot="root"
      data-system="button"
      data-variant={str(props.variant, "primary")}
      disabled={bool(props.disabled) || loading}
      onClickCapture={props.onClickCapture}
      style={props.style}
    >
      {loading && <span aria-hidden data-slot="button-spinner" />}
      {props.children}
    </button>
  );
}

export function Badge(props: SystemComponentProps) {
  return (
    <span
      {...marksOf(props)}
      data-slot="root"
      data-system="badge"
      data-variant={str(props.variant, "default")}
      onClickCapture={props.onClickCapture}
      style={props.style}
    >
      {props.children}
    </span>
  );
}

/** The button's spinner on its own. */
export function Spinner(props: SystemComponentProps) {
  return (
    <span
      aria-label="Loading"
      role="status"
      {...marksOf(props)}
      data-size={str(props.size, "md")}
      data-slot="root"
      data-system="spinner"
      onClickCapture={props.onClickCapture}
      style={props.style}
    />
  );
}

export function SystemAvatar(props: SystemComponentProps) {
  const src = str(props.src);
  return (
    <Avatar.Root
      {...marksOf(props)}
      data-size={str(props.size, "md")}
      data-slot="root"
      data-system="avatar"
      onClickCapture={props.onClickCapture}
      style={props.style}
    >
      {src && <Avatar.Image data-slot="avatar-image" src={src} />}
      <Avatar.Fallback data-slot="avatar-fallback">
        {str(props.fallback, "AL")}
      </Avatar.Fallback>
    </Avatar.Root>
  );
}

export function Card(props: SystemComponentProps) {
  const title = str(props.title);
  const description = str(props.description);
  const header = props.slots?.["card-header"];
  const footer = props.slots?.["card-footer"];
  return (
    <div
      {...marksOf(props)}
      data-slot="root"
      data-system="card"
      onClickCapture={props.onClickCapture}
      style={props.style}
    >
      {has(header) || title || description ? (
        <div data-slot="card-header">
          {header ?? (
            <>
              {title && <div data-slot="card-title">{title}</div>}
              {description && (
                <div data-slot="card-description">{description}</div>
              )}
            </>
          )}
        </div>
      ) : null}
      {has(props.children) ? (
        <div data-slot="card-content">{props.children}</div>
      ) : null}
      {has(footer) ? <div data-slot="card-footer">{footer}</div> : null}
    </div>
  );
}

export function SystemSeparator(props: SystemComponentProps) {
  const orientation =
    str(props.orientation, "horizontal") === "vertical"
      ? "vertical"
      : "horizontal";
  return (
    <Separator
      {...marksOf(props)}
      data-slot="root"
      data-system="separator"
      orientation={orientation}
      style={props.style}
    />
  );
}

const Label = ({ text }: { readonly text: string }) =>
  text ? <span data-slot="field-label">{text}</span> : null;

export function Input(props: SystemComponentProps) {
  return (
    <label
      {...marksOf(props)}
      data-slot="root"
      data-system="field"
      onClickCapture={props.onClickCapture}
      style={props.style}
    >
      <Label text={str(props.label)} />
      <input
        aria-invalid={bool(props.invalid) || undefined}
        data-size={str(props.size, "md")}
        data-slot="input"
        defaultValue={str(props.value)}
        disabled={bool(props.disabled)}
        key={str(props.value)}
        placeholder={str(props.placeholder)}
        type={str(props.type, "text")}
      />
    </label>
  );
}

export function Textarea(props: SystemComponentProps) {
  const rows = typeof props.rows === "number" ? props.rows : 3;
  return (
    <label
      {...marksOf(props)}
      data-slot="root"
      data-system="field"
      onClickCapture={props.onClickCapture}
      style={props.style}
    >
      <Label text={str(props.label)} />
      <textarea
        aria-invalid={bool(props.invalid) || undefined}
        data-slot="textarea"
        defaultValue={str(props.value)}
        disabled={bool(props.disabled)}
        key={str(props.value)}
        placeholder={str(props.placeholder)}
        rows={rows}
      />
    </label>
  );
}

export function SystemCheckbox(props: SystemComponentProps) {
  const checked = bool(props.checked);
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's control, inside the label, is a button with its role
    <label
      {...marksOf(props)}
      data-slot="root"
      data-system="check"
      onClickCapture={props.onClickCapture}
      style={props.style}
    >
      <Checkbox.Root
        data-slot="checkbox"
        defaultChecked={checked}
        disabled={bool(props.disabled)}
        key={String(checked)}
      >
        <Checkbox.Indicator data-slot="checkbox-indicator">
          <svg aria-hidden viewBox="0 0 16 16">
            <path
              d="m3.5 8.5 3 3 6-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </Checkbox.Indicator>
      </Checkbox.Root>
      {str(props.label) && (
        <span data-slot="field-label">{str(props.label)}</span>
      )}
    </label>
  );
}

export function SystemSwitch(props: SystemComponentProps) {
  const checked = bool(props.checked);
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's control, inside the label, is a button with its role
    <label
      {...marksOf(props)}
      data-slot="root"
      data-system="check"
      onClickCapture={props.onClickCapture}
      style={props.style}
    >
      <Switch.Root
        data-slot="switch"
        defaultChecked={checked}
        disabled={bool(props.disabled)}
        key={String(checked)}
      >
        <Switch.Thumb data-slot="switch-thumb" />
      </Switch.Root>
      {str(props.label) && (
        <span data-slot="field-label">{str(props.label)}</span>
      )}
    </label>
  );
}

export function SystemTabs(props: SystemComponentProps) {
  const labels = items(props.items);
  const designed = str(props.value) || labels[0] || "";
  const { interactive } = useComponentFrame();
  return (
    <Tabs.Root
      {...marksOf(props)}
      data-slot="root"
      data-system="tabs"
      // Designed, the design's tab is selected; running, it is where the user starts.
      key={interactive ? `run:${designed}` : "designed"}
      {...(interactive ? { defaultValue: designed } : { value: designed })}
      onClickCapture={props.onClickCapture}
      style={props.style}
    >
      <Tabs.List data-slot="tabs-list">
        {labels.map((label) => (
          <Tabs.Tab data-slot="tab" key={label} value={label}>
            {label}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator data-slot="tabs-indicator" />
      </Tabs.List>
      {/* The children are the designed tab's panel: what another tab shows is not drawn. */}
      <div data-slot="tab-panel">{props.children}</div>
    </Tabs.Root>
  );
}

/* ---------------- Anchored ---------------- */

export function SystemSelect(props: SystemComponentProps) {
  const options = items(props.items);
  const container = usePortal();
  const { open, onOpenChange, interactive } = useOverlayOpen(
    props.open as boolean | undefined
  );
  const value = str(props.value);
  return (
    <Select.Root
      items={options.map((label) => ({ label, value: label }))}
      key={interactive ? `run:${value}` : "designed"}
      {...(interactive
        ? { defaultValue: value || null }
        : { value: value || null })}
      disabled={bool(props.disabled)}
      modal={interactive}
      onOpenChange={onOpenChange}
      open={open}
    >
      <div
        {...marksOf(props)}
        data-slot="root"
        data-system="field"
        onClickCapture={props.onClickCapture}
        style={props.style}
      >
        {str(props.label) && (
          <Select.Label data-slot="field-label">
            {str(props.label)}
          </Select.Label>
        )}
        <Select.Trigger data-slot="select-trigger">
          <Select.Value
            data-slot="select-value"
            placeholder={str(props.placeholder, "Choose…")}
          />
          <Select.Icon data-slot="select-icon">
            <Chevron />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal container={container}>
        <Select.Positioner
          {...portalMarksOf(props)}
          // Aligning the chosen item over the trigger places the popup in the window's
          // coordinates, which a frame's containment moves: it opens below instead.
          alignItemWithTrigger={false}
          collisionPadding={0}
          data-system-positioner=""
          sideOffset={6}
        >
          <Select.Popup data-slot="select-popup" data-system-popup="">
            <Select.List>
              {options.map((label) => (
                <Select.Item data-slot="select-item" key={label} value={label}>
                  <Select.ItemIndicator data-slot="select-item-indicator">
                    <Check />
                  </Select.ItemIndicator>
                  <Select.ItemText>{label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function SystemMenu(props: SystemComponentProps) {
  const entries = items(props.items);
  const container = usePortal();
  const { open, onOpenChange, interactive } = useOverlayOpen(
    props.open as boolean | undefined
  );
  const align = str(props.align, "start") as "start" | "center" | "end";
  return (
    <Menu.Root modal={interactive} onOpenChange={onOpenChange} open={open}>
      <Menu.Trigger
        nativeButton={false}
        render={
          <span
            {...marksOf(props)}
            data-slot="root"
            data-system="trigger"
            onClickCapture={props.onClickCapture}
            style={props.style}
          />
        }
      >
        {props.children}
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Positioner
          {...portalMarksOf(props)}
          align={align}
          collisionPadding={0}
          data-system-positioner=""
          sideOffset={6}
        >
          <Menu.Popup data-slot="menu-popup" data-system-popup="">
            {entries.map((label, i) =>
              label === "-" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: separators have no other name
                <Menu.Separator data-slot="menu-separator" key={`-${i}`} />
              ) : (
                <Menu.Item data-slot="menu-item" key={label}>
                  {label}
                </Menu.Item>
              )
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const SIDES = new Set(["top", "bottom", "left", "right"]);
const sideOf = (value: unknown, fallback: "top" | "bottom") => {
  const side = str(value, fallback);
  return (SIDES.has(side) ? side : fallback) as
    | "top"
    | "bottom"
    | "left"
    | "right";
};

export function SystemPopover(props: SystemComponentProps) {
  const container = usePortal();
  const { open, onOpenChange, interactive } = useOverlayOpen(
    props.open as boolean | undefined
  );
  const title = str(props.title);
  return (
    <Popover.Root onOpenChange={onOpenChange} open={open}>
      <Popover.Trigger
        nativeButton={false}
        render={
          <span
            {...marksOf(props)}
            data-slot="trigger"
            data-system="trigger"
            onClickCapture={props.onClickCapture}
            style={props.style}
          />
        }
      >
        {props.slots?.trigger}
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Positioner
          {...portalMarksOf(props)}
          collisionPadding={0}
          data-system-positioner=""
          side={sideOf(props.side, "bottom")}
          sideOffset={8}
        >
          <Popover.Popup
            data-slot="popover"
            data-system-popup=""
            finalFocus={interactive}
            initialFocus={interactive}
          >
            {title && (
              <Popover.Title data-slot="popover-title">{title}</Popover.Title>
            )}
            <div data-slot="popover-content">{props.children}</div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function SystemTooltip(props: SystemComponentProps) {
  const container = usePortal();
  const { open, onOpenChange } = useOverlayOpen(
    props.open as boolean | undefined
  );
  return (
    <Tooltip.Provider delay={300}>
      <Tooltip.Root onOpenChange={onOpenChange} open={open}>
        <Tooltip.Trigger
          render={
            <span
              {...marksOf(props)}
              data-slot="root"
              data-system="trigger"
              onClickCapture={props.onClickCapture}
              style={props.style}
            />
          }
        >
          {props.children}
        </Tooltip.Trigger>
        <Tooltip.Portal container={container}>
          <Tooltip.Positioner
            {...portalMarksOf(props)}
            collisionPadding={0}
            data-system-positioner=""
            side={sideOf(props.side, "top")}
            sideOffset={8}
          >
            <Tooltip.Popup data-slot="tooltip">
              {str(props.content, "A helpful hint")}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/**
 * A notification in the frame's corner. It has no trigger: a design shows it (`open`), as the
 * state of a page after something happened.
 */
export function Toast(props: SystemComponentProps) {
  const { container } = useComponentFrame();
  const { open } = useOverlayOpen(props.open as boolean | undefined);
  if (!(open && container)) {
    return null;
  }
  return createPortal(
    <div data-system-toasts="">
      <div
        {...marksOf(props)}
        data-slot="root"
        data-system="toast"
        data-variant={str(props.variant, "default")}
        onClickCapture={props.onClickCapture}
        role="status"
        style={props.style}
      >
        <div data-slot="toast-title">{str(props.title)}</div>
        {str(props.description) && (
          <div data-slot="toast-description">{str(props.description)}</div>
        )}
        {has(props.children) ? (
          <div data-slot="toast-action">{props.children}</div>
        ) : null}
      </div>
    </div>,
    container
  );
}

/* ---------------- Blocking ---------------- */

export function SystemDialog(props: SystemComponentProps) {
  const container = usePortal();
  const { open, onOpenChange, interactive } = useOverlayOpen(
    props.open as boolean | undefined
  );
  const title = str(props.title);
  const description = str(props.description);
  const trigger = props.slots?.trigger;
  const header = props.slots?.["dialog-header"];
  const footer = props.slots?.["dialog-footer"];
  const marks = marksOf(props);
  return (
    <Dialog.Root
      // The backdrop is the frame's: the editor around it keeps working.
      modal={interactive ? "trap-focus" : false}
      onOpenChange={onOpenChange}
      open={open}
    >
      {has(trigger) && (
        <Dialog.Trigger
          nativeButton={false}
          render={
            <span
              // Closed, the trigger is the instance on the page; open, the dialog is.
              {...(open ? {} : marks)}
              data-slot="trigger"
              data-system="trigger"
              onClickCapture={props.onClickCapture}
            />
          }
        >
          {trigger}
        </Dialog.Trigger>
      )}
      <Dialog.Portal
        container={container}
        {...specMarksOf(props)}
        data-system-dialog=""
      >
        <Dialog.Backdrop data-slot="dialog-backdrop" />
        <Dialog.Popup
          {...(open ? portalMarksOf(props) : {})}
          data-size={str(props.size, "md")}
          data-slot="dialog"
          finalFocus={interactive}
          initialFocus={interactive}
          style={props.style}
        >
          {has(header) || title || description ? (
            <div data-slot="dialog-header">
              {header ?? (
                <>
                  {title && (
                    <Dialog.Title data-slot="dialog-title">
                      {title}
                    </Dialog.Title>
                  )}
                  {description && (
                    <Dialog.Description data-slot="dialog-description">
                      {description}
                    </Dialog.Description>
                  )}
                </>
              )}
            </div>
          ) : null}
          {has(props.children) ? (
            <div data-slot="dialog-content">{props.children}</div>
          ) : null}
          {has(footer) ? <div data-slot="dialog-footer">{footer}</div> : null}
          <Dialog.Close aria-label="Close" data-slot="dialog-close">
            <Cross />
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ---------------- Icons ---------------- */

const Chevron = () => (
  <svg aria-hidden viewBox="0 0 16 16">
    <path
      d="m4 6 4 4 4-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);
const Check = () => (
  <svg aria-hidden viewBox="0 0 16 16">
    <path
      d="m3.5 8.5 3 3 6-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    />
  </svg>
);
const Cross = () => (
  <svg aria-hidden viewBox="0 0 16 16">
    <path
      d="m4 4 8 8M12 4l-8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

/** Every system component's component, by the name its instances give. */
export const SYSTEM_COMPONENT_VIEWS: Readonly<
  Record<string, (props: SystemComponentProps) => ReactNode>
> = {
  Avatar: SystemAvatar,
  Badge,
  Button,
  Card,
  Checkbox: SystemCheckbox,
  Dialog: SystemDialog,
  Input,
  Menu: SystemMenu,
  Popover: SystemPopover,
  Select: SystemSelect,
  Separator: SystemSeparator,
  Spinner,
  Switch: SystemSwitch,
  Tabs: SystemTabs,
  Textarea,
  Toast,
  Tooltip: SystemTooltip,
};
