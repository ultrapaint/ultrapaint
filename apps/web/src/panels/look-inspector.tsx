/**
 * A system component's look, edited on its board (ADRs 0040, 0044, 0045): the right panel while
 * its board is open. The cell picked on the board is the place edited, a member of a variant axis
 * in a state, which the Variant and State selects change too; the part's fields there, each one
 * left empty showing what it takes and from where (`look-places`); the optional parts, what a slot
 * holds when empty and an item's template; where the component is used; its behaviour notes.
 *
 * Edits are live (B9): an option gone through or a value typed is drawn by every frame through the
 * look's draft (`state/look.ts`), and a field committed is one `setStyle`, one undo step. A
 * component still in its default look is taken over first, which starts its file from that
 * default; resetting it removes the file.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import {
  COMPONENT_STATES,
  type ComponentChange,
  type ComponentFile,
  type ComponentState,
  type LookPlace,
  type PartStyle,
  ROOT_SLOT,
  SYSTEM_FROM,
  type SystemComponentFile,
  type SystemLook,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  BASE,
  type Inherited,
  inheritedAt,
  styleAt,
} from "@ultrapaint/design-document/look-places";
import { systemComponentOf } from "@ultrapaint/system-components/catalogue";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { cn } from "cn";
import { Code2, Ellipsis, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { axesOf, rowAxisOf } from "../boards/library-boards.ts";
import { cellId, placeOfCell } from "../boards/pick.ts";
import { confirmDialog } from "../components/dialogs.tsx";
import { Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { displayOf, ValueField } from "../components/value-field.tsx";
import { componentUsesOf } from "../lib/component-uses.ts";
import { nodesOf } from "../lib/node-actions.ts";
import { startTask } from "../lib/start-thread.ts";
import {
  type FieldTokenKind,
  Swatch,
  useColorOf,
  useTokenOptions,
} from "../lib/token-options.tsx";
import { pickOf, pickOnBoard, useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { api } from "../state/connection.ts";
import { boardFrameOf } from "../state/frame-ref.ts";
import { commitStyle, draftStyle } from "../state/look.ts";
import { reportError } from "../state/project.ts";
import { UsesSection, usePagesRead } from "./token-inspector.tsx";

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
  ...(file.variantStates && { variantStates: file.variantStates }),
});

/** A system component's parts, the root first, as the catalogue names them. */
const partsOf = (name: string) =>
  systemComponentOf(name)?.slots.map((s) => ({
    label: s.label,
    name: s.name,
  })) ?? [{ label: "The component", name: ROOT_SLOT }];

/** Removes a component's file, once confirmed; true when it went. */
export const removeComponent = async (
  name: string,
  confirm: { confirmLabel: string; description: string; title: string }
) => {
  if (!(await confirmDialog(confirm))) {
    return false;
  }
  try {
    await api().request("components.remove", { name });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

/** Starts a system component's file from its default look, so the design edits real values. */
const takeOver = async (name: string) => {
  try {
    await api().request("components.fromDefault", { name });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

/** What a field left empty shows: the value it takes, and where from. */
const inheritedText = (inherited: Inherited | undefined) =>
  inherited ? `${String(inherited.value)} (${inherited.from})` : "Not set";

/** One style field of a part, over the design system's tokens. */
const Field = ({
  inherited,
  kind,
  label,
  onChange,
  onPreview,
  side = false,
  value,
}: {
  inherited?: Inherited | undefined;
  kind: FieldTokenKind | "opacity";
  label: string;
  /** One side of the padding, labelled by the side alone, set in under Padding. */
  side?: boolean;
  onChange: (value: JsonValue) => void;
  /** The value gone through or typed, drawn before it is committed; undefined once none is. */
  onPreview?: ((value: JsonValue | undefined) => void) | undefined;
  value: JsonValue | undefined;
}) => {
  const options = useTokenOptions(kind === "opacity" ? "spacing" : kind);
  const color = useColorOf(value ?? inherited?.value);
  const name = side ? `Padding ${label.toLowerCase()}` : label;
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <span
        className={cn(
          "truncate font-body text-muted-foreground",
          side && "pl-3"
        )}
      >
        {label}
      </span>
      <ValueField
        {...(kind === "color" && {
          accept: (q: string) => CSS.supports("color", q),
          leading: <Swatch color={color} />,
        })}
        {...(inherited && { hint: `from ${inherited.from}` })}
        onChange={onChange}
        {...(onPreview && { onPreview })}
        options={kind === "opacity" ? [] : options}
        placeholder={inherited ? displayOf(inherited.value) : "Not set"}
        title={
          inherited && value === undefined
            ? `${name}: ${inheritedText(inherited)}`
            : name
        }
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
  inherited,
  label,
  onChange,
  options,
  value,
}: {
  inherited?: Inherited | undefined;
  label: string;
  onChange: (value: JsonValue) => void;
  options: readonly string[];
  value: string | undefined;
}) => (
  <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
    <span className="truncate font-body text-muted-foreground">{label}</span>
    <NativeSelect
      aria-label={label}
      className="w-full"
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      size="sm"
      value={value ?? ""}
    >
      <NativeSelectOption value="">
        {inheritedText(inherited)}
      </NativeSelectOption>
      {options.map((o) => (
        <NativeSelectOption key={o} value={o}>
          {o}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  </div>
);

/** A style with one field set, or taken off when the value is empty. */
const withField = (
  style: PartStyle,
  key: keyof PartStyle,
  value: JsonValue
): PartStyle => {
  const { [key]: _old, ...rest } = style;
  return value === null || value === ""
    ? rest
    : ({ ...rest, [key]: value } as PartStyle);
};

/** A style with its border's colour or width set, or taken off. */
const withBorder = (
  style: PartStyle,
  key: "color" | "width",
  value: JsonValue
): PartStyle => {
  const { [key]: _old, ...rest } = style.border ?? {};
  const next =
    value === null || value === "" ? rest : { ...rest, [key]: value };
  const { border: _border, ...others } = style;
  return (
    Object.keys(next).length === 0 ? others : { ...others, border: next }
  ) as PartStyle;
};

/**
 * The fields of one part at one place, each left empty showing what it takes from where: its
 * look, its text, its layout. A value is committed with `onChange`; `onPreview`, when given, is
 * told the style a field would set while it is gone through (null once none is).
 */
const SlotFields = ({
  inherited,
  onChange,
  onPreview,
  style,
}: {
  inherited: Readonly<Record<string, Inherited>>;
  onChange: (style: PartStyle) => void;
  onPreview?: (style: PartStyle | null) => void;
  style: PartStyle;
}) => {
  /** A field's handlers, from what its value makes of the style. */
  const field = (make: (value: JsonValue) => PartStyle) => ({
    onChange: (value: JsonValue) => onChange(make(value)),
    onPreview:
      onPreview &&
      ((value: JsonValue | undefined) =>
        onPreview(value === undefined ? null : make(value))),
  });
  const set = (key: keyof PartStyle) =>
    field((value) => withField(style, key, value));
  const border = (key: "color" | "width") =>
    field((value) => withBorder(style, key, value));
  const number = (key: "opacity" | "order") =>
    field((value) => {
      const n =
        typeof value === "string" && value !== "" ? Number(value) : value;
      return withField(
        style,
        key,
        key === "opacity" && typeof n === "number"
          ? Math.min(1, Math.max(0, n))
          : n
      );
    });
  return (
    <div className="flex flex-col gap-1.5">
      <Field
        inherited={inherited.fill}
        kind="color"
        label="Fill"
        value={style.fill}
        {...set("fill")}
      />
      <Field
        inherited={inherited.color}
        kind="color"
        label="Text"
        value={style.color}
        {...set("color")}
      />
      <Field
        inherited={inherited["border.color"]}
        kind="color"
        label="Border"
        value={style.border?.color}
        {...border("color")}
      />
      <Field
        inherited={inherited["border.width"]}
        kind="borderWidth"
        label="Border width"
        value={style.border?.width}
        {...border("width")}
      />
      <Field
        inherited={inherited.radius}
        kind="radius"
        label="Radius"
        value={style.radius}
        {...set("radius")}
      />
      <Field
        inherited={inherited.shadow}
        kind="shadow"
        label="Shadow"
        value={style.shadow}
        {...set("shadow")}
      />
      <Field
        inherited={inherited.opacity}
        kind="opacity"
        label="Opacity"
        value={style.opacity}
        {...number("opacity")}
      />
      <Field
        inherited={inherited.fontSize}
        kind="fontSize"
        label="Text size"
        value={style.fontSize}
        {...set("fontSize")}
      />
      <Field
        inherited={inherited.fontWeight}
        kind="fontWeight"
        label="Weight"
        value={style.fontWeight}
        {...set("fontWeight")}
      />
      <span className="mt-1 font-heading-xsmall">Layout</span>
      <Choice
        inherited={inherited.direction}
        label="Direction"
        onChange={set("direction").onChange}
        options={["row", "column"]}
        value={style.direction}
      />
      <Choice
        inherited={inherited.align}
        label="Align"
        onChange={set("align").onChange}
        options={["start", "center", "end", "between", "around"]}
        value={style.align}
      />
      <Choice
        inherited={inherited.crossAlign}
        label="Cross align"
        onChange={set("crossAlign").onChange}
        options={["start", "center", "end", "stretch", "baseline"]}
        value={style.crossAlign}
      />
      <Field
        inherited={inherited.gap}
        kind="spacing"
        label="Gap"
        value={style.gap}
        {...set("gap")}
      />
      <Field
        inherited={inherited.padding}
        kind="spacing"
        label="Padding"
        value={typeof style.padding === "object" ? undefined : style.padding}
        {...set("padding")}
      />
      {SIDES.map((side) => (
        <Field
          inherited={inherited[`padding.${side}`]}
          key={side}
          kind="spacing"
          label={`${side[0]?.toUpperCase()}${side.slice(1)}`}
          // A side of the padding above: its label set in under Padding's, read whole.
          side
          value={sideOf(style.padding, side)}
          {...field((value) => withSide(style, side, value))}
        />
      ))}
      <Field
        inherited={inherited.height}
        kind="spacing"
        label="Height"
        value={style.height}
        {...set("height")}
      />
      <Field
        inherited={inherited.order}
        kind="opacity"
        label="Order"
        value={style.order}
        {...number("order")}
      />
    </div>
  );
};

/**
 * The nodes selected on the page the board view was opened from (or on the canvas, outside one),
 * copied without the slot each fills: what a look can take.
 */
const selectedNodes = (): DesignNode[] => {
  const left = useBoard.getState().left?.picked;
  const { also, selection } = left ?? { also: [], selection: null };
  return nodesOf(selection ? [selection, ...also] : []).map(
    ({ node: { slot: _slot, ...node } }) => node as DesignNode
  );
};

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
 * templates are taken from the nodes selected on the page.
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
      toast.message("Select the nodes on a page first.");
      return;
    }
    use(nodes);
  };
  return (
    <div className="flex flex-col gap-3 font-body">
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
 * out on the server, on the file as it is there.
 */
export const Notes = ({
  component,
  parts,
}: {
  component: ComponentFile;
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
    <div className="flex flex-col gap-1.5 font-body">
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
      {/* The part a note is about on a line of its own, so that neither it nor the note is cut. */}
      {choices.length > 1 ? (
        <NativeSelect
          aria-label="About"
          className="w-full"
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
      <div className="flex gap-1.5">
        <Input
          aria-label="A behaviour note"
          className="h-7 min-w-0 flex-1"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              add();
            }
          }}
          placeholder="Closes on Escape"
          value={text}
        />
        <Button
          disabled={text.trim() === ""}
          onClick={add}
          size="sm"
          variant="outline"
        >
          Note
        </Button>
      </div>
    </div>
  );
};

/** Where a component is used: the pages of the canvas open, and the app components placing it. */
export const ComponentUsedIn = ({
  from,
  name,
}: {
  from: string;
  name: string;
}) => {
  const pages = usePagesRead();
  const components = useComponents((s) => s.components);
  const uses = useMemo(
    () => componentUsesOf(name, from, { components, pages }),
    [name, from, components, pages]
  );
  return (
    <UsesSection
      count={(use) => (use.count > 1 ? String(use.count) : null)}
      uses={uses}
    />
  );
};

/** The component's file when the project has one: its look, else none (its default look). */
const useSystemFile = (name: string) =>
  useComponents((s) => {
    const file = s.components.find((c) => c.name === name);
    return file?.origin === "system" ? file : undefined;
  });

/** The "…" of a component's board: implement it, and take its look over or reset it. */
export const SystemMenu = ({ name }: { name: string }) => {
  const file = useSystemFile(name);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label="More" size="icon" variant="ghost">
            <Ellipsis />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          onClick={() => startTask({ _tag: "Implement", target: name })}
        >
          <Code2 />
          Implement
        </DropdownMenuItem>
        {file ? (
          <DropdownMenuItem
            onClick={() =>
              removeComponent(name, {
                confirmLabel: "Reset",
                description: `${name} is drawn in its default look again; its behaviour notes go with its file.`,
                title: `Reset ${name} to its default look?`,
              })
            }
            variant="destructive"
          >
            <RotateCcw />
            Reset to default look
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => takeOver(name)}>
            Take the look over
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** A select's value for a member, and back: `variant=outline`, empty for every variant. */
const memberKey = (place: LookPlace) =>
  place.variant ? `${place.variant.axis}=${place.variant.member}` : "";

/** A state's name in the State select: the base is what an instance shows by default. */
const stateLabel = (state: ComponentState | null) =>
  state === null ? "Default" : `${state[0]?.toUpperCase()}${state.slice(1)}`;

/**
 * The board a place's cell is on: the matrix for the row axis's members and the base, a further
 * axis's own board for its members in their default state. A place no board draws (a further
 * axis's member in a state) is picked on the matrix, outlined nowhere.
 */
const boardOfPlace = (place: LookPlace, rowAxis: string | undefined) =>
  place.variant && place.variant.axis !== rowAxis && place.state === null
    ? `axis-${place.variant.axis}`
    : "matrix";

/** The part edited, kept per component while its board is open. */
const usePart = (name: string) => {
  const [parts, setParts] = useState<Record<string, string>>({});
  return [
    parts[name] ?? ROOT_SLOT,
    (part: string) => setParts((p) => ({ ...p, [name]: part })),
  ] as const;
};

/** The place of the look picked on the board: the cell's, else the base. */
const usePlace = (): LookPlace => {
  const pick = useBoard(pickOf);
  return useMemo(
    () => (pick ? (placeOfCell(pick.nodeId) ?? BASE) : BASE),
    [pick]
  );
};

/** A system component's inspector on its board: the place picked, its fields, its notes. */
export const LookInspector = ({
  meta,
  name,
}: {
  meta: ComponentMeta | undefined;
  name: string;
}) => {
  const file = useSystemFile(name);
  const fallback = useMemo(() => defaultLookOf(name), [name]);
  const drawn = file ?? fallback;
  const place = usePlace();
  const [slot, setSlot] = usePart(name);
  const parts = partsOf(name);
  const axes = drawn ? axesOf(drawn, meta) : {};
  const rowAxis = drawn ? rowAxisOf(drawn, axes, undefined) : undefined;
  const members = Object.entries(axes).flatMap(([axis, names]) =>
    names.map((member) => ({ axis, member }))
  );
  const pickPlace = (next: LookPlace) =>
    pickOnBoard({
      frame: boardFrameOf({
        item: name,
        name: boardOfPlace(next, rowAxis),
        view: "library",
      }),
      nodeId: cellId(next),
    });

  const placeFields = (
    <Section title="Place">
      <Row label="Variant">
        <NativeSelect
          aria-label="Variant"
          className="w-full"
          onChange={(e) => {
            const [axis = "", member = ""] = e.target.value.split("=");
            pickPlace({
              ...place,
              variant: e.target.value === "" ? null : { axis, member },
            });
          }}
          size="sm"
          value={memberKey(place)}
        >
          <NativeSelectOption value="">Every variant</NativeSelectOption>
          {members.map((m) => (
            <NativeSelectOption
              key={`${m.axis}=${m.member}`}
              value={`${m.axis}=${m.member}`}
            >
              {Object.keys(axes).length > 1 ? `${m.axis}: ` : ""}
              {m.member}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <Row label="State">
        <NativeSelect
          aria-label="State"
          className="w-full"
          onChange={(e) =>
            pickPlace({
              ...place,
              state: COMPONENT_STATES.find((s) => s === e.target.value) ?? null,
            })
          }
          size="sm"
          value={place.state ?? ""}
        >
          {[null, ...COMPONENT_STATES].map((s) => (
            <NativeSelectOption key={s ?? ""} value={s ?? ""}>
              {stateLabel(s)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
    </Section>
  );

  if (!file) {
    return (
      <>
        {placeFields}
        <div className="flex flex-col items-start gap-2 border-b p-3 font-body text-muted-foreground">
          {name} is drawn in its default look, over your tokens. Take it over to
          change any part of it here; implementing gives your application's own{" "}
          {name} the look.
          <Button disabled={!fallback} onClick={() => takeOver(name)} size="sm">
            Take the look over
          </Button>
        </div>
        <ComponentUsedIn from={SYSTEM_FROM} name={name} />
      </>
    );
  }

  // The saved style: a field's own value is what it commits against, the draft being drawn only.
  const style = styleAt(file, place, slot);
  const commit = (next: PartStyle) => {
    if (JSON.stringify(next) === JSON.stringify(styleAt(file, place, slot))) {
      draftStyle(null);
      return;
    }
    commitStyle({ component: name, place, slot, style: next });
  };
  const preview = (next: PartStyle | null) =>
    draftStyle(next && { component: name, place, slot, style: next });

  return (
    <>
      {placeFields}
      <Section title="Look">
        {parts.length > 1 && parts.length <= 3 ? (
          <Segmented
            onChange={setSlot}
            options={parts.map((p) => ({
              label: p.name === ROOT_SLOT ? name : p.label,
              value: p.name,
            }))}
            value={slot}
          />
        ) : null}
        {parts.length > 3 ? (
          <NativeSelect
            aria-label="Part"
            className="w-full"
            onChange={(e) => setSlot(e.target.value)}
            size="sm"
            value={slot}
          >
            {parts.map((p) => (
              <NativeSelectOption key={p.name} value={p.name}>
                {p.name === ROOT_SLOT ? name : p.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        <SlotFields
          inherited={inheritedAt(file, fallback, place, slot)}
          onChange={commit}
          onPreview={preview}
          style={style}
        />
      </Section>
      {systemComponentOf(name)?.slots.some(
        (s) => s.optional || s.holds !== undefined
      ) || systemComponentOf(name)?.templatedItems ? (
        <Section title="Parts">
          <LookExtras
            file={file}
            onChange={(next) =>
              change(name, { look: lookOf(next), op: "setLook" })
            }
          />
        </Section>
      ) : null}
      <ComponentUsedIn from={SYSTEM_FROM} name={name} />
      <Section title="Notes">
        <Notes component={file} parts={parts} />
      </Section>
    </>
  );
};
