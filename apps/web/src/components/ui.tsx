import { Select as BaseSelect } from "@base-ui/react/select";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn.ts";

export const Button = ({
  className,
  variant = "ghost",
  size = "sm",
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "solid" | "outline" | "danger";
  size?: "xs" | "sm" | "md";
  active?: boolean;
}) => (
  <button
    type="button"
    className={cn(
      "inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40",
      size === "xs" && "h-6 px-1.5 text-[11px]",
      size === "sm" && "h-7 px-2 text-xs",
      size === "md" && "h-8 px-3 text-xs",
      variant === "ghost" && "text-ink-2 hover:bg-panel-3 hover:text-ink",
      variant === "solid" && "bg-accent text-white hover:bg-accent-2",
      variant === "outline" && "border border-line-2 text-ink hover:bg-panel-3",
      variant === "danger" && "text-danger hover:bg-danger/10",
      active && "bg-panel-3 text-ink",
      className,
    )}
    {...props}
  />
);

export const IconButton = ({ className, ...props }: React.ComponentProps<typeof Button>) => (
  <Button className={cn("w-7 px-0", className)} {...props} />
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-7 w-full min-w-0 rounded-md border border-line bg-panel-2 px-2 text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Label = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("shrink-0 text-[11px] text-ink-3", className)} {...props} />
);

export interface SelectOption {
  value: string;
  label: string;
  preview?: React.ReactNode;
}

export const Select = ({
  value,
  onChange,
  options,
  placeholder = "—",
  className,
  disabled,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) => (
  <BaseSelect.Root
    value={value ?? ""}
    onValueChange={(v) => v !== null && onChange(String(v))}
    disabled={disabled}
  >
    <BaseSelect.Trigger
      className={cn(
        "flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md border border-line bg-panel-2 px-2 text-left text-xs text-ink outline-none focus:border-accent data-[disabled]:opacity-40",
        className,
      )}
    >
      <BaseSelect.Value placeholder={placeholder} className="truncate">
        {(v: string) => options.find((o) => o.value === v)?.label ?? v ?? placeholder}
      </BaseSelect.Value>
      <ChevronDown className="size-3 shrink-0 text-ink-3" />
    </BaseSelect.Trigger>
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={4} className="z-50">
        <BaseSelect.Popup className="max-h-72 min-w-32 overflow-auto rounded-md border border-line-2 bg-panel-2 p-1 shadow-xl">
          {options.map((o) => (
            <BaseSelect.Item
              key={o.value}
              value={o.value}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1 text-xs text-ink outline-none data-[highlighted]:bg-panel-3"
            >
              {o.preview}
              <BaseSelect.ItemText className="flex-1 truncate">{o.label}</BaseSelect.ItemText>
              <BaseSelect.ItemIndicator>
                <Check className="size-3" />
              </BaseSelect.ItemIndicator>
            </BaseSelect.Item>
          ))}
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  </BaseSelect.Root>
);

export const Segmented = <T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  className?: string;
}) => (
  <div className={cn("flex h-7 w-full rounded-md border border-line bg-panel-2 p-0.5", className)}>
    {options.map((o) => (
      <button
        type="button"
        key={o.value}
        title={o.title}
        onClick={() => onChange(o.value)}
        className={cn(
          "flex flex-1 items-center justify-center rounded text-[11px] text-ink-3 hover:text-ink",
          value === o.value && "bg-panel-3 text-ink",
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Tooltip = ({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactElement;
}) => (
  <BaseTooltip.Provider>
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={6} className="z-50">
          <BaseTooltip.Popup className="rounded bg-panel-3 px-2 py-1 text-[11px] text-ink shadow-lg">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  </BaseTooltip.Provider>
);

export const Tabs = <T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string }[];
  className?: string;
}) => (
  <div className={cn("flex h-9 shrink-0 items-center gap-1 border-line border-b px-2", className)}>
    {tabs.map((t) => (
      <button
        type="button"
        key={t.value}
        onClick={() => onChange(t.value)}
        className={cn(
          "h-6 rounded px-2 text-[11px] text-ink-3 hover:text-ink",
          value === t.value && "bg-panel-3 text-ink",
        )}
      >
        {t.label}
      </button>
    ))}
  </div>
);

export const Section = ({
  title,
  children,
  actions,
  className,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("border-line border-b px-3 py-2.5", className)}>
    <div className="mb-2 flex items-center justify-between">
      <span className="font-medium text-[11px] text-ink">{title}</span>
      {actions}
    </div>
    <div className="flex flex-col gap-1.5">{children}</div>
  </div>
);

export const Row = ({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("grid grid-cols-[64px_1fr] items-center gap-2", className)}>
    <Label>{label}</Label>
    <div className="flex min-w-0 items-center gap-1">{children}</div>
  </div>
);

export const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-line-2 bg-panel-3 px-1 font-mono text-[10px] text-ink-2">
    {children}
  </kbd>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ink-3">
    {children}
  </div>
);
