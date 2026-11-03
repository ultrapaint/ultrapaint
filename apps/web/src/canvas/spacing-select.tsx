/**
 * The toolbar's padding and margin: a trigger that reads them as the classes they write
 * (`px-4 py-2`), and a popover of the inspector's own Spacing section.
 */
import type { DesignNode, Padding } from "@ultrapaint/contracts/document";
import { spacingBasePx } from "@ultrapaint/contracts/token-table";
import { ChevronDown } from "lucide-react";
import { useContext } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SidesIcon } from "../components/sides-icon.tsx";
import { updateNodesWith } from "../lib/node-actions.ts";
import { MIXED_LABEL, sharedValue } from "../lib/shared-value.ts";
import { sidesOf, withSides } from "../lib/sides.ts";
import {
  type SpacingField,
  SpacingSection,
  type WriteSides,
} from "../panels/inspector-layout.tsx";
import { useDesignSystem } from "../state/design-system.ts";
import { classValue, TRIGGER_CLASS } from "./element-toolbar-selects.tsx";
import { Targets, useTargetNodes } from "./toolbar-targets.ts";

const fieldOf = (node: DesignNode, field: SpacingField) =>
  node[field] as Padding | undefined;

/**
 * A padding or margin as Tailwind writes it: `p-4` for every side, `px-4 py-2` for the axes,
 * else a class per side that is set. Null when no side is.
 */
export const spacingClasses = (
  value: Padding | undefined,
  prefix: "p" | "m",
  spacingBase: number
): string | null => {
  const s = sidesOf(value);
  const of = (v: string | number | undefined) =>
    v === undefined ? undefined : classValue(v, spacingBase, true);
  const [top, right, bottom, left] = [s.top, s.right, s.bottom, s.left].map(of);
  if ([top, right, bottom, left].every((v) => v === undefined)) {
    return null;
  }
  if (top === right && top === bottom && top === left) {
    return `${prefix}-${top}`;
  }
  if (left === right && top === bottom) {
    return [
      left === undefined ? null : `${prefix}x-${left}`,
      top === undefined ? null : `${prefix}y-${top}`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return (
    [
      ["t", top],
      ["r", right],
      ["b", bottom],
      ["l", left],
    ] as const
  )
    .filter(([, v]) => v !== undefined)
    .map(([side, v]) => `${prefix}${side}-${v}`)
    .join(" ");
};

export const SpacingSelect = () => {
  const targets = useContext(Targets);
  const nodes = useTargetNodes();
  const base = spacingBasePx(
    useDesignSystem((s) => s.designSystem?.spacing.base)
  );
  const written = sharedValue(
    nodes.map((n) =>
      [
        spacingClasses(fieldOf(n, "padding"), "p", base),
        spacingClasses(fieldOf(n, "margin"), "m", base),
      ]
        .filter(Boolean)
        .join(" ")
    )
  );
  let label = "p-0";
  if (typeof written === "string" && written !== "") {
    label = written;
  } else if (written !== undefined && written !== "") {
    label = MIXED_LABEL;
  }
  const write: WriteSides = (field, sides, value) =>
    updateNodesWith(
      targets,
      (node) => ({ [field]: withSides(fieldOf(node, field), sides, value) }),
      `Change the ${field}`
    );
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<button className={TRIGGER_CLASS} type="button" />}
            />
          }
        >
          <SidesIcon className="size-4 text-muted-foreground" lit="all" />
          <span
            className={
              written === "" || written === undefined
                ? "truncate font-code text-muted-foreground"
                : "truncate font-code"
            }
          >
            {label}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Padding and margin</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <SpacingSection nodes={nodes} write={write} />
      </PopoverContent>
    </Popover>
  );
};
