/**
 * Four bars round a box: the sides of a padding or a margin. A field lights the sides it sets;
 * the button that opens a row to four sides lights them all.
 */
import { cn } from "cn";
import type { Side } from "../lib/sides.ts";

const BARS: readonly [Side, number, number, number, number][] = [
  ["top", 7, 3.5, 17, 3.5],
  ["right", 20.5, 7, 20.5, 17],
  ["bottom", 7, 20.5, 17, 20.5],
  ["left", 3.5, 7, 3.5, 17],
];

export const SidesIcon = ({
  lit,
  className,
}: {
  /** The sides drawn in the text colour; the rest are dimmed. */
  lit: readonly Side[] | "all";
  className?: string;
}) => (
  <svg
    aria-hidden="true"
    className={cn("size-3.5 shrink-0", className)}
    fill="none"
    viewBox="0 0 24 24"
  >
    <rect
      className="fill-muted-foreground/40"
      height="6"
      rx="1.5"
      width="6"
      x="9"
      y="9"
    />
    {BARS.map(([side, x1, y1, x2, y2]) => {
      const on = lit === "all" || lit.includes(side);
      return (
        <line
          className={on ? "stroke-current" : "stroke-muted-foreground/30"}
          key={side}
          strokeLinecap="round"
          strokeWidth={on ? 3 : 2.5}
          x1={x1}
          x2={x2}
          y1={y1}
          y2={y2}
        />
      );
    })}
  </svg>
);
