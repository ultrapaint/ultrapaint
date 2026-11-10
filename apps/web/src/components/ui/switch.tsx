"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/cn";

const trackClass =
  "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent outline-none transition-[color,background-color,border-color,box-shadow,opacity] after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 group-has-[:focus-visible]/field-label:border-transparent group-has-[:focus-visible]/field-label:ring-0 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-[size=default]:h-[16.6px] data-[size=sm]:h-[14px] data-[size=default]:w-[28px] data-[size=sm]:w-[24px] data-disabled:cursor-not-allowed data-unchecked:border-muted-foreground/70 data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-50 dark:data-unchecked:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

const thumbClass =
  "pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      className={cn(trackClass, className)}
      data-size={size}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb className={thumbClass} data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

/**
 * The Switch as a picture, for a control that is itself the switch (a menu's checkbox item):
 * the same track and thumb, with no role and no focus of its own.
 */
function SwitchMark({
  checked,
  className,
  size = "default",
}: {
  checked: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  const state = checked ? { "data-checked": "" } : { "data-unchecked": "" };
  return (
    <span
      aria-hidden
      className={cn(trackClass, className)}
      data-size={size}
      data-slot="switch-mark"
      {...state}
    >
      <span className={thumbClass} {...state} />
    </span>
  );
}

export { Switch, SwitchMark };
