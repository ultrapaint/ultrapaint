/** The inspector's layout, size and spacing sections. */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode, Padding } from "@ultrapaint/contracts/document";
import { fillWarnings } from "@ultrapaint/design-document/sizing";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  Minus,
  Plus,
  StretchHorizontal,
  StretchVertical,
} from "lucide-react";
import { type SyntheticEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import { Segmented } from "../components/segmented.tsx";
import { SidesIcon } from "../components/sides-icon.tsx";
import type { StyleOption } from "../components/style-combobox.tsx";
import { ValueField } from "../components/value-field.tsx";
import { updateSelection } from "../lib/node-actions.ts";
import { TOKEN_FIELDS } from "../lib/node-fields.ts";
import { MIXED, type Shared, shownAs } from "../lib/shared-value.ts";
import { axesSplit, type Side, sharedSide } from "../lib/sides.ts";
import { useTokenOptions } from "../lib/token-options.tsx";
import { useComponents } from "../state/components.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import {
  NodeValueField,
  nullIfMixed,
  Row,
  Section,
  SectionAction,
  type Stack,
  set,
  sharedOf,
  useDraft,
  useReveal,
  Warning,
} from "./inspector-fields.tsx";

/** A field of a page, a row or a column, which a group does not have. */
const flexField = <K extends "align" | "crossAlign" | "wrap">(
  node: Stack,
  field: K
) => (node.type === "group" ? undefined : node[field]);

/** The icons of the two alignments, drawn the way the stack runs. */
const alignIcons = (row: boolean) =>
  row
    ? {
        across: [
          AlignStartHorizontal,
          AlignCenterHorizontal,
          AlignEndHorizontal,
          StretchVertical,
        ],
        along: [
          AlignHorizontalJustifyStart,
          AlignHorizontalJustifyCenter,
          AlignHorizontalJustifyEnd,
          AlignHorizontalSpaceBetween,
        ],
      }
    : {
        across: [
          AlignStartVertical,
          AlignCenterVertical,
          AlignEndVertical,
          StretchHorizontal,
        ],
        along: [
          AlignVerticalJustifyStart,
          AlignVerticalJustifyCenter,
          AlignVerticalJustifyEnd,
          AlignVerticalSpaceBetween,
        ],
      };

export const LayoutSection = ({ nodes }: { nodes: readonly Stack[] }) => {
  const [node] = nodes;
  if (!node) {
    return null;
  }
  // The icons are drawn the way the first one runs.
  const row = node.type === "row";
  const flex = nodes.every((n) => n.type !== "group");
  const icons = alignIcons(row);
  const [Start, Center, End, Between] = icons.along;
  const [Top, Middle, Bottom, Stretch] = icons.across;
  const icon = (Icon: (typeof icons.along)[number] | undefined) =>
    Icon ? <Icon /> : null;
  return (
    <Section title="Layout">
      {node.type !== "page" && (
        <Row label="Type">
          <Segmented
            onChange={(v) => set("type", v)}
            options={[
              { label: "Group", value: "group" },
              { label: "Row", value: "row" },
              { label: "Column", value: "column" },
            ]}
            value={nullIfMixed(sharedOf(nodes, (n) => n.type))}
          />
        </Row>
      )}
      {flex ? (
        <>
          <Row label="Gap">
            <NodeValueField
              field={TOKEN_FIELDS.gap}
              nodes={nodes}
              placeholder="0"
            />
          </Row>
          <Row label="Align">
            <Segmented
              onChange={(v) => set("align", v)}
              options={[
                { label: icon(Start), title: "Start", value: "start" },
                { label: icon(Center), title: "Center", value: "center" },
                { label: icon(End), title: "End", value: "end" },
                {
                  label: icon(Between),
                  title: "Space between",
                  value: "between",
                },
              ]}
              value={nullIfMixed(
                sharedOf(nodes, (n) => flexField(n, "align") ?? "start")
              )}
            />
          </Row>
          <Row label="Across">
            <Segmented
              onChange={(v) => set("crossAlign", v)}
              options={[
                { label: icon(Top), title: "Start", value: "start" },
                { label: icon(Middle), title: "Center", value: "center" },
                { label: icon(Bottom), title: "End", value: "end" },
                { label: icon(Stretch), title: "Stretch", value: "stretch" },
              ]}
              value={nullIfMixed(
                sharedOf(nodes, (n) => flexField(n, "crossAlign") ?? "stretch")
              )}
            />
          </Row>
          {nodes.every((n) => n.type === "row") && (
            <Row label="Wrap">
              <Segmented
                onChange={(v) => set("wrap", v === "wrap" ? true : null)}
                options={[
                  { label: "No wrap", value: "nowrap" },
                  { label: "Wrap", value: "wrap" },
                ]}
                value={nullIfMixed(
                  sharedOf(nodes, (n) =>
                    flexField(n, "wrap") ? "wrap" : "nowrap"
                  )
                )}
              />
            </Row>
          )}
        </>
      ) : null}
    </Section>
  );
};

// ---- Size ----

const SIZE_OPTIONS: StyleOption[] = [
  { description: "take the room left", label: "Fill", value: "fill" },
  { description: "wrap the content", label: "Hug", value: "hug" },
];

/** The letter a size field leads with: which of the two it is. */
const Axis = ({ children }: { children: string }) => (
  <span className="w-2.5 text-muted-foreground">{children}</span>
);

const SizeField = ({
  field,
  value,
}: {
  field: "width" | "height";
  value: Shared<JsonValue>;
}) => (
  <ValueField
    leading={<Axis>{field === "width" ? "W" : "H"}</Axis>}
    onChange={(v) => set(field, v)}
    options={SIZE_OPTIONS}
    title={field === "width" ? "Width" : "Height"}
    {...shownAs(value, "Auto")}
  />
);

const LengthField = ({
  field,
  options = [],
  short,
  title,
  value,
}: {
  field: string;
  /** The design system's tokens for it: container widths for a width. */
  options?: StyleOption[];
  short: string;
  title: string;
  value: Shared<JsonValue>;
}) => (
  <ValueField
    accept={(q) => CSS.supports("width", q)}
    leading={<Axis>{short}</Axis>}
    onChange={(v) => set(field, v)}
    options={options}
    title={title}
    {...shownAs(value, "–")}
  />
);

/** Why a `fill` of the node has no room to take, from its parent's size. */
const useFillWarnings = (frame: string, node: DesignNode) => {
  const canvas = useEditor((s) => s.canvas);
  const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frame));
  const catalogue = useComponents((s) => s.catalogue);
  return root
    ? fillWarnings(root, catalogue).filter((w) => w.nodeId === node.id)
    : [];
};

const BOUNDS = ["minWidth", "minHeight", "maxWidth", "maxHeight"] as const;

/**
 * Width and height, and the bounds a size keeps to: shown once one is set, or once the + asks
 * for them; the − takes all four off.
 */
export const SizeSection = ({
  frame,
  nodes,
}: {
  frame: string;
  nodes: readonly DesignNode[];
}) => {
  const [only] = nodes;
  const containers = useTokenOptions("container");
  const [revealed, reveal] = useReveal();
  const of = (field: "width" | "height" | (typeof BOUNDS)[number]) =>
    sharedOf(nodes, (n) => n[field]);
  const bounded = BOUNDS.some((field) => of(field) !== undefined);
  const removeBounds = () => {
    reveal(false);
    if (bounded) {
      updateSelection(
        Object.fromEntries(BOUNDS.map((field) => [field, null])),
        "Remove min and max"
      );
    }
  };
  return (
    <Section
      action={
        bounded || revealed ? (
          <SectionAction onClick={removeBounds} tooltip="Remove min and max">
            <Minus />
          </SectionAction>
        ) : (
          <SectionAction onClick={() => reveal(true)} tooltip="Min and max">
            <Plus />
          </SectionAction>
        )
      }
      title="Size"
    >
      <Row>
        <SizeField field="width" value={of("width")} />
        <SizeField field="height" value={of("height")} />
      </Row>
      {nodes.length === 1 && only && <FillWarnings frame={frame} node={only} />}
      {bounded || revealed ? (
        <>
          <Row label="Min">
            <LengthField
              field="minWidth"
              options={containers}
              short="W"
              title="Min width"
              value={of("minWidth")}
            />
            <LengthField
              field="minHeight"
              short="H"
              title="Min height"
              value={of("minHeight")}
            />
          </Row>
          <Row label="Max">
            <LengthField
              field="maxWidth"
              options={containers}
              short="W"
              title="Max width"
              value={of("maxWidth")}
            />
            <LengthField
              field="maxHeight"
              short="H"
              title="Max height"
              value={of("maxHeight")}
            />
          </Row>
        </>
      ) : null}
    </Section>
  );
};

const FillWarnings = ({ frame, node }: { frame: string; node: DesignNode }) =>
  useFillWarnings(frame, node).map((w) => (
    <Row key={w.axis}>
      <Warning>{w.message}</Warning>
    </Row>
  ));

// ---- Padding and margin ----

export type SpacingField = "padding" | "margin";

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
/** Top and right, then bottom and left: CSS's order, two to a row. */
const FOUR: readonly Part[] = [
  { key: "top", name: "top", sides: ["top"] },
  { key: "right", name: "right", sides: ["right"] },
  { key: "bottom", name: "bottom", sides: ["bottom"] },
  { key: "left", name: "left", sides: ["left"] },
];

const TITLES: Record<SpacingField, string> = {
  margin: "Margin",
  padding: "Padding",
};

const fieldOf = (node: DesignNode, field: SpacingField) =>
  node[field] as Padding | undefined;

/** ⌘ on a Mac, Ctrl elsewhere: the key that adds a field to a pick. */
const adds = (e: SyntheticEvent) => {
  const native = e.nativeEvent as MouseEvent;
  return native.metaKey || native.ctrlKey;
};

/** Sets these sides of a padding or a margin to a value on every node changed. */
export type WriteSides = (
  field: SpacingField,
  sides: readonly Side[],
  value: JsonValue
) => void;

/**
 * A padding or a margin: a horizontal and a vertical field, or one per side. ⌘-click picks
 * several fields, and the value chosen in one goes to all of them.
 */
const SidesRows = ({
  field,
  four,
  nodes,
  write,
}: {
  field: SpacingField;
  four: boolean;
  nodes: readonly DesignNode[];
  write: WriteSides;
}) => {
  const spacing = useTokenOptions("spacing");
  const values = nodes.map((n) => fieldOf(n, field));
  const [picked, setPicked] = useState<readonly string[]>([]);
  const parts = four ? FOUR : AXES;
  const title = TITLES[field];
  const onPick = (part: Part) => (value: JsonValue) => {
    const chosen = picked.includes(part.key)
      ? parts.filter((p) => picked.includes(p.key))
      : [part];
    setPicked([]);
    write(
      field,
      chosen.flatMap((p) => p.sides),
      value
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
  const fieldFor = (part: Part) => {
    const shared = sharedSide(values, part.sides);
    const on = picked.includes(part.key);
    return (
      <div
        className={cn(
          "flex min-w-0 flex-1 rounded-md",
          on && "ring-2 ring-ring ring-offset-1 ring-offset-popover"
        )}
        data-picked={on || undefined}
        key={part.key}
        onClickCapture={onAdd(part)}
        onMouseDownCapture={onAdd(part)}
        onPointerDownCapture={onAdd(part)}
      >
        <ValueField
          leading={<SidesIcon className="text-foreground" lit={part.sides} />}
          onChange={onPick(part)}
          options={spacing}
          title={`${title}, ${part.name}`}
          {...shownAs(shared.mixed ? MIXED : shared.value, "0")}
        />
      </div>
    );
  };
  const rows = four ? [FOUR.slice(0, 2), FOUR.slice(2)] : [AXES];
  return rows.map((row, i) => (
    <Row key={row.map((p) => p.key).join()} label={i === 0 ? title : undefined}>
      {row.map(fieldFor)}
    </Row>
  ));
};

/**
 * Padding and margin, the inspector's and the element toolbar's: a field for each axis, or for
 * each side once the section's toggle asks for it, as it does on its own when an axis's two sides
 * differ.
 */
export const SpacingSection = ({
  className,
  nodes,
  write,
}: {
  className?: string;
  nodes: readonly DesignNode[];
  write: WriteSides;
}) => {
  const split = nodes.some(
    (n) => axesSplit(fieldOf(n, "padding")) || axesSplit(fieldOf(n, "margin"))
  );
  const [chosen, choose] = useDraft<boolean>();
  const four = chosen ?? split;
  return (
    <Section
      action={
        <IconButton
          aria-pressed={four}
          className="text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
          onClick={() => choose(!four)}
          size="icon-sm"
          tooltip="Each side"
        >
          <SidesIcon lit="all" />
        </IconButton>
      }
      className={className}
      title="Spacing"
    >
      <SidesRows field="padding" four={four} nodes={nodes} write={write} />
      <SidesRows field="margin" four={four} nodes={nodes} write={write} />
    </Section>
  );
};
