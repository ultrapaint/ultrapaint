/**
 * The inspector's appearance (opacity and radius), fill, border and effects sections. The border
 * is the section's + while a node has none, and its − once it has; the fill is its layers
 * (`inspector-fill`), and the effects its shadows, a row each.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { shadowListCss, shadowsOf } from "@ultrapaint/design-document/shadow";
import { isToken } from "@ultrapaint/design-document/tokens";
import { Minus, Plus } from "lucide-react";
import { Segmented } from "../components/segmented.tsx";
import type { StyleOption } from "../components/style-combobox.tsx";
import { ValueField } from "../components/value-field.tsx";
import { setField, updateSelection } from "../lib/node-actions.ts";
import { sharedField, TOKEN_FIELDS } from "../lib/node-fields.ts";
import { MIXED, shownAs } from "../lib/shared-value.ts";
import { Swatch, useColorOf, useTokenOptions } from "../lib/token-options.tsx";
import {
  AddOrRemove,
  NodeValueField,
  nullIfMixed,
  Row,
  Section,
  SectionAction,
  set,
  setEach,
  sharedOf,
  useReveal,
} from "./inspector-fields.tsx";
import { FillSection } from "./inspector-fill.tsx";

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
    <Row fields={["opacity"]} label="Opacity">
      <ValueField
        onChange={(v) => set("opacity", opacityOf(v))}
        options={OPACITY_OPTIONS}
        {...shownAs(
          sharedOf(nodes, (n) => n.opacity),
          "100%"
        )}
      />
    </Row>
    <Row fields={["radius"]} label="Radius">
      <NodeValueField
        field={TOKEN_FIELDS.radius}
        nodes={nodes}
        placeholder="0"
      />
    </Row>
  </Section>
);

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
          <Row fields={["border"]} label="Width">
            <ValueField
              kind="borderWidth"
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
              colors="border"
              kind="color"
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

const SHADOW = TOKEN_FIELDS.shadow;

/** Writes shadows as the shadow of every node inspected, or takes it off when none is left. */
const writeShadows = (shadows: readonly string[]) =>
  setField(SHADOW, shadowListCss(shadows));

/** Whether CSS takes a shadow typed, or each of a list typed, its tokens taken as they are. */
const acceptsShadow = (q: string) => {
  const shadows = shadowsOf(q);
  return (
    shadows.length > 0 &&
    shadows.every((s) => isToken(s) || CSS.supports("box-shadow", s))
  );
};

/** One shadow's field, a token or CSS, picked from the shadows of the design system. */
const ShadowValue = ({
  autoOpen,
  onChange,
  value,
}: {
  autoOpen?: boolean;
  onChange: (value: JsonValue) => void;
  value: string | undefined;
}) => {
  const options = useTokenOptions(SHADOW.options);
  return (
    <ValueField
      accept={acceptsShadow}
      autoOpen={autoOpen}
      kind={SHADOW.options}
      onChange={onChange}
      options={options}
      placeholder="None"
      title="Shadow"
      value={value}
    />
  );
};

/** A row of the Effects section: one shadow's field and the − that takes it off. */
const ShadowRow = ({
  autoOpen,
  first,
  onChange,
  onRemove,
  value,
}: {
  autoOpen?: boolean;
  /** Whether it is the section's first row, which the instance's override mark is on. */
  first: boolean;
  onChange: (value: JsonValue) => void;
  onRemove: () => void;
  value: string | undefined;
}) => (
  <Row fields={first ? ["shadow"] : undefined} label="Shadow">
    <div
      className="flex min-w-0 flex-1 items-center gap-1"
      data-shadow={value === undefined ? "new" : "shadow"}
    >
      <ShadowValue autoOpen={autoOpen} onChange={onChange} value={value} />
      <SectionAction onClick={onRemove} tooltip="Remove shadow">
        <Minus />
      </SectionAction>
    </div>
  </Row>
);

/**
 * The effects: a row per shadow, the one drawn on top first, each a token or CSS with its own −,
 * and a + that adds a shadow after them, its shadows open to pick one. Nodes whose shadows differ
 * show one field reading Mixed, which gives them all one list.
 */
const ShadowSection = ({ nodes }: { nodes: readonly DesignNode[] }) => {
  const [adding, add] = useReveal();
  const shared = sharedField(SHADOW, nodes);
  const shadows = typeof shared === "string" ? shadowsOf(shared) : [];
  // `none` is no shadow of a list but the whole of one: a shadow added takes its place.
  const listed =
    shadows.length === 1 && shadows[0]?.toLowerCase() === "none" ? [] : shadows;
  /** The shadows with the one at `index` as `value`, or without it for null. */
  const replace = (index: number, value: JsonValue) =>
    writeShadows([
      ...shadows.slice(0, index),
      ...(value === null ? [] : shadowsOf(String(value))),
      ...shadows.slice(index + 1),
    ]);
  return (
    <Section
      action={
        shared === MIXED ? (
          <SectionAction
            onClick={() => setField(SHADOW, null)}
            tooltip="Remove shadow"
          >
            <Minus />
          </SectionAction>
        ) : (
          <SectionAction onClick={() => add(true)} tooltip="Add shadow">
            <Plus />
          </SectionAction>
        )
      }
      title="Effects"
    >
      {shared === MIXED ? (
        <Row fields={["shadow"]} label="Shadow">
          <div className="flex min-w-0 flex-1" data-shadow="mixed">
            <NodeValueField
              accept={acceptsShadow}
              field={SHADOW}
              nodes={nodes}
              placeholder="None"
            />
          </div>
        </Row>
      ) : (
        <>
          {shadows.map((shadow, i) => (
            <ShadowRow
              first={i === 0}
              // A row is its place and its shadow: one that moves or changes starts afresh, so
              // that a new token's naming open on it never names the shadow taking its place.
              // biome-ignore lint/suspicious/noArrayIndexKey: the place is half of what a row is
              key={`${i}\0${shadow}`}
              onChange={(value) => replace(i, value)}
              onRemove={() => replace(i, null)}
              value={shadow}
            />
          ))}
          {adding ? (
            <ShadowRow
              autoOpen
              first={shadows.length === 0}
              onChange={(value) => {
                add(false);
                if (value !== null) {
                  writeShadows([...listed, ...shadowsOf(String(value))]);
                }
              }}
              onRemove={() => add(false)}
              value={undefined}
            />
          ) : null}
        </>
      )}
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
