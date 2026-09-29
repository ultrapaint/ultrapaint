/**
 * The toolbar's padding and margin: a select that reads the padding, and a popover of the design
 * sidebar's own fields. Each row has a horizontal and a vertical field, or one per side once its
 * button opens it; ⌘-click picks several fields and the value chosen goes to all of them.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, Padding } from "@ultrapaint/contracts/document";
import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import { Fragment, type SyntheticEvent, useContext, useState } from "react";
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
import { displayOf, ValueField } from "../components/value-field.tsx";
import { updateNodesWith } from "../lib/node-actions.ts";
import {
  axesSplit,
  type Side,
  sharedSide,
  sidesLabel,
  withSides,
} from "../lib/sides.ts";
import { useTokenOptions } from "../lib/token-options.tsx";
import { Targets, useTargetNodes } from "./toolbar-targets.ts";

type SpacingField = "padding" | "margin";

/** One field of a row: the sides it sets and what its tooltip calls them. */
interface Part {
  readonly key: string;
  readonly name: string;
  readonly sides: readonly Side[];
}

const AXES: readonly Part[] = [
  { key: "x", name: "left and right", sides: ["left", "right"] },
  { key: "y", name: "top and bottom", sides: ["top", "bottom"] },
];
/** Top and right, then bottom and left, as the inspector lays them. */
const FOUR: readonly Part[] = [
  { key: "top", name: "top", sides: ["top"] },
  { key: "right", name: "right", sides: ["right"] },
  { key: "bottom", name: "bottom", sides: ["bottom"] },
  { key: "left", name: "left", sides: ["left"] },
];

const fieldOf = (node: DesignNode, field: SpacingField) =>
  node[field] as Padding | undefined;

/** ⌘ on a Mac, Ctrl elsewhere: the key that adds to a pick. */
const adds = (e: SyntheticEvent) => {
  const native = e.nativeEvent as MouseEvent;
  return native.metaKey || native.ctrlKey;
};

const SidesRow = ({
  field,
  nodes,
  title,
}: {
  field: SpacingField;
  nodes: readonly DesignNode[];
  title: string;
}) => {
  const targets = useContext(Targets);
  const spacing = useTokenOptions("spacing");
  const values = nodes.map((n) => fieldOf(n, field));
  // A row opens with four fields when two of them could not show what is set.
  const [four, setFour] = useState(() => values.some(axesSplit));
  const [picked, setPicked] = useState<readonly string[]>([]);
  const parts = four ? FOUR : AXES;

  const onPick = (part: Part) => (value: JsonValue) => {
    const chosen = picked.includes(part.key)
      ? parts.filter((p) => picked.includes(p.key))
      : [part];
    const sides = chosen.flatMap((p) => p.sides);
    setPicked([]);
    updateNodesWith(
      targets,
      (node) => ({ [field]: withSides(fieldOf(node, field), sides, value) }),
      `Change the ${field}`
    );
  };
  // Runs before the field's own handlers, so a ⌘-click picks it instead of opening it.
  const onAdd = (part: Part) => (e: SyntheticEvent) => {
    if (!adds(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "pointerdown") {
      setPicked((p) =>
        p.includes(part.key)
          ? p.filter((k) => k !== part.key)
          : [...p, part.key]
      );
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-[11px] text-muted-foreground">
        {title}
      </span>
      <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
        {parts.map((part, i) => {
          const shared = sharedSide(values, part.sides);
          return (
            <Fragment key={part.key}>
              <div
                className={cn(
                  "flex min-w-0 rounded-md",
                  picked.includes(part.key) &&
                    "ring-2 ring-brand ring-offset-1 ring-offset-popover"
                )}
                data-picked={picked.includes(part.key) || undefined}
                onClickCapture={onAdd(part)}
                onMouseDownCapture={onAdd(part)}
                onPointerDownCapture={onAdd(part)}
              >
                <ValueField
                  leading={
                    <SidesIcon className="text-foreground" lit={part.sides} />
                  }
                  onChange={onPick(part)}
                  options={spacing}
                  placeholder={shared.mixed ? "Mixed" : "0"}
                  title={`${title}, ${part.name}`}
                  value={shared.value}
                />
              </div>
              {i === 1 ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        aria-label={`${title} on each side`}
                        aria-pressed={four}
                        className={cn(
                          "flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                          four && "bg-muted text-foreground"
                        )}
                        onClick={() => {
                          setFour(!four);
                          setPicked([]);
                        }}
                        type="button"
                      />
                    }
                  >
                    <SidesIcon lit="all" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {four ? "Horizontal and vertical" : "Each side"}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              {i === 3 ? <span /> : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};

export const SpacingSelect = () => {
  const nodes = useTargetNodes();
  const labels = nodes.map((n) => sidesLabel(fieldOf(n, "padding"), displayOf));
  const [first = "0"] = labels;
  const label = labels.every((l) => l === first) ? first : "mixed";
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  className="flex h-7 max-w-44 items-center gap-1.5 rounded-md px-2 text-[12px] outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-muted"
                  type="button"
                />
              }
            />
          }
        >
          <SidesIcon className="text-muted-foreground" lit="all" />
          <span className="truncate font-medium">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Padding and margin</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-60 gap-3">
        <SidesRow field="padding" nodes={nodes} title="Padding" />
        <SidesRow field="margin" nodes={nodes} title="Margin" />
        <p className="text-[10.5px] text-muted-foreground">
          ⌘-click fields to set several at once
        </p>
      </PopoverContent>
    </Popover>
  );
};
