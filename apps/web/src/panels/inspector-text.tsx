/**
 * The inspector's text section: the style a text is set in, its type, colour and alignment, and
 * its less frequent settings (its role) in a Formatting popover.
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
  ALargeSmall,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Link2,
  SlidersHorizontal,
  UnfoldHorizontal,
  UnfoldVertical,
  Unlink2,
  X,
} from "lucide-react";
import { type ReactNode, useContext } from "react";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
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
  OverrideMark,
  ReadOnlyFieldsContext,
  Row,
  Section,
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
    <Row fields={["textStyle"]} label="Style">
      <OptionSelect
        onChange={onStyle}
        options={options}
        placeholder={named === MIXED ? "Mixed" : placeholder}
        value={named === MIXED ? null : (style?.name ?? "")}
      />
      {nodes.some((n) => n.textStyle !== undefined) ? (
        <IconButton
          className="text-muted-foreground"
          onClick={detach}
          tooltip="Detach style"
        >
          <Unlink2 />
        </IconButton>
      ) : (
        <IconButton
          className="text-muted-foreground"
          disabled={styles.length === 0}
          onClick={relink}
          tooltip="Attach to a style"
        >
          <Link2 />
        </IconButton>
      )}
    </Row>
  );
};

/** The fields the Role row sets. */
const ROLE_FIELDS = ["role", "level"];

/** Every field the Formatting popover's rows set: an override of one marks its button. */
const FORMATTING_FIELDS = [...ROLE_FIELDS];

/**
 * A text's less frequent settings, in a popover the Text section's header opens, drawn as the
 * inspector's own rows: the section holds only what is changed often. Read-only where the inspector is (a variation's part),
 * though it still opens to be read.
 */
const Formatting = ({ children }: { children: ReactNode }) => {
  const readOnly = useContext(ReadOnlyFieldsContext);
  return (
    <Popover>
      <span className="relative flex">
        <PopoverTrigger
          nativeButton={!readOnly}
          render={
            <IconButton
              className="text-muted-foreground"
              // A read-only inspector's fieldset disables every button and holds back every
              // press: this one opens the popover all the same, to be read.
              data-read-only-passes={readOnly ? "" : undefined}
              nativeButton={!readOnly}
              render={readOnly ? <span /> : undefined}
              size="icon-sm"
              tooltip="Formatting"
            />
          }
        >
          <SlidersHorizontal />
        </PopoverTrigger>
        <span className="absolute -top-1 -right-1 flex">
          <OverrideMark fields={FORMATTING_FIELDS} label="Formatting" />
        </span>
      </span>
      <PopoverContent
        align="start"
        className="gap-2"
        data-read-only-passes=""
        side="left"
        sideOffset={12}
      >
        <PopoverHeader className="flex-row items-center justify-between gap-2">
          <PopoverTitle className="font-heading-xsmall">
            Formatting
          </PopoverTitle>
          <PopoverClose
            render={
              <IconButton
                className="-my-1 -mr-1 text-muted-foreground"
                size="icon-sm"
                tooltip="Close"
              />
            }
          >
            <X />
          </PopoverClose>
        </PopoverHeader>
        <fieldset className="flex min-w-0 flex-col gap-1" disabled={readOnly}>
          {children}
        </fieldset>
      </PopoverContent>
    </Popover>
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
  /** A field of the text's type, named by `name` and, without a label, by its `icon`. */
  const setting = (
    key: TextStyleSetting,
    kind: FieldTokenKind,
    name: string,
    icon?: ReactNode
  ) => (
    <TokenField
      className={style ? "text-muted-foreground" : undefined}
      kind={kind}
      leading={icon}
      numeric={key !== "font"}
      onChange={onSetting(key)}
      title={style ? `${name}: from ${style.name}; a change detaches it` : name}
      {...shownAs(settingOf(key))}
    />
  );
  return (
    <Section
      action={
        <>
          <OverrideMark fields={["text"]} label="Text" />
          <Formatting>
            <Row fields={ROLE_FIELDS} label="Role">
              <OptionSelect
                onChange={onRole}
                options={ROLE_OPTIONS}
                placeholder="Mixed"
                value={role === MIXED ? null : (role ?? "p")}
              />
            </Row>
          </Formatting>
        </>
      }
      title="Text"
    >
      <div className="pb-1">
        <TextInput
          multiline
          onChange={(v) => set("text", v)}
          {...shownAs(sharedOf(nodes, (n) => n.text))}
        />
      </div>
      <TextStyleRow named={named} nodes={nodes} style={style} styles={styles} />
      <Row fields={["font"]} label="Font">
        {setting("font", "font", "Font")}
      </Row>
      <Row fields={["size", "weight"]} label="">
        {setting("size", "fontSize", "Size", <ALargeSmall />)}
        {setting("weight", "fontWeight", "Weight", <Bold />)}
      </Row>
      <Row fields={["lineHeight", "tracking"]} label="">
        {setting("lineHeight", "leading", "Line height", <UnfoldVertical />)}
        {setting("tracking", "tracking", "Tracking", <UnfoldHorizontal />)}
      </Row>
      <Row fields={["color"]} label="Colour">
        <ColorField
          field={TOKEN_FIELDS.color}
          nodes={nodes}
          placeholder="Inherited"
        />
      </Row>
      <Row fields={["align"]} label="Align">
        <Segmented
          onChange={(v) => setField(ALIGN, v)}
          options={[
            { label: <AlignLeft />, title: "Start", value: "start" },
            { label: <AlignCenter />, title: "Center", value: "center" },
            { label: <AlignRight />, title: "End", value: "end" },
          ]}
          value={nullIfMixed(sharedField(ALIGN, nodes))}
        />
      </Row>
    </Section>
  );
};
