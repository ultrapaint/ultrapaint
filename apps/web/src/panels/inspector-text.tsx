/**
 * The inspector's text section: the style a text is set in, its role, and its type, colour and
 * alignment.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  TEXT_STYLE_GROUPS,
  type TextStyle,
  type TextStyleSetting,
} from "@ultrapaint/contracts/design-system";
import type { TextNode } from "@ultrapaint/contracts/document";
import {
  detachTextStyle,
  groupTextStyles,
  matchTextStyle,
} from "@ultrapaint/design-document/text-styles";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Link2,
  Unlink2,
} from "lucide-react";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { setField, updateSelection } from "../lib/node-actions.ts";
import {
  ALIGN,
  sharedField,
  TEXT_STYLE,
  TOKEN_FIELDS,
} from "../lib/node-fields.ts";
import {
  MIXED,
  type Shared,
  sharedValue,
  shownAs,
} from "../lib/shared-value.ts";
import type { FieldTokenKind } from "../lib/token-options.tsx";
import { useDesignSystem } from "../state/design-system.ts";
import {
  ColorField,
  nullIfMixed,
  set,
  setEach,
  sharedOf,
  TextInput,
  TokenField,
} from "./inspector-fields.tsx";

const ROLE_OPTIONS = [
  { label: "Paragraph", value: "p" },
  ...[1, 2, 3, 4, 5, 6].map((level) => ({
    label: `Heading ${level}`,
    value: `h${level}`,
  })),
];

/** The style a text is set in, when the design system still has it. */
const styleOf = (styles: readonly TextStyle[], node: TextNode) =>
  node.textStyle ? styles.find((s) => s.name === node.textStyle) : undefined;

/** Sets fields of every text inspected, worked out from each. */
const setTexts = (
  label: string,
  setOf: (node: TextNode) => Record<string, JsonValue>
) => setEach(label, (node) => (node.type === "text" ? setOf(node) : {}));

/**
 * A text style is size, weight and line height (and family and tracking) as one thing. Set in
 * one, the fields below show what the style gives; changing any of them, or the broken chain,
 * detaches the style and leaves the same settings on the text to change one by one. The chain
 * sets it back in the style the settings match, or the one for its role.
 */
const TextStyleRow = ({
  named,
  nodes,
  style,
  styles,
}: {
  /** The style the texts share by name, or `MIXED`. */
  named: Shared<string>;
  nodes: readonly TextNode[];
  style: TextStyle | undefined;
  styles: readonly TextStyle[];
}) => {
  const options = [
    { label: "None", value: "" },
    ...[...groupTextStyles(styles)].flatMap(([group, list]) =>
      list.map((s) => ({
        description: s.description,
        group: TEXT_STYLE_GROUPS.find((g) => g.group === group)?.label,
        label: s.name,
        value: s.name,
      }))
    ),
  ];
  const attach = (next: TextStyle) => setField(TEXT_STYLE, next);
  const detach = () =>
    setTexts("Detach the text style", (n) =>
      detachTextStyle(n, styleOf(styles, n))
    );
  const onStyle = (v: string) => {
    const next = styles.find((s) => s.name === v);
    return next ? attach(next) : detach();
  };
  // Each text goes back into the style its settings match, or the one for its role.
  const relink = () => {
    const [only] = nodes;
    if (nodes.length === 1 && only) {
      const next = matchTextStyle(only, styles);
      return next ? attach(next) : undefined;
    }
    return setTexts("Set the texts in their styles", (n) => {
      const next = matchTextStyle(n, styles);
      return next ? TEXT_STYLE.write(next) : {};
    });
  };
  const stale = typeof named === "string" && style === undefined;
  const none = styles.length === 0 ? "No text styles" : "None";
  const placeholder = stale ? `${named} (missing)` : none;
  return (
    <Row label="Style">
      <OptionSelect
        onChange={onStyle}
        options={options}
        placeholder={named === MIXED ? "Mixed" : placeholder}
        size="sm"
        value={named === MIXED ? null : (style?.name ?? "")}
      />
      {nodes.some((n) => n.textStyle !== undefined) ? (
        <IconButton
          onClick={detach}
          size="icon-sm"
          tooltip="Detach the style: change the size, weight and line height on their own"
        >
          <Unlink2 />
        </IconButton>
      ) : (
        <IconButton
          disabled={styles.length === 0}
          onClick={relink}
          size="icon-sm"
          tooltip="Set the text in one style again"
        >
          <Link2 />
        </IconButton>
      )}
    </Row>
  );
};

export const TextSection = ({ nodes }: { nodes: readonly TextNode[] }) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const styles = ds?.typography.styles ?? [];
  const named = sharedField(TEXT_STYLE, nodes);
  const style =
    typeof named === "string"
      ? styles.find((s) => s.name === named)
      : undefined;
  const role = sharedValue(
    nodes.map((n) => (n.role === "heading" ? `h${n.level ?? 1}` : "p"))
  );
  const onRole = (v: string) =>
    updateSelection(
      v === "p"
        ? { level: null, role: "paragraph" }
        : { level: Number(v.slice(1)), role: "heading" },
      "Change the text's role"
    );
  // What a text is set in: its own field where it has one, its style's otherwise.
  const settingOf = (key: TextStyleSetting) =>
    sharedValue(
      nodes.map(
        (n): JsonValue | undefined => n[key] ?? styleOf(styles, n)?.[key]
      )
    );
  /** Editing a setting a style gives detaches the style, so the other settings stay. */
  const onSetting = (key: TextStyleSetting) => (value: JsonValue) =>
    nodes.some((n) => styleOf(styles, n))
      ? setTexts("Detach the text style", (n) => {
          const own = styleOf(styles, n);
          return own
            ? { ...detachTextStyle(n, own), [key]: value }
            : { [key]: value };
        })
      : set(key, value);
  const setting = (
    key: TextStyleSetting,
    kind: FieldTokenKind,
    numeric = true
  ) => (
    <TokenField
      className={style ? "text-muted-foreground" : undefined}
      field={key}
      kind={kind}
      numeric={numeric}
      onChange={onSetting(key)}
      title={
        style
          ? `From the text style ${style.name}. Changing it detaches the style.`
          : undefined
      }
      {...shownAs(settingOf(key))}
    />
  );
  return (
    <Section title="Text">
      <TextInput
        multiline
        onChange={(v) => set("text", v)}
        {...shownAs(sharedOf(nodes, (n) => n.text))}
      />
      <Row label="Role">
        <OptionSelect
          onChange={onRole}
          options={ROLE_OPTIONS}
          placeholder="Mixed"
          size="sm"
          value={role === MIXED ? null : (role ?? "p")}
        />
      </Row>
      <TextStyleRow named={named} nodes={nodes} style={style} styles={styles} />
      <Row label="Size">{setting("size", "fontSize")}</Row>
      <Row label="Weight">{setting("weight", "fontWeight")}</Row>
      <Row label="Font">{setting("font", "font", false)}</Row>
      <Row label="Line">{setting("lineHeight", "leading")}</Row>
      <Row label="Tracking">{setting("tracking", "tracking")}</Row>
      <Row label="Colour">
        <ColorField
          field={TOKEN_FIELDS.color}
          nodes={nodes}
          placeholder="Inherited"
        />
      </Row>
      <Row label="Align">
        <Segmented
          onChange={(v) => setField(ALIGN, v)}
          options={[
            {
              label: <AlignLeft className="size-3" />,
              title: "Start",
              value: "start",
            },
            {
              label: <AlignCenter className="size-3" />,
              title: "Center",
              value: "center",
            },
            {
              label: <AlignRight className="size-3" />,
              title: "End",
              value: "end",
            },
          ]}
          value={nullIfMixed(sharedField(ALIGN, nodes))}
        />
      </Row>
    </Section>
  );
};
