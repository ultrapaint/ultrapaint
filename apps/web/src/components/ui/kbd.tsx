import { cn } from "@/lib/cn";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-0.5 rounded-sm bg-transparent in-data-[slot=tooltip-content]:bg-background/15 px-1 font-body-small font-medium in-data-[slot=tooltip-content]:text-background/80 text-muted-foreground ring-1 ring-border ring-inset dark:in-data-[slot=tooltip-content]:bg-muted dark:in-data-[slot=tooltip-content]:text-muted-foreground [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      className={cn("inline-flex items-center gap-1", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
