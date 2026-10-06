/** The inspector's fill, border and effects section. */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import type { StyleOption } from "../components/style-combobox.tsx";
import { ValueField } from "../components/value-field.tsx";
import { MIXED, shownAs } from "../lib/shared-value.ts";
import { Swatch, useColorOf, useTokenOptions } from "../lib/token-options.tsx";
import {
  ColorField,
  nullIfMixed,
  set,
  setEach,
  sharedOf,
} from "./inspector-fields.tsx";

const OPACITY_OPTIONS: StyleOption[] = [1, 0.9, 0.75, 0.5, 0.25, 0.1, 0].map(
  (o) => ({
    label: `${Math.round(o * 100)}%`,
    value: String(o),
  })
);

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

export const AppearanceSection = ({
  nodes,
}: {
  nodes: readonly DesignNode[];
}) => {
  const radius = useTokenOptions("radius");
  const shadows = useTokenOptions("shadow");
  const borderWidths = useTokenOptions("borderWidth");
  const border = (field: "width" | "color" | "style") =>
    sharedOf(nodes, (n) => n.border?.[field]);
  // Each node keeps the rest of its own border.
  const setBorder =
    (field: "width" | "color" | "style") => (value: JsonValue) =>
      setEach("Change border", (n) => ({
        border: withBorder(n.border, field, value),
      }));
  const borderColor = border("color");
  const swatch = useColorOf(borderColor === MIXED ? undefined : borderColor);
  const borderColors = useTokenOptions("color");
  return (
    <>
      <Section title="Fill">
        <Row label="Background">
          <ColorField
            field="fill"
            {...shownAs(sharedOf(nodes, (n) => n.fill))}
          />
        </Row>
      </Section>
      <Section title="Border">
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
            {...shownAs(border("width"), "None")}
          />
        </Row>
        <Row label="Colour">
          <ValueField
            accept={(q) => CSS.supports("color", q)}
            leading={<Swatch color={swatch} />}
            onChange={setBorder("color")}
            options={borderColors}
            {...shownAs(borderColor, "Current colour")}
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
        <Row label="Radius">
          <ValueField
            onChange={(v) => set("radius", v)}
            options={radius}
            {...shownAs(
              sharedOf(nodes, (n) => n.radius),
              "0"
            )}
          />
        </Row>
      </Section>
      <Section title="Effects">
        <Row label="Shadow">
          <ValueField
            accept={(q) => CSS.supports("box-shadow", q)}
            onChange={(v) => set("shadow", v)}
            options={shadows}
            {...shownAs(
              sharedOf(nodes, (n) => n.shadow),
              "None"
            )}
          />
        </Row>
        <Row label="Opacity">
          <ValueField
            onChange={(v) => {
              const n =
                typeof v === "number" ? v : Number.parseFloat(String(v));
              set(
                "opacity",
                v === null || !Number.isFinite(n)
                  ? null
                  : Math.min(1, Math.max(0, n > 1 ? n / 100 : n))
              );
            }}
            options={OPACITY_OPTIONS}
            {...shownAs(
              sharedOf(nodes, (n) => n.opacity),
              "100%"
            )}
          />
        </Row>
      </Section>
    </>
  );
};
