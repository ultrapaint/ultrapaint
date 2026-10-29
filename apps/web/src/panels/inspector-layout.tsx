/** The inspector's layout, size, padding and margin sections. */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { fillWarnings } from "@ultrapaint/design-document/sizing";
import { cn } from "cn";
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowRight,
  StretchHorizontal,
} from "lucide-react";
import { Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { SidesIcon } from "../components/sides-icon.tsx";
import type { StyleOption } from "../components/style-combobox.tsx";
import { ValueField } from "../components/value-field.tsx";
import { TOKEN_FIELDS } from "../lib/node-fields.ts";
import { MIXED, type Shared, shownAs } from "../lib/shared-value.ts";
import { type Side, sharedSide, withSides } from "../lib/sides.ts";
import { useTokenOptions } from "../lib/token-options.tsx";
import { useComponents } from "../state/components.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import {
  NodeValueField,
  nullIfMixed,
  type Stack,
  set,
  setEach,
  sharedOf,
  Warning,
} from "./inspector-fields.tsx";

/** A field of a page, a row or a column, which a group does not have. */
const flexField = <K extends "align" | "crossAlign" | "wrap">(
  node: Stack,
  field: K
) => (node.type === "group" ? undefined : node[field]);

export const LayoutSection = ({ nodes }: { nodes: readonly Stack[] }) => {
  const [node] = nodes;
  if (!node) {
    return null;
  }
  // The icons are drawn the way the first one runs.
  const row = node.type === "row";
  const flex = nodes.every((n) => n.type !== "group");
  const MainStart = row
    ? AlignHorizontalJustifyStart
    : AlignVerticalJustifyStart;
  const MainCenter = row
    ? AlignHorizontalJustifyCenter
    : AlignVerticalJustifyCenter;
  const MainEnd = row ? AlignHorizontalJustifyEnd : AlignVerticalJustifyEnd;
  return (
    <Section title="Layout">
      {node.type !== "page" && (
        <Row label="Type">
          <Segmented
            onChange={(v) => set("type", v)}
            options={[
              {
                label: "Group",
                title: "Children stack as blocks",
                value: "group",
              },
              {
                label: <ArrowRight className="size-3" />,
                title: "Row",
                value: "row",
              },
              {
                label: <ArrowDown className="size-3" />,
                title: "Column",
                value: "column",
              },
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
                {
                  label: <MainStart className="size-3" />,
                  title: "Start",
                  value: "start",
                },
                {
                  label: <MainCenter className="size-3" />,
                  title: "Center",
                  value: "center",
                },
                {
                  label: <MainEnd className="size-3" />,
                  title: "End",
                  value: "end",
                },
                {
                  label: (
                    <AlignHorizontalSpaceBetween
                      className={cn("size-3", !row && "rotate-90")}
                    />
                  ),
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
                { label: "Start", value: "start" },
                { label: "Center", value: "center" },
                { label: "End", value: "end" },
                {
                  label: (
                    <StretchHorizontal
                      className={cn("size-3", row && "rotate-90")}
                    />
                  ),
                  title: "Stretch",
                  value: "stretch",
                },
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

const SizeField = ({
  field,
  value,
}: {
  field: "width" | "height";
  value: Shared<JsonValue>;
}) => (
  <ValueField
    leading={<span className="w-2.5">{field === "width" ? "W" : "H"}</span>}
    onChange={(v) => set(field, v)}
    options={SIZE_OPTIONS}
    {...shownAs(value, "Auto")}
  />
);

const LengthField = ({
  field,
  options = [],
  short,
  value,
}: {
  field: string;
  /** The design system's tokens for it: container widths for a width. */
  options?: StyleOption[];
  short: string;
  value: Shared<JsonValue>;
}) => (
  <ValueField
    accept={(q) => CSS.supports("width", q)}
    leading={<span className="w-2.5">{short}</span>}
    onChange={(v) => set(field, v)}
    options={options}
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

export const SizeSection = ({
  frame,
  nodes,
}: {
  frame: string;
  nodes: readonly DesignNode[];
}) => {
  const [only] = nodes;
  const containers = useTokenOptions("container");
  const of = (
    field: "width" | "height" | `${"min" | "max"}${"Width" | "Height"}`
  ) => sharedOf(nodes, (n) => n[field]);
  return (
    <Section title="Size">
      <Row label="Size">
        <SizeField field="width" value={of("width")} />
        <SizeField field="height" value={of("height")} />
      </Row>
      {nodes.length === 1 && only && <FillWarnings frame={frame} node={only} />}
      <Row label="Min">
        <LengthField
          field="minWidth"
          options={containers}
          short="W"
          value={of("minWidth")}
        />
        <LengthField field="minHeight" short="H" value={of("minHeight")} />
      </Row>
      <Row label="Max">
        <LengthField
          field="maxWidth"
          options={containers}
          short="W"
          value={of("maxWidth")}
        />
        <LengthField field="maxHeight" short="H" value={of("maxHeight")} />
      </Row>
    </Section>
  );
};

const FillWarnings = ({ frame, node }: { frame: string; node: DesignNode }) =>
  useFillWarnings(frame, node).map((w) => (
    <Warning key={w.axis}>{w.message}</Warning>
  ));

// ---- Padding and margin ----

/** Padding or margin, side by side, each field lit on the side it sets. */
export const SidesSection = ({
  field,
  nodes,
  title,
}: {
  field: "padding" | "margin";
  nodes: readonly DesignNode[];
  title: string;
}) => {
  const spacing = useTokenOptions("spacing");
  const side = (key: Side) => {
    const shared = sharedSide(
      nodes.map((n) => n[field]),
      [key]
    );
    return (
      <ValueField
        leading={<SidesIcon className="text-foreground" lit={[key]} />}
        // Each node keeps its own other sides.
        onChange={(v) =>
          setEach(`Change the ${field}`, (n) => ({
            [field]: withSides(n[field], [key], v),
          }))
        }
        options={spacing}
        title={`${title}, ${key}`}
        {...shownAs(shared.mixed ? MIXED : shared.value, "0")}
      />
    );
  };
  return (
    <Section title={title}>
      <Row label="">
        {side("top")}
        {side("right")}
      </Row>
      <Row label="">
        {side("bottom")}
        {side("left")}
      </Row>
    </Section>
  );
};
