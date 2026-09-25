/**
 * The selected node's fields, the way a design tool shows them: layout, size, spacing, type,
 * colour, border, effects. Values are the design system's tokens where it has them, pixels or
 * plain CSS otherwise, and every change is one operation on the node's document.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  DesignNode,
  ImageNode,
  InstanceNode,
  Padding,
  Sides,
  TextNode,
} from "@ultrapaint/contracts/document";
import type { ViewportPreset } from "@ultrapaint/contracts/pages";
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
  StretchHorizontal,
  Trash2,
  Ungroup,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty, Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
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
import { startCommand } from "../lib/start-thread.ts";
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
import { reportError, useProject } from "../state/project.ts";
import { ComponentProps } from "./component-props.tsx";

type Set = (field: string, value: JsonValue) => void;

/** The node the inspector is about: the one selected, or the root of the selected page. */
const useInspected = () => {
  const selection = useEditor((s) => s.selection);
  const selectedPage = useEditor((s) => s.selectedPage);
  const space = useEditor((s) => s.space);
  const node = useDocuments((s) => {
    if (selection) {
      return nodeIn(s.docs, space, selection.frame, selection.nodeId);
    }
    return selectedPage ? rootOfFrame(s.docs, space, selectedPage) : null;
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
      <SizeSection node={node} />
      <PaddingSection node={node} />
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
        <span className={cn(node.type === "instance" && "text-brand")}>
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

const presets: { value: ViewportPreset; label: string }[] = [
  { label: "Mobile", value: "mobile" },
  { label: "Tablet", value: "tablet" },
  { label: "Desktop", value: "desktop" },
  { label: "Custom", value: "custom" },
];

const PageSection = ({ frame }: { frame: string }) => {
  const layout = useEditor((s) => s.frames[frame]);
  const page = useProject((s) => s.pages.find((p) => p.id === frame));
  if (!(layout && page)) {
    return null;
  }
  return (
    <Section title="Page">
      <Row label="Route">
        <span className="truncate font-mono text-[11px]">{page.route}</span>
      </Row>
      <Row label="Viewport">
        <OptionSelect
          onChange={(v) =>
            useEditor.getState().setPreset(frame, v as ViewportPreset)
          }
          options={presets}
          size="sm"
          value={layout.preset}
        />
      </Row>
      <Row label="Frame">
        <span className="text-[11px] text-muted-foreground">
          {Math.round(layout.width)} × {Math.round(layout.height)}
        </span>
      </Row>
      <Button
        className="mt-1 justify-start"
        onClick={() => startCommand(`/implement ${page.route}`)}
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

const InstanceSection = ({ node }: { node: InstanceNode }) => (
  <>
    <Section title="Component">
      <Row label="Name">
        <span className="truncate font-medium text-brand">
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
}: {
  field: string;
  kind: TokenKind;
  value: JsonValue | undefined;
  placeholder?: string;
  numeric?: boolean;
}) => {
  const options = useTokenOptions(kind);
  return (
    <ValueField
      accept={(q) => !numeric || CSS.supports("width", q)}
      onChange={(v) => set(field, v)}
      options={options}
      placeholder={placeholder ?? "Default"}
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

const TextSection = ({ node }: { node: TextNode }) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const styles = ds?.typography.styles ?? [];
  const role = node.role === "heading" ? `h${node.level ?? 1}` : "p";
  const onRole = (v: string) =>
    updateSelection(
      v === "p"
        ? { level: null, role: "paragraph" }
        : { level: Number(v.slice(1)), role: "heading" },
      "Change the text's role"
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
      <Row label="Style">
        <OptionSelect
          onChange={(v) => set("textStyle", v === "" ? null : v)}
          options={[
            { label: "None", value: "" },
            ...styles.map((s) => ({ label: s.name, value: s.name })),
          ]}
          placeholder={styles.length === 0 ? "No text styles" : "None"}
          size="sm"
          value={node.textStyle ?? ""}
        />
      </Row>
      <Row label="Size">
        <TokenField field="size" kind="size" value={node.size} />
      </Row>
      <Row label="Weight">
        <TokenField field="weight" kind="weight" value={node.weight} />
      </Row>
      <Row label="Font">
        <TokenField
          field="font"
          kind="font"
          numeric={false}
          value={node.font}
        />
      </Row>
      <Row label="Line">
        <TokenField field="lineHeight" kind="leading" value={node.lineHeight} />
      </Row>
      <Row label="Tracking">
        <TokenField field="tracking" kind="tracking" value={node.tracking} />
      </Row>
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
  const space = useEditor((s) => s.space);
  const upload = async (file: File | undefined) => {
    if (!file || space === null) {
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
        space,
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

const SizeSection = ({ node }: { node: DesignNode }) => (
  <Section title="Size">
    <Row label="Size">
      <SizeField field="width" value={node.width} />
      <SizeField field="height" value={node.height} />
    </Row>
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

// ---- Padding ----

const sidesOf = (padding: Padding | undefined): Sides => {
  if (padding === undefined) {
    return {};
  }
  return typeof padding === "object"
    ? padding
    : { bottom: padding, left: padding, right: padding, top: padding };
};

/** The padding for these sides: none, one value when all four agree, else the sides. */
const paddingOf = (sides: Record<string, JsonValue>): JsonValue => {
  if (Object.keys(sides).length === 0) {
    return null;
  }
  const values = ["top", "right", "bottom", "left"].map((k) => sides[k]);
  const same = values.every((v) => v !== undefined && v === values[0]);
  return same ? (values[0] as JsonValue) : sides;
};

const PaddingSection = ({ node }: { node: DesignNode }) => {
  const spacing = useTokenOptions("spacing");
  const sides = sidesOf(node.padding);
  const onSide = (key: keyof Sides) => (value: JsonValue) => {
    const next: Record<string, JsonValue> = { ...sides };
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    set("padding", paddingOf(next));
  };
  const side = (key: keyof Sides, short: string) => (
    <ValueField
      leading={<span className="w-2.5">{short}</span>}
      onChange={onSide(key)}
      options={spacing}
      placeholder="0"
      value={sides[key]}
    />
  );
  return (
    <Section title="Padding">
      <Row label="">
        {side("top", "T")}
        {side("right", "R")}
      </Row>
      <Row label="">
        {side("bottom", "B")}
        {side("left", "L")}
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
  const space = useEditor((s) => s.space);
  const pages = useProject((s) => s.pages);
  const routes = Array.from(
    new Set(pages.filter((p) => p.space === space).map((p) => p.route))
  ).sort();
  return (
    <Section title="Prototype">
      <Row label="Goes to">
        <OptionSelect
          onChange={(v) => set("link", v === "" ? null : v)}
          options={[
            { label: "Nowhere", value: "" },
            ...routes.map((r) => ({ label: r, value: r })),
          ]}
          size="sm"
          value={node.link ?? ""}
        />
      </Row>
    </Section>
  );
};
