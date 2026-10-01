/**
 * The selected node's fields, the way a design tool shows them: layout, size, spacing, type,
 * colour, border, effects. Values are the design system's tokens where it has them, pixels or
 * plain CSS otherwise, and every change is one operation on the node's document.
 *
 * With several nodes selected it shows what they have in common: the fields of their kind when
 * they are of one kind, the value of a field when they agree on it and "Mixed" when they do not.
 * A change sets every one of them, as one undo step.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  TEXT_STYLE_GROUPS,
  type TextStyle,
  type TextStyleSetting,
} from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  ImageNode,
  InstanceNode,
  TextNode,
} from "@ultrapaint/contracts/document";
import type { ViewportPreset } from "@ultrapaint/contracts/pages";
import { fillWarnings } from "@ultrapaint/design-document/sizing";
import {
  attachTextStyle,
  detachTextStyle,
  groupTextStyles,
  matchTextStyle,
} from "@ultrapaint/design-document/text-styles";
import { nodeKind, nodeLabel } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowRight,
  Code,
  Copy,
  Eye,
  EyeOff,
  Group,
  Link2,
  StretchHorizontal,
  Trash2,
  TriangleAlert,
  Ungroup,
  Unlink2,
  Upload,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "../components/icon-button.tsx";
import { LinkField } from "../components/link-field.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty, Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { SidesIcon } from "../components/sides-icon.tsx";
import type { StyleOption } from "../components/style-combobox.tsx";
import { ValueField } from "../components/value-field.tsx";
import {
  allSelected,
  areSiblings,
  deleteSelection,
  duplicateSelection,
  setHidden,
  setPropsOfSelection,
  unwrapSelection,
  updateSelection,
  updateSelectionWith,
  wrapSelection,
} from "../lib/node-actions.ts";
import { editPageUrl, implementPage } from "../lib/page-actions.ts";
import { presetOf, viewportPresets } from "../lib/presets.ts";
import {
  MIXED,
  type Shared,
  sharedValue,
  shownAs,
} from "../lib/shared-value.ts";
import { type Side, sharedSide, withSides } from "../lib/sides.ts";
import {
  Swatch,
  type TokenKind,
  useColorOf,
  useTokenOptions,
} from "../lib/token-options.tsx";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import {
  isNodeFrame,
  nodeIn,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useInstances } from "../state/instances.ts";
import { reportError, useProject } from "../state/project.ts";
import { ComponentProps } from "./component-props.tsx";

type Set = (field: string, value: JsonValue) => void;

/**
 * The nodes the inspector is about: every one selected, the one it shows first leading; or the
 * root of the selected page.
 */
const useInspected = () => {
  const selection = useEditor((s) => s.selection);
  const also = useEditor((s) => s.also);
  const selectedPage = useEditor((s) => s.selectedPage);
  const canvas = useEditor((s) => s.canvas);
  const nodes = useDocuments(
    useShallow((s): DesignNode[] => {
      if (selection) {
        return [selection, ...also].flatMap((t) => {
          const node = nodeIn(s.docs, canvas, t.frame, t.nodeId);
          return node ? [node] : [];
        });
      }
      const root = selectedPage
        ? rootOfFrame(s.docs, canvas, selectedPage)
        : null;
      return root ? [root] : [];
    })
  );
  const frame = selection?.frame ?? selectedPage;
  const [node] = nodes;
  return node && frame ? { frame, node, nodes } : null;
};

/** Sets a field of every node inspected. */
const set: Set = (field, value) =>
  updateSelection({ [field]: value }, `Change ${field}`);

/** Sets fields of every node inspected, worked out from each: the rest of its border, its sides. */
const setEach = (
  label: string,
  setOf: (node: DesignNode) => Record<string, JsonValue>
) => updateSelectionWith(setOf, label);

/** What the nodes have in a field: the value they share, or `MIXED`. */
const sharedOf = <N extends DesignNode, T extends JsonValue>(
  nodes: readonly N[],
  read: (node: N) => T | undefined
): Shared<T> => sharedValue(nodes.map(read));

/** A choice's value for a segmented control or a select: none pressed when the nodes differ. */
const nullIfMixed = <T extends JsonValue>(shared: Shared<T>): T | null =>
  shared === MIXED || shared === undefined ? null : shared;

/** Whether every node is of one type, so that the fields of the type fit them all. */
const allOf = <T extends DesignNode["type"]>(
  nodes: readonly DesignNode[],
  type: T
): nodes is readonly Extract<DesignNode, { type: T }>[] =>
  nodes.every((n) => n.type === type);

type Stack = Extract<DesignNode, { type: "page" | "row" | "column" | "group" }>;

const isStack = (node: DesignNode): node is Stack =>
  node.type === "page" ||
  node.type === "row" ||
  node.type === "column" ||
  node.type === "group";

const allStacks = (nodes: readonly DesignNode[]): nodes is readonly Stack[] =>
  nodes.every(isStack);

/** Instances of one component, whose props are the same props. */
const oneComponent = (
  nodes: readonly DesignNode[]
): nodes is readonly InstanceNode[] => {
  const [first] = nodes;
  return (
    first?.type === "instance" &&
    nodes.every(
      (n) =>
        n.type === "instance" &&
        n.component === first.component &&
        n.from === first.from
    )
  );
};

export const Inspector = () => {
  const inspected = useInspected();
  if (!inspected) {
    return (
      <PanelEmpty>
        Select a node on the canvas or in the layers panel
      </PanelEmpty>
    );
  }
  const { frame, node, nodes } = inspected;
  return (
    <div
      className="flex flex-col pb-8"
      key={`${frame}#${nodes.map((n) => n.id).join(",")}`}
    >
      <Header frame={frame} node={node} nodes={nodes} />
      {node.type === "page" && nodes.length === 1 && (
        <PageSection frame={frame} />
      )}
      {oneComponent(nodes) && <InstanceSection nodes={nodes} />}
      {allOf(nodes, "text") && <TextSection nodes={nodes} />}
      {allOf(nodes, "image") && <ImageSection nodes={nodes} />}
      {allStacks(nodes) && <LayoutSection nodes={nodes} />}
      <SizeSection frame={frame} nodes={nodes} />
      <SidesSection field="padding" nodes={nodes} title="Padding" />
      <SidesSection field="margin" nodes={nodes} title="Margin" />
      <AppearanceSection nodes={nodes} />
      {/* A node placed beside the pages is never in the prototype: nothing would follow it. */}
      {node.type !== "page" && !isNodeFrame(frame) && (
        <LinkSection nodes={nodes} />
      )}
    </div>
  );
};

// ---- Header and actions ----

const NameInput = ({ node }: { node: DesignNode }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) {
      return;
    }
    const next = draft.trim();
    setDraft(null);
    if (next !== (node.name ?? "")) {
      set("name", next === "" ? null : next);
    }
  };
  return (
    <Input
      aria-label="Name"
      className="h-7 border-transparent bg-transparent px-1 font-semibold text-sm shadow-none hover:border-input dark:bg-transparent"
      onBlur={commit}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
        }
      }}
      placeholder={nodeLabel({ ...node, name: undefined })}
      value={draft ?? node.name ?? ""}
    />
  );
};

/** One node by its kind; several by how many they are, and of which kinds. */
const Kinds = ({
  frame,
  node,
  nodes,
}: {
  frame: string;
  node: DesignNode;
  nodes: readonly DesignNode[];
}) => {
  const rect = useEditor((s) =>
    s.selection ? s.rects[frame]?.[s.selection.nodeId] : undefined
  );
  if (nodes.length > 1) {
    return (
      <div className="truncate px-1 text-[11px] text-muted-foreground">
        {[...new Set(nodes.map(nodeKind))].join(", ")}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
      <span className={cn(node.type === "instance" && "text-component")}>
        {nodeKind(node)}
      </span>
      {rect ? (
        <span>
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      ) : null}
      <span className="ml-auto truncate font-mono text-[10px]" title="Id">
        {node.id}
      </span>
    </div>
  );
};

const Header = ({
  frame,
  node,
  nodes,
}: {
  frame: string;
  node: DesignNode;
  nodes: readonly DesignNode[];
}) => {
  const isRoot = node.type === "page";
  const several = nodes.length > 1;
  const hidden = nodes.every((n) => n.hidden === true);
  // Several nodes go into one container only from one parent.
  const wrappable = !several || areSiblings(allSelected());
  const wrapTip = (tip: string) =>
    wrappable ? tip : "Only siblings can be wrapped together";
  return (
    <div className="flex flex-col gap-1 border-b px-2 py-2">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          {several ? (
            <div className="truncate px-1 font-semibold text-sm leading-7">
              {nodes.length} selected
            </div>
          ) : (
            <NameInput node={node} />
          )}
        </div>
        {!isRoot && (
          <IconButton
            onClick={() => setHidden(!hidden)}
            tooltip={hidden ? "Show" : "Hide"}
          >
            {hidden ? <EyeOff /> : <Eye />}
          </IconButton>
        )}
      </div>
      <Kinds frame={frame} node={node} nodes={nodes} />
      {!isRoot && (
        <div className="flex items-center gap-0.5">
          <IconButton
            disabled={!wrappable}
            onClick={() => wrapSelection("group")}
            tooltip={wrapTip("Wrap in a group (⌘G)")}
          >
            <Group />
          </IconButton>
          <IconButton
            disabled={!wrappable}
            onClick={() => wrapSelection("row")}
            tooltip={wrapTip("Wrap in a row (⌥⌘G)")}
          >
            <ArrowRight />
          </IconButton>
          <IconButton
            disabled={!wrappable}
            onClick={() => wrapSelection("column")}
            tooltip={wrapTip("Wrap in a column (⇧⌘G)")}
          >
            <ArrowDown />
          </IconButton>
          {nodes.every(
            (n) => n.type === "row" || n.type === "column" || n.type === "group"
          ) && (
            <IconButton onClick={() => unwrapSelection()} tooltip="Unwrap">
              <Ungroup />
            </IconButton>
          )}
          <span className="flex-1" />
          <IconButton
            onClick={() => duplicateSelection()}
            tooltip="Duplicate (⌘D)"
          >
            <Copy />
          </IconButton>
          <IconButton onClick={() => deleteSelection()} tooltip="Delete (⌫)">
            <Trash2 />
          </IconButton>
        </div>
      )}
    </div>
  );
};

// ---- Page ----

const PageSection = ({ frame }: { frame: string }) => {
  const layout = useEditor((s) => s.frames[frame]);
  const page = useProject((s) => s.pages.find((p) => p.id === frame));
  if (!(layout && page)) {
    return null;
  }
  return (
    <Section title="Page">
      <Row label="URL">
        <button
          className={cn(
            "truncate text-left text-[11px] hover:underline",
            page.route === undefined ? "text-muted-foreground" : "font-mono"
          )}
          onClick={() => editPageUrl(page)}
          title={
            page.route === undefined
              ? "No link or prototype reaches it: click to give it a URL"
              : "Change the URL"
          }
          type="button"
        >
          {page.route ?? "None"}
        </button>
      </Row>
      <Row label="Viewport">
        <OptionSelect
          onChange={(v) =>
            useEditor.getState().setPreset(frame, v as ViewportPreset)
          }
          options={viewportPresets}
          size="sm"
          value={presetOf(layout)}
        />
      </Row>
      <Row label="Frame">
        <span className="text-[11px] text-muted-foreground">
          {Math.round(layout.width)} × {Math.round(layout.height)}
        </span>
      </Row>
      <Button
        className="mt-1 justify-start"
        onClick={() => implementPage(page)}
        size="sm"
        variant="outline"
      >
        <Code />
        Implement in the application
      </Button>
    </Section>
  );
};

// ---- Instance ----

const TextInput = ({
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== (value ?? "")) {
      onChange(draft);
    }
    setDraft(null);
  };
  const common = {
    onBlur: commit,
    placeholder,
    value: draft ?? value ?? "",
  };
  return multiline ? (
    <Textarea
      {...common}
      className="min-h-16 text-[11px] md:text-[11px]"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  ) : (
    <Input
      {...common}
      className="h-6 md:text-[11px]"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

/** A line under a section's fields about why what they say is not what is drawn. */
const Warning = ({ children }: { children: ReactNode }) => (
  <p className="flex gap-1.5 text-[11px] text-warning [&_svg]:mt-px [&_svg]:size-3 [&_svg]:shrink-0">
    <TriangleAlert />
    <span>{children}</span>
  </p>
);

/** The props instances of one component share, and the ones they set differently. */
const sharedProps = (nodes: readonly InstanceNode[]) => {
  const props: Record<string, JsonValue> = {};
  const mixed = new Set<string>();
  for (const name of new Set(
    nodes.flatMap((n) => Object.keys(n.props ?? {}))
  )) {
    const value = sharedValue(nodes.map((n) => n.props?.[name]));
    if (value === MIXED) {
      mixed.add(name);
    } else if (value !== undefined && value !== null) {
      props[name] = value;
    }
  }
  return { mixed, props };
};

const InstanceSection = ({ nodes }: { nodes: readonly InstanceNode[] }) => {
  const [node] = nodes;
  if (!node) {
    return null;
  }
  const { mixed, props } = sharedProps(nodes);
  return (
    <>
      <Section title="Component">
        {nodes.length === 1 && <WrappedWarning node={node} />}
        <Row label="Name">
          <span className="truncate font-medium text-component">
            {node.component}
          </span>
        </Row>
        <Row label="From">
          <span
            className="truncate font-mono text-[10px] text-muted-foreground"
            title={node.from}
          >
            {node.from}
          </span>
        </Row>
        {nodes.every((n) => (n.children?.length ?? 0) === 0) && (
          <Row label="Text">
            <TextInput
              onChange={(v) => set("text", v === "" ? null : v)}
              {...shownAs(
                sharedOf(nodes, (n) => n.text),
                "No text"
              )}
            />
          </Row>
        )}
      </Section>
      <ComponentProps
        mixed={mixed}
        node={{ ...node, props }}
        onSet={(name, value) => setPropsOfSelection({ [name]: value })}
      />
    </>
  );
};

/**
 * A component that keeps its props to itself cannot take the node's size, padding or fill: the
 * canvas draws them on a box around it, and the code has to do the same.
 */
const WrappedWarning = ({ node }: { node: InstanceNode }) => {
  const wrapped = useInstances((s) => s.drawn[node.id]?.wrapped ?? false);
  return wrapped ? (
    <Warning>
      {node.component} does not pass its props on to what it draws, so its size,
      padding and fill are drawn on a box around it.
    </Warning>
  ) : null;
};

// ---- Text ----

const ROLE_OPTIONS = [
  { label: "Paragraph", value: "p" },
  ...[1, 2, 3, 4, 5, 6].map((level) => ({
    label: `Heading ${level}`,
    value: `h${level}`,
  })),
];

const TokenField = ({
  field,
  kind,
  value,
  placeholder,
  numeric = true,
  onChange,
  className,
  title,
}: {
  field: string;
  kind: TokenKind;
  value: JsonValue | undefined;
  placeholder?: string;
  numeric?: boolean;
  /** Instead of setting the field on the node directly. */
  onChange?: (value: JsonValue) => void;
  className?: string;
  title?: string;
}) => {
  const options = useTokenOptions(kind);
  return (
    <ValueField
      accept={(q) => !numeric || CSS.supports("width", q)}
      className={className}
      onChange={(v) => (onChange ? onChange(v) : set(field, v))}
      options={options}
      placeholder={placeholder ?? "Default"}
      title={title}
      value={value}
    />
  );
};

const ColorField = ({
  field,
  value,
  placeholder,
}: {
  field: string;
  value: JsonValue | undefined;
  placeholder?: string;
}) => {
  const options = useTokenOptions("color");
  const color = useColorOf(value);
  return (
    <ValueField
      accept={(q) => CSS.supports("color", q)}
      leading={<Swatch color={color} />}
      onChange={(v) => set(field, v)}
      options={options}
      placeholder={placeholder ?? "None"}
      value={value}
    />
  );
};

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
  const attach = (next: TextStyle) =>
    updateSelection(attachTextStyle(next), `Set the text in ${next.name}`);
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
      return next ? attachTextStyle(next) : {};
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

const TextSection = ({ nodes }: { nodes: readonly TextNode[] }) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const styles = ds?.typography.styles ?? [];
  const named = sharedValue(nodes.map((n) => n.textStyle));
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
  const setting = (key: TextStyleSetting, kind: TokenKind, numeric = true) => (
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
      <Row label="Size">{setting("size", "size")}</Row>
      <Row label="Weight">{setting("weight", "weight")}</Row>
      <Row label="Font">{setting("font", "font", false)}</Row>
      <Row label="Line">{setting("lineHeight", "leading")}</Row>
      <Row label="Tracking">{setting("tracking", "tracking")}</Row>
      <Row label="Colour">
        <ColorField
          field="color"
          {...shownAs(
            sharedOf(nodes, (n) => n.color),
            "Inherited"
          )}
        />
      </Row>
      <Row label="Align">
        <Segmented
          onChange={(v) => set("align", v)}
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
          value={nullIfMixed(sharedOf(nodes, (n) => n.align))}
        />
      </Row>
    </Section>
  );
};

// ---- Image ----

const ImageSection = ({ nodes }: { nodes: readonly ImageNode[] }) => {
  const input = useRef<HTMLInputElement>(null);
  const canvas = useEditor((s) => s.canvas);
  const upload = async (file: File | undefined) => {
    if (!file || canvas === null) {
      return;
    }
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        resolve(url.slice(url.indexOf(",") + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    try {
      const { src } = await api().request("assets.upload", {
        data,
        name: file.name,
      });
      set("src", src);
    } catch (error) {
      reportError(error);
    }
  };
  const src = sharedOf(nodes, (n) => n.src);
  return (
    <Section title="Image">
      <Row label="Source">
        <TextInput
          onChange={(v) => set("src", v)}
          {...shownAs(
            typeof src === "string" && src.startsWith("data:")
              ? "placeholder"
              : src
          )}
        />
        <IconButton
          onClick={() => input.current?.click()}
          tooltip="Upload an image"
        >
          <Upload />
        </IconButton>
        <input
          accept="image/*"
          className="hidden"
          onChange={(e) => upload(e.target.files?.[0])}
          ref={input}
          type="file"
        />
      </Row>
      <Row label="Alt text">
        <TextInput
          onChange={(v) => set("alt", v)}
          {...shownAs(sharedOf(nodes, (n) => n.alt))}
        />
      </Row>
      <Row label="Fit">
        <Segmented
          onChange={(v) => set("fit", v)}
          options={[
            { label: "Cover", value: "cover" },
            { label: "Contain", value: "contain" },
            { label: "Fill", value: "fill" },
          ]}
          value={nullIfMixed(sharedOf(nodes, (n) => n.fit ?? "cover"))}
        />
      </Row>
    </Section>
  );
};

// ---- Layout ----

/** A field of a page, a row or a column, which a group does not have. */
const flexField = <K extends "gap" | "align" | "crossAlign" | "wrap">(
  node: Stack,
  field: K
) => (node.type === "group" ? undefined : node[field]);

const LayoutSection = ({ nodes }: { nodes: readonly Stack[] }) => {
  const spacing = useTokenOptions("spacing");
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
            <ValueField
              onChange={(v) => set("gap", v)}
              options={spacing}
              {...shownAs(
                sharedOf(nodes, (n) => flexField(n, "gap")),
                "0"
              )}
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
  short,
  value,
}: {
  field: string;
  short: string;
  value: Shared<JsonValue>;
}) => (
  <ValueField
    accept={(q) => CSS.supports("width", q)}
    leading={<span className="w-2.5">{short}</span>}
    onChange={(v) => set(field, v)}
    options={[]}
    {...shownAs(value, "–")}
  />
);

/** Why a `fill` of the node has no room to take, from its parent's size. */
const useFillWarnings = (frame: string, node: DesignNode) => {
  const canvas = useEditor((s) => s.canvas);
  const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frame));
  const instances = useInstances((s) => s.drawn);
  return root
    ? fillWarnings(root, instances).filter((w) => w.nodeId === node.id)
    : [];
};

const SizeSection = ({
  frame,
  nodes,
}: {
  frame: string;
  nodes: readonly DesignNode[];
}) => {
  const [only] = nodes;
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
        <LengthField field="minWidth" short="W" value={of("minWidth")} />
        <LengthField field="minHeight" short="H" value={of("minHeight")} />
      </Row>
      <Row label="Max">
        <LengthField field="maxWidth" short="W" value={of("maxWidth")} />
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
const SidesSection = ({
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
          setEach(`Change ${field}`, (n) => ({
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

// ---- Fill, border, effects ----

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

const AppearanceSection = ({ nodes }: { nodes: readonly DesignNode[] }) => {
  const radius = useTokenOptions("radius");
  const shadows = useTokenOptions("shadow");
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
            options={[0, 1, 2, 4].map((w) => ({
              label: String(w),
              value: String(w),
            }))}
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

// ---- Prototype ----

/** Where the nodes lead when pressed in the prototype. */
const LinkSection = ({ nodes }: { nodes: readonly DesignNode[] }) => {
  const shared = sharedOf(nodes, (n) => n.link);
  return (
    <Section title="Prototype">
      <Row label="Goes to">
        <LinkField
          link={shared === MIXED ? undefined : (shared ?? undefined)}
          mixed={shared === MIXED}
          onChange={(link) => set("link", link)}
        />
      </Row>
    </Section>
  );
};
