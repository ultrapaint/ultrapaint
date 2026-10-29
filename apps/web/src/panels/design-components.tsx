/**
 * The Design system panel's Components tab (ADRs 0040, 0041): every system component, in its
 * default look or in the project's, and every app component. Opening a system component shows its
 * look as a live matrix of its variants and states, drawn by the preview with the component
 * itself, and the fields of one part in the base, a variant or a state. Taking its look over starts
 * the project's file from its default, so the fields hold real values; resetting it removes the
 * file. Opening an app component shows it drawn, its properties and its slots.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import {
  APP_FROM,
  type AppComponentFile,
  COMPONENT_STATES,
  type ComponentChange,
  type ComponentFile,
  type ComponentState,
  type PartStyle,
  ROOT_SLOT,
  SYSTEM_FROM,
  type SystemComponentFile,
  type SystemLook,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { componentTarget } from "@ultrapaint/contracts/implementation";
import { presetSize } from "@ultrapaint/contracts/pages";
import { STATE_ATTRIBUTE } from "@ultrapaint/design-document/component-look";
import { systemComponentOf } from "@ultrapaint/system-components/catalogue";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { designCss } from "@ultrapaint/system-components/look";
import { ArrowLeft, Code2, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useFrameDrawing } from "../canvas/editor-frame.ts";
import { PreviewSurface } from "../canvas/preview-surface.tsx";
import { confirmDialog } from "../components/dialogs.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { ValueField } from "../components/value-field.tsx";
import { allSelected, nodesOf } from "../lib/node-actions.ts";
import { startTask } from "../lib/start-thread.ts";
import {
  type FieldTokenKind,
  Swatch,
  useColorOf,
  useTokenOptions,
} from "../lib/token-options.tsx";
import { useComponents } from "../state/components.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { statusLabel, useImplementation } from "../state/implementation.ts";
import { useDesignLook } from "../state/look.ts";
import { reportError } from "../state/project.ts";

/** A component as the tab lists it: a system component, with its file when it has one, or an app component's. */
type Listed =
  | {
      readonly file?: SystemComponentFile;
      readonly meta?: ComponentMeta;
      readonly name: string;
      readonly origin: "system";
    }
  | {
      readonly file: AppComponentFile;
      readonly name: string;
      readonly origin: "app";
    };

const listedOf = (
  catalogue: readonly ComponentMeta[],
  files: readonly ComponentFile[]
): Listed[] => {
  const byName = new Map<string, Listed>();
  for (const meta of catalogue) {
    byName.set(meta.name, { meta, name: meta.name, origin: "system" });
  }
  for (const file of files) {
    const known = byName.get(file.name);
    byName.set(
      file.name,
      file.origin === "app"
        ? { file, name: file.name, origin: "app" }
        : {
            file,
            name: file.name,
            origin: "system",
            ...(known?.origin === "system" &&
              known.meta && { meta: known.meta }),
          }
    );
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

/** Whose look a component is drawn in, or that it is the project's own. */
const lookLabel = (listed: Listed) => {
  if (listed.origin === "app") {
    return "app";
  }
  return listed.file ? "your look" : "default look";
};

/**
 * Changes a component's file on the server, on the file as it is there, so a change made meanwhile
 * stays; what the server refuses is said. True when it went through.
 */
const change = async (name: string, made: ComponentChange) => {
  try {
    await api().request("components.change", { change: made, name });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

/** A system component's look: its file but the envelope. */
const lookOf = (file: SystemComponentFile): SystemLook => ({
  base: file.base,
  ...(file.content && { content: file.content }),
  ...(file.hidden && { hidden: file.hidden }),
  ...(file.item && { item: file.item }),
  states: file.states,
  variants: file.variants,
});

/** A system component's parts, the root first, as the catalogue names them. */
const partsOf = (name: string) =>
  systemComponentOf(name)?.slots.map((s) => ({
    label: s.label,
    name: s.name,
  })) ?? [{ label: "The component", name: ROOT_SLOT }];

/** Where a field of a look is set: the base, a variant's member, or a state, and which part. */
type Place =
  | { readonly kind: "base" }
  | { readonly axis: string; readonly kind: "variant"; readonly member: string }
  | { readonly kind: "state"; readonly state: ComponentState };

const styleAt = (
  spec: SystemComponentFile,
  place: Place,
  slot: string
): PartStyle => {
  if (place.kind === "base") {
    return spec.base[slot] ?? {};
  }
  if (place.kind === "variant") {
    return spec.variants[place.axis]?.[place.member]?.[slot] ?? {};
  }
  return spec.states[place.state]?.[slot] ?? {};
};

/** The look with one part's style at a place replaced; empty styles are taken out. */
const withStyle = (
  spec: SystemComponentFile,
  place: Place,
  slot: string,
  style: PartStyle
): SystemComponentFile => {
  const empty = Object.keys(style).length === 0;
  const slots = (current: Readonly<Record<string, PartStyle>> | undefined) => {
    const { [slot]: _old, ...rest } = current ?? {};
    return empty ? rest : { ...rest, [slot]: style };
  };
  if (place.kind === "base") {
    return { ...spec, base: slots(spec.base) };
  }
  if (place.kind === "variant") {
    const axis = spec.variants[place.axis] ?? {};
    return {
      ...spec,
      variants: {
        ...spec.variants,
        [place.axis]: { ...axis, [place.member]: slots(axis[place.member]) },
      },
    };
  }
  return {
    ...spec,
    states: { ...spec.states, [place.state]: slots(spec.states[place.state]) },
  };
};

const placeKey = (place: Place) => {
  if (place.kind === "base") {
    return "base";
  }
  return place.kind === "variant"
    ? `variant:${place.axis}:${place.member}`
    : `state:${place.state}`;
};

const placeOf = (key: string): Place => {
  const [kind, a = "", b = ""] = key.split(":");
  if (kind === "variant") {
    return { axis: a, kind: "variant", member: b };
  }
  if (kind === "state") {
    return { kind: "state", state: a as ComponentState };
  }
  return { kind: "base" };
};

/** The axes and members a look is drawn in: the catalogue's, and its own besides. */
const axesOf = (spec: SystemComponentFile, meta: ComponentMeta | undefined) => {
  const axes: Record<string, string[]> = {};
  for (const [axis, members] of Object.entries(meta?.variants ?? {})) {
    axes[axis] = [...members];
  }
  for (const [axis, members] of Object.entries(spec.variants)) {
    axes[axis] = [...new Set([...(axes[axis] ?? []), ...Object.keys(members)])];
  }
  return axes;
};

/**
 * The matrix the preview draws: a row per member of the first axis (the default alone when there
 * is none), a column for the base and each state, every cell the real component pinned in it. An
 * app component is drawn once, as an instance with its properties' defaults.
 */
const matrixOf = (
  component: ComponentFile,
  meta: ComponentMeta | undefined,
  pageWidth: number
): DesignNode => {
  if (component.origin === "app") {
    // At its own width when it has one, else as wide as a page: a header that fills a page is
    // not squeezed into the panel, the picture is scaled down to it instead.
    const { width } = component.tree;
    return {
      children: [
        {
          component: component.name,
          from: APP_FROM,
          id: "cell-app",
          type: "instance",
        },
      ],
      id: "matrix",
      padding: 12,
      type: "column",
      width: typeof width === "number" ? width + 24 : pageWidth,
    };
  }
  const axes = axesOf(component, meta);
  const [axis] = Object.keys(axes);
  const members = axis ? (axes[axis] ?? []) : [];
  const states: (ComponentState | null)[] = [
    null,
    ...COMPONENT_STATES.filter(
      (s) =>
        component.states[s] !== undefined ||
        ["hover", "focus", "disabled"].includes(s)
    ),
  ];
  const rows = (members.length > 0 ? members : [null]).map(
    (member, r): DesignNode => ({
      children: states.map(
        (state, c): DesignNode => ({
          component: component.name,
          from: SYSTEM_FROM,
          id: `cell-${r}-${c}`,
          props: {
            ...(axis && member ? { [axis]: member } : {}),
            ...(state ? { [STATE_ATTRIBUTE]: state } : {}),
            ...(state === "disabled" ? { disabled: true } : {}),
          },
          text: component.name,
          type: "instance",
        })
      ),
      crossAlign: "center",
      gap: 8,
      id: `row-${r}`,
      type: "row",
      // The panel is narrow: a row of many states goes on below.
      wrap: true,
    })
  );
  return {
    children: rows,
    gap: 12,
    id: "matrix",
    padding: 12,
    type: "column",
    width: "fill",
  };
};

/** How wide a page is drawn: the selected page's frame, else the canvas's widest, else a desktop's. */
const usePageWidth = () =>
  useEditor((s) => {
    const selected = s.selectedPage ? s.frames[s.selectedPage] : undefined;
    const widths = Object.values(s.frames).map((f) => f.width);
    return (
      selected?.width ??
      (widths.length > 0 ? Math.max(...widths) : presetSize.desktop.width)
    );
  });

/**
 * A frame drawn at its own size and scaled down to the panel's width, never up: what is drawn as
 * wide as a page is seen whole.
 */
const ScaledPicture = ({ frame, title }: { frame: string; title: string }) => {
  const [size, setSize] = useState<{ height: number; width: number } | null>(
    null
  );
  const [room, setRoom] = useState(0);
  const outer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(() => setRoom(el.clientWidth));
    observer.observe(el);
    setRoom(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  const listeners = useMemo(() => ({ size: setSize }), []);
  const scale =
    size && room > 0 && size.width > 0 ? Math.min(1, room / size.width) : 1;
  return (
    <div
      className="shrink-0 overflow-hidden rounded-md border bg-white"
      ref={outer}
      style={size ? { height: Math.ceil(size.height * scale) } : undefined}
    >
      <PreviewSurface
        frameId={frame}
        hostClassName="block"
        listeners={listeners}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: size?.width,
        }}
        title={title}
      />
    </div>
  );
};

/** A component drawn live, with the edits not saved yet. */
export const Matrix = ({
  component,
  meta,
}: {
  component: ComponentFile;
  meta: ComponentMeta | undefined;
}) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const { components } = useDesignLook();
  const pageWidth = usePageWidth();
  const frame = "design-system:components";
  // The file being edited stands in for the saved one, in a look of the matrix's own: the
  // canvas's frames keep the saved look (ADR 0042).
  const look = useMemo(() => {
    const edited = [
      ...components.filter((c) => c.name !== component.name),
      component,
    ];
    return { components: edited, css: designCss(edited, ds) };
  }, [components, component, ds]);
  useFrameDrawing(
    frame,
    useMemo(
      () => ({
        designSystem: ds,
        look,
        mode: "fit" as const,
        root: matrixOf(component, meta, pageWidth),
      }),
      [ds, meta, component, look, pageWidth]
    )
  );
  if (component.origin === "app") {
    return (
      <ScaledPicture
        frame={frame}
        title={`${component.name} as an instance draws it`}
      />
    );
  }
  return (
    // A look with many fields and notes overflows the panel: the matrix keeps its height.
    <div className="shrink-0 overflow-hidden rounded-md border bg-white">
      <PreviewSurface
        className="w-full"
        frameId={frame}
        hostClassName="block w-full"
        title={`${component.name} in its variants and states`}
      />
    </div>
  );
};

/** One style field of a slot, over the design system's tokens. */
const Field = ({
  kind,
  label,
  onChange,
  value,
}: {
  kind: FieldTokenKind | "opacity";
  label: string;
  onChange: (value: JsonValue) => void;
  value: JsonValue | undefined;
}) => {
  const options = useTokenOptions(kind === "opacity" ? "spacing" : kind);
  const color = useColorOf(value);
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <span className="truncate text-muted-foreground">{label}</span>
      <ValueField
        {...(kind === "color" && {
          accept: (q: string) => CSS.supports("color", q),
          leading: <Swatch color={color} />,
        })}
        onChange={onChange}
        options={kind === "opacity" ? [] : options}
        placeholder="Not set"
        title={label}
        value={value}
      />
    </div>
  );
};

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];

/** One side's padding: its own, or what every side has. */
const sideOf = (padding: PartStyle["padding"], side: Side) =>
  typeof padding === "object" ? padding[side] : padding;

/** The style with one side's padding set (`null` takes it off), the others kept as they are. */
const withSide = (
  style: PartStyle,
  side: Side,
  value: JsonValue
): PartStyle => {
  const { padding, ...rest } = style;
  const kept = Object.fromEntries(
    SIDES.flatMap((s) => {
      const v = s === side ? undefined : sideOf(padding, s);
      return v === undefined ? [] : [[s, v]];
    })
  );
  const given =
    (typeof value === "string" && value !== "") || typeof value === "number";
  const sides = given ? { ...kept, [side]: value } : kept;
  return Object.keys(sides).length === 0
    ? rest
    : ({ ...rest, padding: sides } as PartStyle);
};

/** One field of a part that takes one of a few words. */
const Choice = ({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: JsonValue) => void;
  options: readonly string[];
  value: string | undefined;
}) => (
  <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
    <span className="truncate text-muted-foreground">{label}</span>
    <NativeSelect
      aria-label={label}
      className="w-full"
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      size="sm"
      value={value ?? ""}
    >
      <NativeSelectOption value="">Not set</NativeSelectOption>
      {options.map((o) => (
        <NativeSelectOption key={o} value={o}>
          {o}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  </div>
);

/** The fields of one part at one place. */
const SlotFields = ({
  onChange,
  style,
}: {
  onChange: (style: PartStyle) => void;
  style: PartStyle;
}) => {
  const set = (key: keyof PartStyle) => (value: JsonValue) => {
    const { [key]: _old, ...rest } = style;
    onChange(
      value === null || value === ""
        ? rest
        : ({ ...rest, [key]: value } as PartStyle)
    );
  };
  const border = (key: "color" | "width") => (value: JsonValue) => {
    const { [key]: _old, ...rest } = style.border ?? {};
    const next =
      value === null || value === "" ? rest : { ...rest, [key]: value };
    const { border: _border, ...others } = style;
    onChange(
      (Object.keys(next).length === 0
        ? others
        : { ...others, border: next }) as PartStyle
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Field
        kind="color"
        label="Fill"
        onChange={set("fill")}
        value={style.fill}
      />
      <Field
        kind="color"
        label="Text"
        onChange={set("color")}
        value={style.color}
      />
      <Field
        kind="color"
        label="Border"
        onChange={border("color")}
        value={style.border?.color}
      />
      <Field
        kind="borderWidth"
        label="Border width"
        onChange={border("width")}
        value={style.border?.width}
      />
      <Field
        kind="radius"
        label="Radius"
        onChange={set("radius")}
        value={style.radius}
      />
      <Field
        kind="spacing"
        label="Padding"
        onChange={set("padding")}
        value={typeof style.padding === "object" ? undefined : style.padding}
      />
      {SIDES.map((side) => (
        <Field
          key={side}
          kind="spacing"
          label={`Padding ${side}`}
          onChange={(value) => onChange(withSide(style, side, value))}
          value={sideOf(style.padding, side)}
        />
      ))}
      <Choice
        label="Direction"
        onChange={set("direction")}
        options={["row", "column"]}
        value={style.direction}
      />
      <Choice
        label="Align"
        onChange={set("align")}
        options={["start", "center", "end", "between", "around"]}
        value={style.align}
      />
      <Choice
        label="Cross align"
        onChange={set("crossAlign")}
        options={["start", "center", "end", "stretch", "baseline"]}
        value={style.crossAlign}
      />
      <Field
        kind="opacity"
        label="Order"
        onChange={(v) =>
          set("order")(typeof v === "string" && v !== "" ? Number(v) : v)
        }
        value={style.order}
      />
      <Field
        kind="spacing"
        label="Height"
        onChange={set("height")}
        value={style.height}
      />
      <Field
        kind="spacing"
        label="Gap"
        onChange={set("gap")}
        value={style.gap}
      />
      <Field
        kind="fontSize"
        label="Text size"
        onChange={set("fontSize")}
        value={style.fontSize}
      />
      <Field
        kind="fontWeight"
        label="Weight"
        onChange={set("fontWeight")}
        value={style.fontWeight}
      />
      <Field
        kind="shadow"
        label="Shadow"
        onChange={set("shadow")}
        value={style.shadow}
      />
      <Field
        kind="opacity"
        label="Opacity"
        onChange={(v) =>
          set("opacity")(
            typeof v === "number" ? Math.min(1, Math.max(0, v)) : v
          )
        }
        value={style.opacity}
      />
    </div>
  );
};

/** The nodes selected on the canvas, copied without the slot each fills: what a look can take. */
const selectedNodes = (): DesignNode[] =>
  nodesOf(allSelected()).map(
    ({ node: { slot: _slot, ...node } }) => node as DesignNode
  );

/** The first node of a tree of a type, by id. */
const firstOf = (
  node: DesignNode,
  type: DesignNode["type"]
): string | undefined => {
  if (node.type === type) {
    return node.id;
  }
  for (const child of "children" in node ? (node.children ?? []) : []) {
    const found = firstOf(child, type);
    if (found) {
      return found;
    }
  }
  return undefined;
};

/**
 * What a look says beyond its parts' style (ADR 0041): the optional parts it shows, what each slot
 * holds when an instance gives it nothing, and what a Select's or a Menu's item draws. Content and
 * templates are taken from the selection on the canvas.
 */
const LookExtras = ({
  file,
  onChange,
}: {
  file: SystemComponentFile;
  onChange: (file: SystemComponentFile) => void;
}) => {
  const meta = systemComponentOf(file.name);
  if (!meta) {
    return null;
  }
  const optional = meta.slots.filter((s) => s.optional);
  const holding = meta.slots.filter((s) => s.holds !== undefined);
  const hidden = new Set(file.hidden ?? []);
  const show = (part: string, shown: boolean) => {
    const next = shown
      ? [...hidden].filter((p) => p !== part)
      : [...hidden, part];
    const { hidden: _old, ...rest } = file;
    onChange(next.length === 0 ? rest : { ...rest, hidden: next });
  };
  const setContent = (slot: string, nodes: readonly DesignNode[]) => {
    const { [slot]: _old, ...others } = file.content ?? {};
    const content = nodes.length === 0 ? others : { ...others, [slot]: nodes };
    const { content: _content, ...rest } = file;
    onChange(Object.keys(content).length === 0 ? rest : { ...rest, content });
  };
  const setItem = (tree: DesignNode | null) => {
    const { item: _old, ...rest } = file;
    if (!tree) {
      onChange(rest);
      return;
    }
    const label = firstOf(tree, "text");
    const image = firstOf(tree, "image");
    onChange({
      ...rest,
      item: {
        tree,
        ...(label !== undefined && { label }),
        ...(image !== undefined && { image }),
      },
    });
  };
  const fromSelection = (use: (nodes: DesignNode[]) => void) => {
    const nodes = selectedNodes();
    if (nodes.length === 0) {
      toast.message("Select the nodes on the canvas first.");
      return;
    }
    use(nodes);
  };
  return (
    <div className="flex flex-col gap-3">
      {optional.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="font-medium">Optional parts</span>
          {optional.map((part) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is Base UI's button
            <label className="flex items-center gap-2" key={part.name}>
              <Checkbox
                checked={!hidden.has(part.name)}
                onCheckedChange={(shown) => show(part.name, shown)}
              />
              {part.label}
            </label>
          ))}
        </div>
      ) : null}
      {holding.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="font-medium">Content when empty</span>
          {holding.map((slot) => {
            const held = file.content?.[slot.name] ?? [];
            return (
              <div className="flex items-center gap-1.5" key={slot.name}>
                <span className="min-w-0 flex-1 truncate">
                  {slot.label}{" "}
                  <span className="text-muted-foreground">
                    {held.length === 0
                      ? "nothing"
                      : `${held.length} node${held.length === 1 ? "" : "s"}`}
                  </span>
                </span>
                <Button
                  onClick={() =>
                    fromSelection((nodes) => setContent(slot.name, nodes))
                  }
                  size="xs"
                  variant="outline"
                >
                  Use selection
                </Button>
                {held.length > 0 ? (
                  <Button
                    aria-label={`Clear what ${slot.label} holds`}
                    onClick={() => setContent(slot.name, [])}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {meta.templatedItems ? (
        <div className="flex flex-col gap-1">
          <span className="font-medium">Item</span>
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {file.item
                ? "Drawn from your nodes: the first text is the label, the first image its picture."
                : "Its label alone."}
            </span>
            <Button
              onClick={() =>
                fromSelection(([first, ...more]) =>
                  setItem(
                    more.length === 0 && first
                      ? first
                      : ({
                          children: [first, ...more],
                          crossAlign: "center",
                          gap: 8,
                          id: "item",
                          type: "row",
                        } as DesignNode)
                  )
                )
              }
              size="xs"
              variant="outline"
            >
              Use selection
            </Button>
            {file.item ? (
              <Button
                aria-label="Draw items by their label alone"
                onClick={() => setItem(null)}
                size="icon-xs"
                variant="ghost"
              >
                <X />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * The component's behaviour notes (ADR 0030): what its code must do that the design cannot show,
 * about one part or the whole of it. They go with the component to `/implement`. Added and taken
 * out on the server, on the file as it is there, so a look being edited is not saved with them.
 */
const Notes = ({
  component,
  dirty,
  parts,
}: {
  component: ComponentFile;
  dirty: boolean;
  parts: readonly { readonly label?: string; readonly name: string }[];
}) => {
  const [text, setText] = useState("");
  const [slot, setSlot] = useState(ROOT_SLOT);
  const notes = component.notes ?? [];
  const add = async () => {
    if (text.trim() === "") {
      return;
    }
    try {
      await api().request("components.addNote", {
        name: component.name,
        ...(slot !== ROOT_SLOT && { slot }),
        text: text.trim(),
      });
      setText("");
    } catch (error) {
      reportError(error);
    }
  };
  const remove = (id: string) =>
    change(component.name, { id, op: "removeNote" });
  const partOf = (name: string | undefined) =>
    parts.find((s) => s.name === name)?.label ?? name;
  const choices = [
    { label: "The component", name: ROOT_SLOT },
    ...parts.filter((p) => p.name !== ROOT_SLOT),
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium">Behaviour</span>
      {notes.length === 0 ? (
        <p className="text-muted-foreground">
          What the code must do that the design cannot show: it goes to the code
          when the component is implemented.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {notes.map((n) => (
            <li className="flex items-start gap-1.5" key={n.id}>
              <span className="min-w-0 flex-1">
                {n.slot ? (
                  <span className="text-muted-foreground">
                    {partOf(n.slot)}:{" "}
                  </span>
                ) : null}
                {n.text}
              </span>
              <Button
                aria-label="Take the note out"
                disabled={dirty}
                onClick={() => remove(n.id)}
                size="icon-xs"
                variant="ghost"
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        {choices.length > 1 ? (
          <NativeSelect
            aria-label="About"
            className="w-28"
            onChange={(e) => setSlot(e.target.value)}
            size="sm"
            value={slot}
          >
            {choices.map((s) => (
              <NativeSelectOption key={s.name} value={s.name}>
                {s.label ?? s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        <Input
          aria-label="A behaviour note"
          className="h-7 min-w-0 flex-1"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              add();
            }
          }}
          placeholder="Closes on Escape and gives the focus back"
          value={text}
        />
        <Button
          disabled={dirty || text.trim() === ""}
          onClick={add}
          size="sm"
          title={dirty ? "Save or discard the look's changes first" : undefined}
          variant="outline"
        >
          Note
        </Button>
      </div>
    </div>
  );
};

/** The detail's header: back, the component's name, and where its implementation stands. */
const DetailHeader = ({
  name,
  onBack,
}: {
  name: string;
  onBack: () => void;
}) => {
  const item = useImplementation((s) => s.byTarget[componentTarget(name)]);
  return (
    <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
      <Button onClick={onBack} size="icon-sm" variant="ghost">
        <ArrowLeft />
      </Button>
      <span className="truncate font-medium">{name}</span>
      {item && item.status !== "draft" ? (
        <span className="ml-auto truncate font-body text-muted-foreground">
          {statusLabel(item)}
        </span>
      ) : null}
    </div>
  );
};

const ImplementButton = ({ name }: { name: string }) => (
  <Button
    className="ml-auto"
    onClick={() => startTask({ _tag: "Implement", target: name })}
    size="sm"
    variant="outline"
  >
    <Code2 />
    Implement
  </Button>
);

/** Removes a component's file, once confirmed. */
const removeComponent = async (
  name: string,
  confirm: { confirmLabel: string; description: string; title: string },
  done: () => void
) => {
  if (!(await confirmDialog(confirm))) {
    return;
  }
  try {
    await api().request("components.remove", { name });
    done();
  } catch (error) {
    reportError(error);
  }
};

const SystemDetail = ({
  file: saved,
  meta,
  name,
  onBack,
}: {
  file: SystemComponentFile | undefined;
  meta: ComponentMeta | undefined;
  name: string;
  onBack: () => void;
}) => {
  // Edits not saved yet, on the file as the server had it: one from the server since replaces them.
  const [edits, setEdits] = useState<{
    readonly from: SystemComponentFile | undefined;
    readonly file: SystemComponentFile | undefined;
  } | null>(null);
  const file = edits && edits.from === saved ? edits.file : saved;
  const setFile = (next: SystemComponentFile | undefined) =>
    setEdits({ file: next, from: saved });
  const [placeKeyed, setPlace] = useState("base");
  const [slot, setSlot] = useState(ROOT_SLOT);
  const parts = partsOf(name);

  const takeOver = async () => {
    try {
      const entry = await api().request("components.fromDefault", { name });
      if (entry.component?.origin === "system") {
        setFile(entry.component);
      }
    } catch (error) {
      reportError(error);
    }
  };

  const header = <DetailHeader name={name} onBack={onBack} />;
  const fallback = defaultLookOf(name);
  if (!file) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 font-body">
          {fallback ? <Matrix component={fallback} meta={meta} /> : null}
          <p className="text-muted-foreground">
            {name} is drawn in its default look, over your tokens. Take it over
            to change any part of it here; implementing gives your application's
            own {name} the look.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button disabled={!fallback} onClick={takeOver} size="sm">
              Take the look over
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const place = placeOf(placeKeyed);
  const axes = axesOf(file, meta);
  const places: { label: string; value: string }[] = [
    { label: "Base", value: "base" },
    ...Object.entries(axes).flatMap(([axis, members]) =>
      members.map((member) => ({
        label: `${axis}: ${member}`,
        value: placeKey({ axis, kind: "variant", member }),
      }))
    ),
    ...COMPONENT_STATES.map((state) => ({
      label: `State: ${state}`,
      value: placeKey({ kind: "state", state }),
    })),
  ];
  const dirty = JSON.stringify(file) !== JSON.stringify(saved);

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 font-body">
        <div className="flex items-center gap-2">
          <ImplementButton name={name} />
          <Button
            onClick={() =>
              removeComponent(
                name,
                {
                  confirmLabel: "Reset",
                  description: `${name} is drawn in its default look again; its behaviour notes go with its file.`,
                  title: `Reset ${name} to its default look?`,
                },
                onBack
              )
            }
            size="sm"
            variant="ghost"
          >
            <RotateCcw />
            Reset to default
          </Button>
        </div>
        <Matrix component={file} meta={meta} />

        <div className="grid grid-cols-2 gap-1.5">
          <NativeSelect
            aria-label="Where"
            onChange={(e) => setPlace(e.target.value)}
            size="sm"
            value={placeKeyed}
          >
            {places.map((p) => (
              <NativeSelectOption key={p.value} value={p.value}>
                {p.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Part"
            onChange={(e) => setSlot(e.target.value)}
            size="sm"
            value={slot}
          >
            {parts.map((s) => (
              <NativeSelectOption key={s.name} value={s.name}>
                {s.name === ROOT_SLOT ? "The component" : s.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <SlotFields
          onChange={(style) => setFile(withStyle(file, place, slot, style))}
          style={styleAt(file, place, slot)}
        />
        <LookExtras file={file} onChange={setFile} />
        <div className="flex gap-1.5">
          <Button
            disabled={!dirty}
            onClick={async () => {
              if (await change(name, { look: lookOf(file), op: "setLook" })) {
                toast.success(
                  `${name}'s look is saved: implement it to bring the code along.`
                );
              }
            }}
            size="sm"
          >
            Save
          </Button>
          <Button
            disabled={!dirty}
            onClick={() => setFile(saved)}
            size="sm"
            variant="ghost"
          >
            Discard
          </Button>
        </div>

        {saved ? <Notes component={saved} dirty={dirty} parts={parts} /> : null}
      </div>
    </div>
  );
};

/** What a property is, in a few words. */
const propertyLine = (p: AppComponentFile["properties"][number]) => {
  const kind =
    p.kind === "choice" ? `one of ${(p.members ?? []).join(", ")}` : p.kind;
  return `${kind}, ${JSON.stringify(p.default)} when not set`;
};

const AppDetail = ({
  file,
  onBack,
}: {
  file: AppComponentFile;
  onBack: () => void;
}) => (
  <div className="flex h-full flex-col">
    <DetailHeader name={file.name} onBack={onBack} />
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 font-body">
      <div className="flex items-center gap-2">
        <Badge variant="outline">Your own component</Badge>
        <ImplementButton name={file.name} />
        <Button
          aria-label="Delete the component"
          onClick={() =>
            removeComponent(
              file.name,
              {
                confirmLabel: "Delete",
                description: `Its tree goes with it; pages that use ${file.name} show it missing.`,
                title: `Delete the ${file.name} component?`,
              },
              onBack
            )
          }
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </div>
      <Matrix component={file} meta={undefined} />
      {file.description ? (
        <p className="text-muted-foreground">{file.description}</p>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="font-medium">Properties</span>
        {file.properties.length === 0 ? (
          <p className="text-muted-foreground">
            None: every instance draws the same. Edit the component on a page to
            expose a field of it as a property.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {file.properties.map((p) => (
              <li key={p.name}>
                {p.name}{" "}
                <span className="text-muted-foreground">{propertyLine(p)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {file.slots.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="font-medium">Slots</span>
          <ul className="flex flex-col gap-0.5">
            {file.slots.map((s) => (
              <li key={s.name}>
                {s.label ?? s.name}
                {s.default ? (
                  <span className="text-muted-foreground"> (default)</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Notes
        component={file}
        dirty={false}
        parts={file.slots.map((s) => ({
          label: s.label ?? s.name,
          name: s.name,
        }))}
      />
    </div>
  </div>
);

export const ComponentsView = ({ q }: { q: string }) => {
  // The system components the editor has; the app components are the files'.
  const catalogue = useComponents((s) => s.catalogue).filter(
    (c) => c.importFrom === SYSTEM_FROM
  );
  const files = useComponents((s) => s.components);
  const entries = useComponents((s) => s.entries);
  const problems = entries.filter((e) => e.problem !== undefined);
  const byTarget = useImplementation((s) => s.byTarget);
  const [open, setOpen] = useState<string | null>(null);
  const listed = listedOf(catalogue, files).filter(
    (l) => !q || l.name.toLowerCase().includes(q)
  );
  const opened = open ? listed.find((l) => l.name === open) : undefined;

  useEffect(() => {
    useImplementation.getState().load();
  }, []);

  if (opened) {
    return opened.origin === "app" ? (
      <AppDetail file={opened.file} onBack={() => setOpen(null)} />
    ) : (
      <SystemDetail
        file={opened.file}
        meta={opened.meta}
        name={opened.name}
        onBack={() => setOpen(null)}
      />
    );
  }
  if (listed.length === 0) {
    return <PanelEmpty>No components to show.</PanelEmpty>;
  }
  return (
    <div className="flex flex-col font-body">
      {problems.map((p) => (
        <p className="border-b px-3 py-1.5 text-destructive" key={p.file}>
          {p.file}: {p.problem}
        </p>
      ))}
      <ul className="flex flex-col">
        {listed.map((l) => {
          const look = lookLabel(l);
          const item = byTarget[componentTarget(l.name)];
          return (
            <li key={l.name}>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
                onClick={() => setOpen(l.name)}
                type="button"
              >
                <span className="truncate">{l.name}</span>
                <span className="truncate text-muted-foreground">
                  {l.origin === "app"
                    ? (l.file.category ?? "")
                    : (l.meta?.category ?? "")}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {item && item.status !== "draft" ? (
                    <span className="text-muted-foreground">
                      {statusLabel(item)}
                    </span>
                  ) : null}
                  <Badge
                    variant={look === "default look" ? "outline" : "default"}
                  >
                    {look}
                  </Badge>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
