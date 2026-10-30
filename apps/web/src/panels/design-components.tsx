import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import {
  type AppComponentFile,
  COMPONENT_STATES,
  type ComponentFile,
  type ComponentState,
  ROOT_SLOT,
  SYSTEM_FROM,
  type SystemComponentFile,
} from "@ultrapaint/contracts/components";
import { componentTarget } from "@ultrapaint/contracts/implementation";
import { presetSize } from "@ultrapaint/contracts/pages";
import {
  fallbacksOf,
  inheritedAt,
  type Member,
  type Place,
  placeLabel,
  styleAt,
  withStyle,
} from "@ultrapaint/design-document/look-places";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { designCss } from "@ultrapaint/system-components/look";
import { ArrowLeft, Code2, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { axesOf, matrixOf } from "../boards/library-boards.ts";
import { useFrameDrawing } from "../canvas/editor-frame.ts";
import { PreviewSurface } from "../canvas/preview-surface.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import { startTask } from "../lib/start-thread.ts";
import { useComponents } from "../state/components.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { statusLabel, useImplementation } from "../state/implementation.ts";
import { useDesignLook } from "../state/look.ts";
import { reportError } from "../state/project.ts";
import {
  change,
  LookExtras,
  lookOf,
  Notes,
  partsOf,
  removeComponent,
  SlotFields,
} from "./look-inspector.tsx";

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
  rowAxis,
}: {
  component: ComponentFile;
  meta: ComponentMeta | undefined;
  /** The axis drawn a row per member of, when the look has several. */
  rowAxis?: string | undefined;
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
        root: matrixOf(component, meta, pageWidth, rowAxis),
      }),
      [ds, meta, component, look, pageWidth, rowAxis]
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
  // The member and the state edited: both together edit that state in that member.
  const [variant, setVariant] = useState<Member | null>(null);
  const [state, setState] = useState<ComponentState | null>(null);
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

  const place: Place = { state, variant };
  const axes = axesOf(file, meta);
  const members = Object.entries(axes).flatMap(([axis, names]) =>
    names.map((member) => ({ axis, member }))
  );
  const fallbacks = fallbacksOf(place).map(placeLabel);
  const dirty = JSON.stringify(file) !== JSON.stringify(saved);

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 font-body">
        <div className="flex items-center gap-2">
          <ImplementButton name={name} />
          <Button
            onClick={() =>
              removeComponent(name, {
                confirmLabel: "Reset",
                description: `${name} is drawn in its default look again; its behaviour notes go with its file.`,
                title: `Reset ${name} to its default look?`,
              }).then((removed) => removed && onBack())
            }
            size="sm"
            variant="ghost"
          >
            <RotateCcw />
            Reset to default
          </Button>
        </div>
        <Matrix component={file} meta={meta} rowAxis={variant?.axis} />

        <div className="grid grid-cols-2 gap-1.5">
          <NativeSelect
            aria-label="Variant"
            onChange={(e) => {
              const [axis = "", member = ""] = e.target.value.split("=");
              setVariant(e.target.value === "" ? null : { axis, member });
            }}
            size="sm"
            value={variant ? `${variant.axis}=${variant.member}` : ""}
          >
            <NativeSelectOption value="">Every variant</NativeSelectOption>
            {members.map((m) => (
              <NativeSelectOption
                key={`${m.axis}=${m.member}`}
                value={`${m.axis}=${m.member}`}
              >
                {m.axis}: {m.member}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="State"
            onChange={(e) =>
              setState(
                e.target.value === ""
                  ? null
                  : (e.target.value as ComponentState)
              )
            }
            size="sm"
            value={state ?? ""}
          >
            <NativeSelectOption value="">No state</NativeSelectOption>
            {COMPONENT_STATES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                State: {s}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <div className="col-span-2">
            <NativeSelect
              aria-label="Part"
              className="w-full"
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
        </div>
        <p className="text-muted-foreground">
          {variant && state
            ? `${state} as ${variant.member} draws it, over ${state} in every variant.`
            : `Editing ${placeLabel(place)}.`}
          {fallbacks.length > 0
            ? ` A field left empty takes ${fallbacks.join(", then ")}.`
            : ""}
        </p>
        <SlotFields
          inherited={inheritedAt(file, fallback, place, slot)}
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
            removeComponent(file.name, {
              confirmLabel: "Delete",
              description: `Its tree goes with it; pages that use ${file.name} show it missing.`,
              title: `Delete the ${file.name} component?`,
            }).then((removed) => removed && onBack())
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
