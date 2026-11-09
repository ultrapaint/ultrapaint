import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A compact note floating over the canvas, as the place switch and the tools do: what the canvas
 * is showing at the top, just under the place switch, with its way out at its right end; what
 * the editor is waiting on at the bottom, just over the tools. One line, never wider than the
 * canvas; what it names is cut short first.
 */
export const Banner = ({
  at = "top",
  children,
  icon,
  label,
}: {
  at?: "bottom" | "top";
  children: ReactNode;
  /** Before the text, in its colour when it is a status. */
  icon: ReactNode;
  /** What a screen reader says of it. */
  label: string;
}) => (
  <div
    className={cn(
      "pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4",
      at === "top" ? "top-14" : "bottom-16"
    )}
  >
    <div
      aria-label={label}
      className="floating pointer-events-auto flex h-9 min-w-0 max-w-full items-center gap-2 pr-1.5 pl-3 [&>svg]:size-4 [&>svg]:shrink-0"
      role="status"
    >
      {icon}
      {children}
    </div>
  </div>
);
