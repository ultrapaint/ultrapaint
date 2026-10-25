/**
 * The Design system panel's Components tab (ADR 0029): every component of the code and every
 * draft, with who owns its look. Opening one shows its spec as a live matrix of its variants and
 * states, drawn by the preview with the real component, and the fields of one slot in the base,
 * a variant or a state. A spec is read off the code's classes; taking its look over lets the
 * design restyle the component while its behaviour stays the code's.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { specTarget } from "@ultrapaint/contracts/implementation";
import {
  type ComponentSpec,
  DRAFT_FROM,
  ROOT_SLOT,
  SPEC_STATES,
  type SpecState,
  type SpecStyle,
} from "@ultrapaint/contracts/specs";
import { STATE_ATTRIBUTE } from "@ultrapaint/design-document/spec";
import { ArrowLeft, Code2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { bridgeFor } from "../canvas/bridge.ts";
import { useHostUrl } from "../canvas/frame.tsx";
import { usePreviewBridge } from "../canvas/use-preview-bridge.ts";
import { confirmDialog } from "../components/dialogs.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import { ValueField } from "../components/value-field.tsx";
import { startCommand } from "../lib/start-thread.ts";
import {
  type FieldTokenKind,
  Swatch,
  useColorOf,
  useTokenOptions,
} from "../lib/token-options.tsx";
import { useCatalogue } from "../state/catalogue.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { statusLabel, useImplementation } from "../state/implementation.ts";
import { designLook } from "../state/look.ts";
import { reportError } from "../state/project.ts";
import { useSpecs } from "../state/specs.ts";

/** A component as the tab lists it: the code's, a spec's, or both. */
interface Listed {
  readonly from: string;
  readonly meta?: ComponentMeta;
  readonly name: string;
  readonly spec?: ComponentSpec;
}

const listedOf = (
  components: readonly ComponentMeta[],
  specs: readonly ComponentSpec[]
): Listed[] => {
  const byName = new Map<string, Listed>();
  for (const meta of components) {
    byName.set(meta.name, { from: meta.importFrom, meta, name: meta.name });
  }
  for (const spec of specs) {
    const known = byName.get(spec.component);
    byName.set(spec.component, {
      from: spec.from,
      name: spec.component,
      spec,
      ...(known?.meta && { meta: known.meta }),
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const lookLabel = (spec: ComponentSpec | undefined) => {
  if (!spec) {
    return "code";
  }
  if (spec.draft) {
    return "draft";
  }
  return spec.look === "design" ? "design" : "mirrored";
};

/** Saves a spec; what the server refuses is said. */
const save = async (spec: ComponentSpec) => {
  try {
    await api().request("specs.write", { spec });
  } catch (error) {
    reportError(error);
  }
};

/** Where a field of a spec is set: the base, a variant's member, or a state, and which slot. */
type Place =
  | { readonly kind: "base" }
  | { readonly axis: string; readonly kind: "variant"; readonly member: string }
  | { readonly kind: "state"; readonly state: SpecState };

const styleAt = (
  spec: ComponentSpec,
  place: Place,
  slot: string
): SpecStyle => {
  if (place.kind === "base") {
    return spec.base[slot] ?? {};
  }
  if (place.kind === "variant") {
    return spec.variants[place.axis]?.[place.member]?.[slot] ?? {};
  }
  return spec.states[place.state]?.[slot] ?? {};
};

/** The spec with one slot's style at a place replaced; empty styles are taken out. */
const withStyle = (
  spec: ComponentSpec,
  place: Place,
  slot: string,
  style: SpecStyle
): ComponentSpec => {
  const empty = Object.keys(style).length === 0;
  const slots = (current: Readonly<Record<string, SpecStyle>> | undefined) => {
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
    return { kind: "state", state: a as SpecState };
  }
  return { kind: "base" };
};

/** The axes and members a spec is drawn in: its own, and the code's where it says none. */
const axesOf = (spec: ComponentSpec, meta: ComponentMeta | undefined) => {
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
 * is none), a column for the base and each state, every cell the real component pinned in it.
 */
const matrixOf = (
  spec: ComponentSpec,
  meta: ComponentMeta | undefined,
  label: string
): DesignNode => {
  const axes = axesOf(spec, meta);
  const [axis] = Object.keys(axes);
  const members = axis ? (axes[axis] ?? []) : [];
  const states: (SpecState | null)[] = [
    null,
    ...SPEC_STATES.filter(
      (s) =>
        spec.states[s] !== undefined ||
        ["hover", "focus", "disabled"].includes(s)
    ),
  ];
  const rows = (members.length > 0 ? members : [null]).map(
    (member, r): DesignNode => ({
      children: states.map(
        (state, c): DesignNode => ({
          component: spec.component,
          from: spec.from,
          id: `cell-${r}-${c}`,
          props: {
            ...(axis && member ? { [axis]: member } : {}),
            ...(state ? { [STATE_ATTRIBUTE]: state } : {}),
            ...(state === "disabled" ? { disabled: true } : {}),
          },
          ...(spec.draft ? {} : { text: label }),
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

/** The spec drawn live, with the edits not saved yet. */
const Matrix = ({
  meta,
  spec,
}: {
  meta: ComponentMeta | undefined;
  spec: ComponentSpec;
}) => {
  const host = useHostUrl();
  const ds = useDesignSystem((s) => s.designSystem);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [ready, setReady] = useState(false);
  const frame = "design-system:components";
  usePreviewBridge(
    ref,
    host ? frame : null,
    host,
    (msg) => {
      if (msg.type === "ed:ready") {
        setReady(true);
      }
      if (msg.type === "ed:size") {
        setHeight(msg.height);
      }
    },
    () => setReady(false)
  );
  useEffect(() => {
    if (!ready) {
      return;
    }
    const look = designLook();
    bridgeFor(frame).render({
      designSystem: ds,
      look: {
        // The spec being edited stands in for the saved one.
        specs: [
          ...look.specs.filter((s) => s.component !== spec.component),
          spec,
        ],
        styles: look.styles,
      },
      mode: "fit",
      root: matrixOf(spec, meta, spec.component),
    });
  }, [ready, ds, spec, meta]);
  if (!host) {
    return (
      <div className="px-3 py-2 font-body text-muted-foreground">
        The preview is not running; the component is drawn by it.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border bg-white">
      <iframe
        className="pointer-events-none block w-full border-0"
        ref={ref}
        src={`${host}/?frame=${encodeURIComponent(frame)}`}
        style={{ height }}
        title={`${spec.component} in its variants and states`}
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
        placeholder="The code's"
        title={label}
        value={value}
      />
    </div>
  );
};

/** The fields of one slot at one place. */
const SlotFields = ({
  onChange,
  style,
}: {
  onChange: (style: SpecStyle) => void;
  style: SpecStyle;
}) => {
  const set = (key: keyof SpecStyle) => (value: JsonValue) => {
    const { [key]: _old, ...rest } = style;
    onChange(
      value === null || value === ""
        ? rest
        : ({ ...rest, [key]: value } as SpecStyle)
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
        : { ...others, border: next }) as SpecStyle
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

const SpecDetail = ({
  listed,
  onBack,
}: {
  listed: Listed;
  onBack: () => void;
}) => {
  const saved = listed.spec;
  // Edits not saved yet, on the spec as the server had it: one from the server since replaces them.
  const [edits, setEdits] = useState<{
    readonly from: ComponentSpec | undefined;
    readonly spec: ComponentSpec | undefined;
  } | null>(null);
  const spec = edits && edits.from === saved ? edits.spec : saved;
  const setSpec = (next: ComponentSpec | undefined) =>
    setEdits({ from: saved, spec: next });
  const [placeKeyed, setPlace] = useState("base");
  const [slot, setSlot] = useState(ROOT_SLOT);
  const item = useImplementation((s) => s.byTarget[specTarget(listed.name)]);

  const read = async (look: "code" | "design") => {
    try {
      const entry = await api().request("specs.fromCode", {
        component: listed.name,
        from: listed.from,
        look,
      });
      setSpec(entry.spec);
    } catch (error) {
      reportError(error);
    }
  };

  const header = (
    <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
      <Button onClick={onBack} size="icon-sm" variant="ghost">
        <ArrowLeft />
      </Button>
      <span className="truncate font-medium">{listed.name}</span>
      {item && item.status !== "draft" ? (
        <span className="ml-auto truncate font-body text-muted-foreground">
          {statusLabel(item)}
        </span>
      ) : null}
    </div>
  );

  if (!spec) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex flex-col gap-2 p-3 font-body">
          <p className="text-muted-foreground">
            {listed.name}'s look is its code's. Read it into a spec to see its
            variants and states; take it over to restyle it here, while what it
            does stays the code's.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={() => read("design")} size="sm">
              Take the look over
            </Button>
            <Button onClick={() => read("code")} size="sm" variant="outline">
              Mirror the code
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const place = placeOf(placeKeyed);
  const axes = axesOf(spec, listed.meta);
  const places: { label: string; value: string }[] = [
    { label: "Base", value: "base" },
    ...Object.entries(axes).flatMap(([axis, members]) =>
      members.map((member) => ({
        label: `${axis}: ${member}`,
        value: placeKey({ axis, kind: "variant", member }),
      }))
    ),
    ...SPEC_STATES.map((state) => ({
      label: `State: ${state}`,
      value: placeKey({ kind: "state", state }),
    })),
  ];
  const editable = spec.look === "design";
  const dirty = JSON.stringify(spec) !== JSON.stringify(saved);

  const remove = async () => {
    if (
      !(await confirmDialog({
        confirmLabel: "Delete",
        description: spec.draft
          ? `The draft's tree goes with it; pages that use ${spec.component} show it missing.`
          : `${spec.component} is drawn as its code draws it again.`,
        title: `Delete the ${spec.component} spec?`,
      }))
    ) {
      return;
    }
    try {
      await api().request("specs.remove", { component: spec.component });
      onBack();
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 font-body">
        <div className="flex items-center gap-2">
          {spec.draft ? (
            <Badge variant="outline">
              Draft: the code does not have it yet
            </Badge>
          ) : (
            <div className="w-40">
              <Segmented
                onChange={(look) => {
                  const next = { ...spec, look };
                  setSpec(next);
                  save(next);
                }}
                options={[
                  { label: "Code's look", value: "code" as const },
                  { label: "Design's", value: "design" as const },
                ]}
                value={spec.look}
              />
            </div>
          )}
          <Button
            className="ml-auto"
            onClick={() => startCommand(`/implement ${spec.component}`)}
            size="sm"
            variant="outline"
          >
            <Code2 />
            Implement
          </Button>
          <Button onClick={remove} size="icon-sm" variant="ghost">
            <Trash2 />
          </Button>
        </div>
        <Matrix meta={listed.meta} spec={spec} />
        {editable || spec.draft ? (
          <>
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
                {spec.slots.map((s) => (
                  <NativeSelectOption key={s.name} value={s.name}>
                    {s.label ??
                      (s.name === ROOT_SLOT ? "The component" : s.name)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <SlotFields
              onChange={(style) => setSpec(withStyle(spec, place, slot, style))}
              style={styleAt(spec, place, slot)}
            />
            <div className="flex gap-1.5">
              <Button
                disabled={!dirty}
                onClick={async () => {
                  await save(spec);
                  toast.success(
                    `${spec.component}'s look is saved: implement it to bring the code along.`
                  );
                }}
                size="sm"
              >
                Save
              </Button>
              <Button
                disabled={!dirty}
                onClick={() => setSpec(saved)}
                size="sm"
                variant="ghost"
              >
                Discard
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">
            The spec mirrors the code. Take the look over to change it here.
          </p>
        )}
      </div>
    </div>
  );
};

export const ComponentsView = ({ q }: { q: string }) => {
  const catalogue = useCatalogue((s) => s.catalogue);
  const specs = useSpecs((s) => s.specs);
  const entries = useSpecs((s) => s.entries);
  const problems = entries.filter((e) => e.problem !== undefined);
  const byTarget = useImplementation((s) => s.byTarget);
  const [open, setOpen] = useState<string | null>(null);
  const listed = listedOf(catalogue?.components ?? [], specs).filter(
    (l) => !q || l.name.toLowerCase().includes(q)
  );
  const opened = open ? listed.find((l) => l.name === open) : undefined;

  useEffect(() => {
    useImplementation.getState().load();
  }, []);

  if (opened) {
    return <SpecDetail listed={opened} onBack={() => setOpen(null)} />;
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
          const look = lookLabel(l.spec);
          const item = byTarget[specTarget(l.name)];
          return (
            <li key={l.name}>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
                onClick={() => setOpen(l.name)}
                type="button"
              >
                <span className="truncate">{l.name}</span>
                {l.from === DRAFT_FROM ? null : (
                  <span className="truncate text-muted-foreground">
                    {l.meta?.category ?? ""}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {item && item.status !== "draft" ? (
                    <span className="text-muted-foreground">
                      {statusLabel(item)}
                    </span>
                  ) : null}
                  <Badge
                    variant={
                      look === "design" || look === "draft"
                        ? "default"
                        : "outline"
                    }
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
