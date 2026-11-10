/**
 * The inspector's appearance (opacity and radius), fill, border and shadow sections. Fill, border
 * and shadow are each a section's + while a node has none, and its − once it has.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { Segmented } from "../components/segmented.tsx";
import type { StyleOption } from "../components/style-combobox.tsx";
import { ValueField } from "../components/value-field.tsx";
import { setField, updateSelection } from "../lib/node-actions.ts";
import { sharedField, TOKEN_FIELDS } from "../lib/node-fields.ts";
import { MIXED, shownAs } from "../lib/shared-value.ts";
import { Swatch, useColorOf, useTokenOptions } from "../lib/token-options.tsx";
import {
  AddOrRemove,
  ColorField,
  NodeValueField,
  nullIfMixed,
  Row,
  Section,
  set,
  setEach,
  sharedOf,
  useReveal,
} from "./inspector-fields.tsx";

/** The opacities an opacity field offers, a node's and a component's look's alike. */
export const OPACITY_OPTIONS: readonly StyleOption[] = [
  1, 0.9, 0.75, 0.5, 0.25, 0.1, 0,
].map((o) => ({
  label: `${Math.round(o * 100)}%`,
  value: String(o),
}));

/**
 * An opacity as its field gives it, picked or typed, from 0 to 1: a number above 1 is a
 * percentage, `50` half. Null for a field cleared, or for what is no number.
 */
export const opacityOf = (value: JsonValue): number | null => {
  const n =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return value === null || !Number.isFinite(n)
    ? null
    : Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
};

/** A border with one of its fields set, or taken off with `null`; none when nothing is left. */
const withBorder = (
  border: DesignNode["border"],
  field: "width" | "color" | "style",
  value: JsonValue
): JsonValue => {
  const next: Record<string, JsonValue> = { ...border };
  if (value === null) {
    delete next[field];
  } else {
    next[field] = value;
  }
  return Object.keys(next).length === 0 ? null : next;
};

/** Opacity and corner radius: what every node has, set or not. */
const LookSection = ({ nodes }: { nodes: readonly DesignNode[] }) => (
  <Section title="Appearance">
    <Row label="Opacity">
      <ValueField
        onChange={(v) => set("opacity", opacityOf(v))}
        options={OPACITY_OPTIONS}
        {...shownAs(
          sharedOf(nodes, (n) => n.opacity),
          "100%"
        )}
      />
    </Row>
    <Row label="Radius">
      <NodeValueField
        field={TOKEN_FIELDS.radius}
        nodes={nodes}
        placeholder="0"
      />
    </Row>
  </Section>
);

/** The fill: a + while there is none, which opens the colours to pick one. */
const FillSection = ({ nodes }: { nodes: readonly DesignNode[] }) => {
  const [adding, add] = useReveal();
  const filled = sharedField(TOKEN_FIELDS.fill, nodes) !== undefined;
  return (
    <Section
      action={
        <AddOrRemove
          name="fill"
          onAdd={() => add(true)}
          onRemove={() => {
            add(false);
            setField(TOKEN_FIELDS.fill, null);
          }}
          present={filled || adding}
        />
      }
      title="Fill"
    >
      {filled || adding ? (
        <Row label="Colour">
          <ColorField
            autoOpen={adding && !filled}
            field={TOKEN_FIELDS.fill}
            nodes={nodes}
          />
        </Row>
      ) : null}
    </Section>
  );
};

/** The border: a + that draws one pixel of it, then its width, style and colour. */
const BorderSection = ({ nodes }: { nodes: readonly DesignNode[] }) => {
  const borderWidths = useTokenOptions("borderWidth");
  const borderColors = useTokenOptions("color");
  const border = (field: "width" | "color" | "style") =>
    sharedOf(nodes, (n) => n.border?.[field]);
  // Each node keeps the rest of its own border.
  const setBorder =
    (field: "width" | "color" | "style") => (value: JsonValue) =>
      setEach("Change the border", (n) => ({
        border: withBorder(n.border, field, value),
      }));
  const borderColor = border("color");
  const swatch = useColorOf(borderColor === MIXED ? undefined : borderColor);
  const bordered = nodes.some((n) => n.border !== undefined);
  return (
    <Section
      action={
        <AddOrRemove
          name="border"
          onAdd={() =>
            updateSelection({ border: { width: 1 } }, "Add a border")
          }
          onRemove={() =>
            updateSelection({ border: null }, "Remove the border")
          }
          present={bordered}
        />
      }
      title="Border"
    >
      {bordered ? (
        <>
          <Row label="Width">
            <ValueField
              onChange={setBorder("width")}
              options={[
                ...[0, 1, 2, 4].map((w) => ({
                  label: String(w),
                  value: String(w),
                })),
                ...borderWidths,
              ]}
              {...shownAs(border("width"), "1")}
            />
          </Row>
          <Row label="Style">
            <Segmented
              onChange={(v) => setBorder("style")(v)}
              options={[
                { label: "Solid", value: "solid" },
                { label: "Dashed", value: "dashed" },
                { label: "Dotted", value: "dotted" },
              ]}
              value={nullIfMixed(
                sharedOf(nodes, (n) => n.border?.style ?? "solid")
              )}
            />
          </Row>
          <Row label="Colour">
            <ValueField
              accept={(q) => CSS.supports("color", q)}
              leading={<Swatch color={swatch} />}
              onChange={setBorder("color")}
              options={borderColors}
              {...shownAs(borderColor, "Text colour")}
            />
          </Row>
        </>
      ) : null}
    </Section>
  );
};

/** The effects, a shadow: a + while there is none, which opens the shadows to pick one. */
const ShadowSection = ({ nodes }: { nodes: readonly DesignNode[] }) => {
  const [adding, add] = useReveal();
  const shadowed = sharedField(TOKEN_FIELDS.shadow, nodes) !== undefined;
  return (
    <Section
      action={
        <AddOrRemove
          name="shadow"
          onAdd={() => add(true)}
          onRemove={() => {
            add(false);
            setField(TOKEN_FIELDS.shadow, null);
          }}
          present={shadowed || adding}
        />
      }
      title="Effects"
    >
      {shadowed || adding ? (
        <Row label="Shadow">
          <NodeValueField
            accept={(q) => CSS.supports("box-shadow", q)}
            autoOpen={adding && !shadowed}
            field={TOKEN_FIELDS.shadow}
            nodes={nodes}
            placeholder="None"
          />
        </Row>
      ) : null}
    </Section>
  );
};

export const AppearanceSection = ({
  nodes,
}: {
  nodes: readonly DesignNode[];
}) => (
  <>
    <LookSection nodes={nodes} />
    <FillSection nodes={nodes} />
    <BorderSection nodes={nodes} />
    <ShadowSection nodes={nodes} />
  </>
);
