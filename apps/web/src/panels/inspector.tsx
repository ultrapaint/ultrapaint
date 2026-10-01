/**
 * The selected node's fields, the way a design tool shows them: layout, size, spacing, type,
 * colour, border, effects. Values are the design system's tokens where it has them, pixels or
 * plain CSS otherwise, and every change is one operation on the node's document.
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
import { normaliseRoute } from "@ultrapaint/shared/route";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty, Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { SidesIcon } from "../components/sides-icon.tsx";
import type { StyleOption } from "../components/style-combobox.tsx";
import { ValueField } from "../components/value-field.tsx";
import {
  deleteSelection,
  duplicateSelection,
  setHidden,
  setPropsOfSelection,
  unwrapSelection,
  updateSelection,
  wrapSelection,
} from "../lib/node-actions.ts";
import { editPageUrl, implementPage } from "../lib/page-actions.ts";
import { presetOf, viewportPresets } from "../lib/presets.ts";
import { type Side, sidesOf, withSides } from "../lib/sides.ts";
import {
  Swatch,
  type TokenKind,
  useColorOf,
  useTokenOptions,
} from "../lib/token-options.tsx";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { nodeIn, rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useInstances } from "../state/instances.ts";
import { reportError, useProject } from "../state/project.ts";
import { ComponentProps } from "./component-props.tsx";

type Set = (field: string, value: JsonValue) => void;

/** The node the inspector is about: the one selected, or the root of the selected page. */
const useInspected = () => {
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  const canvas = useEditor((s) => s.canvas);
  const node = useDocuments((s) => {
    if (selection) {
      return nodeIn(s.docs, canvas, selection.frame, selection.nodeId);
    }
    return selectedPage ? rootOfFrame(s.docs, canvas, selectedPage) : null;
  });
  const frame = selection?.frame ?? selectedPage;
  return node && frame ? { frame, node } : null;
};

const set: Set = (field, value) =>
  updateSelection({ [field]: value }, `Change ${field}`);

export const Inspector = () => {
  const inspected = useInspected();
  if (!inspected) {
    return (
      <PanelEmpty>
        Select a node on the canvas or in the layers panel
      </PanelEmpty>
    );
  }
  const { frame, node } = inspected;
  return (
    <div className="flex flex-col pb-8" key={`${frame}#${node.id}`}>
      <Header frame={frame} node={node} />
      {node.type === "page" && <PageSection frame={frame} />}
      {node.type === "instance" && <InstanceSection node={node} />}
      {node.type === "text" && <TextSection node={node} />}
      {node.type === "image" && <ImageSection node={node} />}
      {(node.type === "page" ||
        node.type === "row" ||
        node.type === "column" ||
        node.type === "group") && <LayoutSection node={node} />}
      <SizeSection frame={frame} node={node} />
      <SidesSection field="padding" node={node} title="Padding" />
      <SidesSection field="margin" node={node} title="Margin" />
      <AppearanceSection node={node} />
      {node.type !== "page" && <LinkSection node={node} />}
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

const Header = ({ frame, node }: { frame: string; node: DesignNode }) => {
  const rect = useEditor((s) =>
    s.selection ? s.rects[frame]?.[s.selection.nodeId] : undefined
  );
  const isRoot = node.type === "page";
  return (
    <div className="flex flex-col gap-1 border-b px-2 py-2">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <NameInput node={node} />
        </div>
        {!isRoot && (
          <IconButton
            onClick={() => setHidden(!node.hidden)}
            tooltip={node.hidden ? "Show" : "Hide"}
          >
            {node.hidden ? <EyeOff /> : <Eye />}
          </IconButton>
        )}
      </div>
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
      {!isRoot && (
        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={() => wrapSelection("group")}
            tooltip="Wrap in a group (⌘G)"
          >
            <Group />
          </IconButton>
          <IconButton
            onClick={() => wrapSelection("row")}
            tooltip="Wrap in a row (⌥⌘G)"
          >
            <ArrowRight />
          </IconButton>
          <IconButton
            onClick={() => wrapSelection("column")}
            tooltip="Wrap in a column (⇧⌘G)"
          >
            <ArrowDown />
          </IconButton>
          {(node.type === "row" ||
            node.type === "column" ||
            node.type === "group") && (
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

const InstanceSection = ({ node }: { node: InstanceNode }) => (
  <>
    <Section title="Component">
      <WrappedWarning node={node} />
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
      {(node.children?.length ?? 0) === 0 && (
        <Row label="Text">
          <TextInput
            onChange={(v) => set("text", v === "" ? null : v)}
            placeholder="No text"
            value={node.text}
          />
        </Row>
      )}
    </Section>
    <ComponentProps
      node={node}
      onSet={(name, value) => setPropsOfSelection({ [name]: value })}
    />
  </>
);

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

/**
 * A text style is size, weight and line height (and family and tracking) as one thing. Set in
 * one, the fields below show what the style gives; changing any of them, or the broken chain,
 * detaches the style and leaves the same settings on the text to change one by one. The chain
 * sets it back in the style the settings match, or the one for its role.
 */
const TextStyleRow = ({
  node,
  style,
  styles,
}: {
  node: TextNode;
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
    updateSelection(detachTextStyle(node, style), "Detach the text style");
  const onStyle = (v: string) => {
    const next = styles.find((s) => s.name === v);
    return next ? attach(next) : detach();
  };
  const relink = () => {
    const next = matchTextStyle(node, styles);
    return next ? attach(next) : undefined;
  };
  const stale = node.textStyle !== undefined && style === undefined;
  const none = styles.length === 0 ? "No text styles" : "None";
  return (
    <Row label="Style">
      <OptionSelect
        onChange={onStyle}
        options={options}
        placeholder={stale ? `${node.textStyle} (missing)` : none}
        size="sm"
        value={style ? style.name : ""}
      />
      {style || stale ? (
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

const TextSection = ({ node }: { node: TextNode }) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const styles = ds?.typography.styles ?? [];
  const style = node.textStyle
    ? styles.find((s) => s.name === node.textStyle)
    : undefined;
  const role = node.role === "heading" ? `h${node.level ?? 1}` : "p";
  const onRole = (v: string) =>
    updateSelection(
      v === "p"
        ? { level: null, role: "paragraph" }
        : { level: Number(v.slice(1)), role: "heading" },
      "Change the text's role"
    );
  // What the text is set in: its own field where it has one, the style's otherwise.
  const settingOf = (key: TextStyleSetting): JsonValue | undefined =>
    node[key] ?? style?.[key];
  /** Editing a setting the style gives detaches the style, so the other settings stay. */
  const onSetting = (key: TextStyleSetting) => (value: JsonValue) =>
    style
      ? updateSelection(
          { ...detachTextStyle(node, style), [key]: value },
          "Detach the text style"
        )
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
      value={settingOf(key)}
    />
  );
  return (
    <Section title="Text">
      <TextInput multiline onChange={(v) => set("text", v)} value={node.text} />
      <Row label="Role">
        <OptionSelect
          onChange={onRole}
          options={ROLE_OPTIONS}
          size="sm"
          value={role}
        />
      </Row>
      <TextStyleRow node={node} style={style} styles={styles} />
      <Row label="Size">{setting("size", "size")}</Row>
      <Row label="Weight">{setting("weight", "weight")}</Row>
      <Row label="Font">{setting("font", "font", false)}</Row>
      <Row label="Line">{setting("lineHeight", "leading")}</Row>
      <Row label="Tracking">{setting("tracking", "tracking")}</Row>
      <Row label="Colour">
        <ColorField field="color" placeholder="Inherited" value={node.color} />
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
          value={node.align ?? null}
        />
      </Row>
    </Section>
  );
};

// ---- Image ----

const ImageSection = ({ node }: { node: ImageNode }) => {
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
  return (
    <Section title="Image">
      <Row label="Source">
        <TextInput
          onChange={(v) => set("src", v)}
          value={node.src.startsWith("data:") ? "placeholder" : node.src}
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
        <TextInput onChange={(v) => set("alt", v)} value={node.alt} />
      </Row>
      <Row label="Fit">
        <Segmented
          onChange={(v) => set("fit", v)}
          options={[
            { label: "Cover", value: "cover" },
            { label: "Contain", value: "contain" },
            { label: "Fill", value: "fill" },
          ]}
          value={node.fit ?? "cover"}
        />
      </Row>
    </Section>
  );
};

// ---- Layout ----

type Stack = Extract<DesignNode, { type: "page" | "row" | "column" | "group" }>;

const LayoutSection = ({ node }: { node: Stack }) => {
  const spacing = useTokenOptions("spacing");
  const row = node.type === "row";
  const flex = node.type !== "group";
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
            value={node.type}
          />
        </Row>
      )}
      {flex ? (
        <>
          <Row label="Gap">
            <ValueField
              onChange={(v) => set("gap", v)}
              options={spacing}
              placeholder="0"
              value={(node as { gap?: JsonValue }).gap}
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
              value={(node as { align?: string }).align ?? "start"}
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
              value={(node as { crossAlign?: string }).crossAlign ?? "stretch"}
            />
          </Row>
          {row && (
            <Row label="Wrap">
              <Segmented
                onChange={(v) => set("wrap", v === "wrap" ? true : null)}
                options={[
                  { label: "No wrap", value: "nowrap" },
                  { label: "Wrap", value: "wrap" },
                ]}
                value={(node as { wrap?: boolean }).wrap ? "wrap" : "nowrap"}
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
  value: JsonValue | undefined;
}) => (
  <ValueField
    leading={<span className="w-2.5">{field === "width" ? "W" : "H"}</span>}
    onChange={(v) => set(field, v)}
    options={SIZE_OPTIONS}
    placeholder="Auto"
    value={value}
  />
);

const LengthField = ({
  field,
  short,
  value,
}: {
  field: string;
  short: string;
  value: JsonValue | undefined;
}) => (
  <ValueField
    accept={(q) => CSS.supports("width", q)}
    leading={<span className="w-2.5">{short}</span>}
    onChange={(v) => set(field, v)}
    options={[]}
    placeholder="–"
    value={value}
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

const SizeSection = ({ frame, node }: { frame: string; node: DesignNode }) => (
  <Section title="Size">
    <Row label="Size">
      <SizeField field="width" value={node.width} />
      <SizeField field="height" value={node.height} />
    </Row>
    <FillWarnings frame={frame} node={node} />
    <Row label="Min">
      <LengthField field="minWidth" short="W" value={node.minWidth} />
      <LengthField field="minHeight" short="H" value={node.minHeight} />
    </Row>
    <Row label="Max">
      <LengthField field="maxWidth" short="W" value={node.maxWidth} />
      <LengthField field="maxHeight" short="H" value={node.maxHeight} />
    </Row>
  </Section>
);

const FillWarnings = ({ frame, node }: { frame: string; node: DesignNode }) =>
  useFillWarnings(frame, node).map((w) => (
    <Warning key={w.axis}>{w.message}</Warning>
  ));

// ---- Padding and margin ----

/** Padding or margin, side by side, each field lit on the side it sets. */
const SidesSection = ({
  field,
  node,
  title,
}: {
  field: "padding" | "margin";
  node: DesignNode;
  title: string;
}) => {
  const spacing = useTokenOptions("spacing");
  const value = node[field];
  const sides = sidesOf(value);
  const side = (key: Side) => (
    <ValueField
      leading={<SidesIcon className="text-foreground" lit={[key]} />}
      onChange={(v) => set(field, withSides(value, [key], v))}
      options={spacing}
      placeholder="0"
      title={`${title}, ${key}`}
      value={sides[key]}
    />
  );
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

const AppearanceSection = ({ node }: { node: DesignNode }) => {
  const radius = useTokenOptions("radius");
  const shadows = useTokenOptions("shadow");
  const border = node.border ?? {};
  const setBorder = (field: string) => (value: JsonValue) => {
    const next: Record<string, JsonValue> = { ...border };
    if (value === null) {
      delete next[field];
    } else {
      next[field] = value;
    }
    set("border", Object.keys(next).length === 0 ? null : next);
  };
  const borderColor = useColorOf(border.color);
  const borderColors = useTokenOptions("color");
  return (
    <>
      <Section title="Fill">
        <Row label="Background">
          <ColorField field="fill" value={node.fill} />
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
            placeholder="None"
            value={border.width}
          />
        </Row>
        <Row label="Colour">
          <ValueField
            accept={(q) => CSS.supports("color", q)}
            leading={<Swatch color={borderColor} />}
            onChange={setBorder("color")}
            options={borderColors}
            placeholder="Current colour"
            value={border.color}
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
            value={border.style ?? "solid"}
          />
        </Row>
        <Row label="Radius">
          <ValueField
            onChange={(v) => set("radius", v)}
            options={radius}
            placeholder="0"
            value={node.radius}
          />
        </Row>
      </Section>
      <Section title="Effects">
        <Row label="Shadow">
          <ValueField
            accept={(q) => CSS.supports("box-shadow", q)}
            onChange={(v) => set("shadow", v)}
            options={shadows}
            placeholder="None"
            value={node.shadow}
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
            placeholder="100%"
            value={node.opacity}
          />
        </Row>
      </Section>
    </>
  );
};

// ---- Prototype ----

const LinkSection = ({ node }: { node: DesignNode }) => {
  const canvas = useEditor((s) => s.canvas);
  const pages = useProject((s) => s.pages);
  // A link names a URL: the pages that serve one, as their name and URL.
  const targets = pages
    .filter(
      (p) =>
        p.canvas === canvas && p.variant === undefined && p.route !== undefined
    )
    .sort((a, b) => (a.route ?? "").localeCompare(b.route ?? ""));
  const link = node.link ?? "";
  const broken =
    link !== "" && !targets.some((p) => p.route === normaliseRoute(link));
  return (
    <Section title="Prototype">
      <Row label="Goes to">
        <OptionSelect
          onChange={(v) => set("link", v === "" ? null : v)}
          options={[
            { label: "Nowhere", value: "" },
            ...targets.map((p) => ({
              label: `${p.name} · ${p.route}`,
              value: p.route ?? "",
            })),
            ...(broken ? [{ label: `${link} (no page)`, value: link }] : []),
          ]}
          size="sm"
          value={link}
        />
      </Row>
    </Section>
  );
};
