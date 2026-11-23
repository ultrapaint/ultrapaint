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
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type {
  DesignNode,
  ImageNode,
  InstanceNode,
} from "@ultrapaint/contracts/document";
import type { ViewportPreset } from "@ultrapaint/contracts/pages";
import { isInstanceLayer } from "@ultrapaint/design-document/instance-layers";
import { nodeKind, nodeLabel } from "@ultrapaint/design-document/tree";
import {
  BoxSelect,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  Group,
  Hash,
  Rows3,
  SquareDashedMousePointer,
  Trash2,
  Ungroup,
  Upload,
} from "lucide-react";
import type * as React from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { CutText } from "../components/cut-text.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { LinkField } from "../components/link-field.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { Segmented } from "../components/segmented.tsx";
import { CommandKeys } from "../components/shortcut-sheet.tsx";
import {
  deleteSelection,
  duplicateSelection,
  setHidden,
  setPropsOfSelection,
  unwrapSelection,
  wrapSelection,
} from "../lib/node-actions.ts";
import { TOKEN_FIELDS } from "../lib/node-fields.ts";
import { copyNodeRef } from "../lib/node-links.ts";
import { DRAFT_HINT, editPageUrl } from "../lib/page-actions.ts";
import { presetOf, viewportPresets } from "../lib/presets.ts";
import { MIXED, sharedValue, shownAs } from "../lib/shared-value.ts";
import { withSides } from "../lib/sides.ts";
import { useCanvasPicks } from "../state/canvas-picks.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf, hasPrototypeLinks } from "../state/frame-ref.ts";
import { setPreset } from "../state/page-layout.ts";
import { showLeftPanel, usePanels } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";
import { useInspected, useSelectedAreSiblings } from "../state/selection.ts";
import {
  openSet,
  type PartOf,
  partNodeOf,
  useVariations,
  variationFrameOf,
} from "../state/variations.ts";
import { ComponentProps } from "./component-props.tsx";
import { AppearanceSection } from "./inspector-appearance.tsx";
import { BreakpointSection } from "./inspector-breakpoints.tsx";
import { IsolatedComponent } from "./inspector-component.tsx";
import {
  allOf,
  allStacks,
  ColorField,
  EmptyState,
  InspectedKey,
  nullIfMixed,
  oneComponent,
  Row,
  Section,
  set,
  setEach,
  sharedOf,
  TextInput,
  useDraft,
} from "./inspector-fields.tsx";
import {
  InstanceLayerNote,
  InstanceOverrideMarks,
  InstanceOverridesSection,
  MainComponentRows,
} from "./inspector-instance.tsx";
import {
  LayoutSection,
  SizeSection,
  SpacingSection,
  type WriteSides,
} from "./inspector-layout.tsx";
import { BehaviourSection, ViewsRow } from "./inspector-page.tsx";
import { SlotsSection } from "./inspector-slots.tsx";
import { TextSection } from "./inspector-text.tsx";
import { VariationsSection } from "./inspector-variations.tsx";

export const Inspector = () => {
  const inspected = useInspected();
  const picked = useCanvasPicks((s) => s.ids.length);
  const part = useVariations((s) => s.open?.part ?? null);
  if (part) {
    return <PartInspector part={part} />;
  }
  if (picked > 1) {
    return (
      <EmptyState icon={<BoxSelect />} title={`${picked} frames`}>
        Drag one’s name to move them together; a page’s menu acts on all of
        them.
      </EmptyState>
    );
  }
  if (!inspected) {
    return <NothingSelected />;
  }
  const { frame, node, nodes } = inspected;
  const layer = nodes.some((n) => isInstanceLayer(n.id));
  // Updated in place from one selection to the next, not mounted again: a selection costs what
  // changes, not every field and control drawn anew.
  return (
    <InspectedKey.Provider
      value={`${frame}#${nodes.map((n) => n.id).join(",")}`}
    >
      <InstanceOverrideMarks
        frame={frame}
        node={nodes.length === 1 ? node : null}
      >
        <div className="flex flex-col pb-4">
          <Header frame={frame} node={node} nodes={nodes} />
          {nodes.length === 1 && (
            <InstanceLayerNote frame={frame} node={node} />
          )}
          {nodes.length === 1 && !layer && (
            <IsolatedComponent frame={frame} node={node} />
          )}
          {/* A layer of an instance has no variations of its own (ADR 0114). */}
          {nodes.length === 1 && !layer && (
            <VariationsSection frame={frame} node={node} />
          )}
          {node.type === "page" && nodes.length === 1 && (
            <PageSection frame={frame} />
          )}
          {nodes.length === 1 && !layer && (
            <BehaviourSection frame={frame} node={node} />
          )}
          {nodes.length === 1 && (
            <BreakpointSection frame={frame} node={node} />
          )}
          {nodes.length === 1 && (
            <InstanceOverridesSection frame={frame} node={node} />
          )}
          {oneComponent(nodes) && (
            <InstanceSection frame={frame} nodes={nodes} />
          )}
          {allOf(nodes, "text") && <TextSection nodes={nodes} />}
          {allOf(nodes, "image") && <ImageSection nodes={nodes} />}
          {allStacks(nodes) && <LayoutSection nodes={nodes} />}
          <SizeSection frame={frame} nodes={nodes} />
          <SpacingSection nodes={nodes} write={writeSides} />
          <AppearanceSection nodes={nodes} />
          {/* Only a page's node is in the prototype: nothing would follow a link anywhere else. */}
          {node.type !== "page" && hasPrototypeLinks(frameRefOf(frame)) && (
            <LinkSection nodes={nodes} />
          )}
        </div>
      </InstanceOverrideMarks>
    </InspectedKey.Provider>
  );
};

/**
 * A part of a variation selected beside the page (ADR 0098): its fields, read-only. They are
 * read as any field is, by sight and by a screen reader, but no press or key changes one: the
 * variation is changed by putting it in use.
 */
const PartInspector = ({ part }: { part: PartOf }) => {
  const node = useVariations((s) => partNodeOf(s, part));
  const variation = useVariations(
    (s) => openSet(s)?.variations.find((v) => v.id === part.variation)?.name
  );
  const open = useVariations((s) => s.open);
  if (!(node && open)) {
    return null;
  }
  const nodes = [node];
  return (
    <div className="flex flex-col pb-4" data-part-inspector="">
      <div className="flex flex-col border-b px-3 pt-2.5 pb-2">
        <CutText className="block truncate font-heading-xsmall">
          {nodeLabel(node)}
        </CutText>
        <span className="font-body-small text-muted-foreground">
          In {variation ?? "a variation"}, read-only
        </span>
      </div>
      <fieldset
        className="flex min-w-0 flex-col"
        data-read-only=""
        disabled
        onClickCapture={holdBack}
        onKeyDownCapture={(e) => {
          if (e.key !== "Tab") {
            holdBack(e);
          }
        }}
        onPointerDownCapture={holdBack}
      >
        {node.type === "text" && <TextSection nodes={[node]} />}
        {node.type === "image" && <ImageSection nodes={[node]} />}
        {allStacks(nodes) && <LayoutSection nodes={nodes} />}
        <SizeSection
          frame={variationFrameOf(open, part.variation)}
          nodes={nodes}
        />
        <SpacingSection nodes={nodes} write={writeSides} />
        <AppearanceSection nodes={nodes} />
      </fieldset>
    </div>
  );
};

/** A press or a key on a read-only field goes no further. */
const holdBack = (e: React.SyntheticEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/** Each node inspected keeps its own other sides. */
const writeSides: WriteSides = (field, sides, value) =>
  setEach(`Change the ${field}`, (n) => ({
    [field]: withSides(n[field], sides, value),
  }));

/** What the panel holds once something is selected, and the way to the layers to select it. */
const NothingSelected = () => {
  const layersShown = useEditor(
    (s) => s.leftTab === "layers" && s.workspace === "design"
  );
  const leftHidden = usePanels((s) => s.left);
  return (
    <EmptyState
      action={
        layersShown && !leftHidden ? null : (
          <Button
            onClick={() => showLeftPanel("layers")}
            size="sm"
            variant="outline"
          >
            Show layers
          </Button>
        )
      }
      icon={<SquareDashedMousePointer />}
      title="Nothing selected"
    >
      Select a layer to change its layout, size, fill and type.
    </EmptyState>
  );
};

// ---- Header and actions ----

const NameInput = ({ node }: { node: DesignNode }) => {
  const [draft, setDraft] = useDraft<string>();
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
      className="-ml-1.5 h-8 min-w-0 truncate border-transparent bg-transparent px-1.5 font-heading-xsmall shadow-none placeholder:text-foreground hover:border-input focus-visible:bg-muted focus-visible:placeholder:text-muted-foreground dark:bg-transparent"
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

/** One node by its kind and its size on the canvas; several by how many of which kinds. */
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
      <span className="min-w-0 truncate font-body-small text-muted-foreground">
        {[...new Set(nodes.map(nodeKind))].join(", ")}
      </span>
    );
  }
  // A layer named for its kind ("Row") says it once, in the name above.
  const kind = nodeKind(node);
  const named =
    node.name !== undefined && node.name !== "" && node.name !== kind;
  return (
    <span className="flex min-w-0 items-center gap-2 font-body-small text-muted-foreground tabular-nums">
      {named ? <span className="truncate">{kind}</span> : null}
      {rect ? (
        <span className="shrink-0">
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      ) : null}
    </span>
  );
};

/** A tooltip that names an action and its keys, when it has any; the name is the button's. */
const keyed = (label: string, command: string) => ({
  label,
  tooltip: (
    <>
      {label}
      <CommandKeys id={command} />
    </>
  ),
});

/** A quiet icon of the header, named by its tooltip. */
const HeaderAction = (props: React.ComponentProps<typeof IconButton>) => (
  <IconButton
    {...props}
    className="text-muted-foreground"
    size="icon-sm"
    variant="ghost"
  />
);

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
  // A layer of an instance is the main component's to name, wrap or copy (ADR 0114).
  const layer = nodes.some((n) => isInstanceLayer(n.id));
  const several = nodes.length > 1;
  // A page's root is named by its page, which the pages list renames.
  const pageName = useProject((s) =>
    isRoot ? s.pages.find((p) => p.id === frame)?.name : undefined
  );
  // What heads the panel when the name is not the node's to edit.
  let title: string | null = pageName ?? (layer ? nodeLabel(node) : null);
  if (several) {
    title = `${nodes.length} selected`;
  }
  const hidden = nodes.every((n) => n.hidden === true);
  // Several nodes go into one container only from one parent.
  const siblings = useSelectedAreSiblings();
  const wrappable = !several || siblings;
  const wrapTip = (tip: string) =>
    wrappable ? tip : "Only siblings can be wrapped together";
  return (
    <div className="flex flex-col border-b px-3 pt-1.5 pb-2">
      <div className="flex h-8 items-center gap-1">
        <div className="min-w-0 flex-1">
          {title === null ? (
            <NameInput node={node} />
          ) : (
            <CutText className="block truncate font-heading-xsmall">
              {title}
            </CutText>
          )}
        </div>
        <div className="-mr-1 flex shrink-0 items-center gap-0.5">
          {several ? null : (
            <HeaderAction
              onClick={() => copyNodeRef({ frame, nodeId: node.id })}
              tooltip="Copy element ID"
            >
              <Hash />
            </HeaderAction>
          )}
          {isRoot ? null : (
            <HeaderAction
              onClick={() => setHidden(!hidden)}
              tooltip={hidden ? "Show" : "Hide"}
            >
              {hidden ? <EyeOff /> : <Eye />}
            </HeaderAction>
          )}
        </div>
      </div>
      <div className="flex h-7 items-center gap-2">
        <div className="min-w-0 flex-1">
          <Kinds frame={frame} node={node} nodes={nodes} />
        </div>
        {isRoot || layer ? null : (
          <div className="-mr-1 flex shrink-0 items-center gap-0.5">
            <HeaderAction
              disabled={!wrappable}
              onClick={() => wrapSelection("group")}
              {...keyed(wrapTip("Wrap in a group"), "wrap:group")}
            >
              <Group />
            </HeaderAction>
            <HeaderAction
              disabled={!wrappable}
              onClick={() => wrapSelection("row")}
              {...keyed(wrapTip("Wrap in a row"), "wrap:row")}
            >
              <Columns3 />
            </HeaderAction>
            <HeaderAction
              disabled={!wrappable}
              onClick={() => wrapSelection("column")}
              {...keyed(wrapTip("Wrap in a column"), "wrap:column")}
            >
              <Rows3 />
            </HeaderAction>
            {nodes.every(
              (n) =>
                n.type === "row" || n.type === "column" || n.type === "group"
            ) && (
              <HeaderAction onClick={() => unwrapSelection()} tooltip="Unwrap">
                <Ungroup />
              </HeaderAction>
            )}
            <span className="mx-0.5 h-4 w-px bg-border" />
            <HeaderAction
              onClick={() => duplicateSelection()}
              {...keyed("Duplicate", "duplicate")}
            >
              <Copy />
            </HeaderAction>
            <HeaderAction
              onClick={() => deleteSelection()}
              {...keyed("Delete", "delete")}
            >
              <Trash2 />
            </HeaderAction>
          </div>
        )}
      </div>
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
      <Row label="Route">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className={cn(
                  "h-7 min-w-0 flex-1 truncate rounded-md bg-muted px-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/25",
                  "font-body",
                  page.route === undefined && "text-muted-foreground"
                )}
                onClick={() => editPageUrl(page)}
                type="button"
              />
            }
          >
            {page.route ?? "None: a draft"}
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {page.route === undefined ? DRAFT_HINT : "Change the route"}
          </TooltipContent>
        </Tooltip>
      </Row>
      <Row label="Viewport">
        <OptionSelect
          onChange={(v) => setPreset(frame, v as ViewportPreset)}
          options={viewportPresets}
          value={presetOf(layout)}
        />
      </Row>
      <ViewsRow pageId={frame} />
    </Section>
  );
};

// ---- Instance ----

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

const InstanceSection = ({
  frame,
  nodes,
}: {
  frame: string;
  nodes: readonly InstanceNode[];
}) => {
  const [node] = nodes;
  if (!node) {
    return null;
  }
  const { mixed, props } = sharedProps(nodes);
  // An app component's text is its properties' (ADR 0041).
  const ownText =
    node.from !== APP_FROM &&
    nodes.every((n) => (n.children?.length ?? 0) === 0);
  return (
    <>
      <ComponentProps
        mixed={mixed}
        node={{ ...node, props }}
        onSet={(name, value) => setPropsOfSelection({ [name]: value })}
        title={
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate">{node.component}</span>
            {/* An app component's instance is set here alone; its main component, in place. */}
            {node.from === APP_FROM ? (
              <span className="shrink-0 font-body-small text-muted-foreground">
                Instance
              </span>
            ) : (
              <CutText className="truncate font-code text-muted-foreground">
                {node.from}
              </CutText>
            )}
          </span>
        }
      >
        {nodes.length === 1 ? (
          <MainComponentRows frame={frame} node={node} />
        ) : null}
        {ownText ? (
          <Row fields={["text"]} label="Text">
            <TextInput
              onChange={(v) => set("text", v === "" ? null : v)}
              {...shownAs(
                sharedOf(nodes, (n) => n.text),
                "No text"
              )}
            />
          </Row>
        ) : null}
      </ComponentProps>
      {nodes.length === 1 && <SlotsSection frame={frame} node={node} />}
    </>
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
      <Row fields={["src"]} label="Source">
        <TextInput
          onChange={(v) => set("src", v)}
          {...shownAs(
            typeof src === "string" && src.startsWith("data:")
              ? "placeholder"
              : src
          )}
        />
        <IconButton
          className="text-muted-foreground"
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
      <Row fields={["alt"]} label="Alt">
        <TextInput
          onChange={(v) => set("alt", v)}
          {...shownAs(sharedOf(nodes, (n) => n.alt))}
        />
      </Row>
      <Row fields={["fit"]} label="Fit">
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
      <Row fields={["tint"]} label="Tint">
        <ColorField
          field={TOKEN_FIELDS.tint}
          nodes={nodes}
          placeholder="None"
        />
      </Row>
    </Section>
  );
};

// ---- Prototype ----

/** Where the nodes lead when pressed in the prototype. */
const LinkSection = ({ nodes }: { nodes: readonly DesignNode[] }) => {
  const shared = sharedOf(nodes, (n) => n.link);
  return (
    <Section title="Prototype">
      <Row fields={["link"]} label="Goes to">
        <LinkField
          link={shared === MIXED ? undefined : (shared ?? undefined)}
          mixed={shared === MIXED}
          onChange={(link) => set("link", link)}
        />
      </Row>
    </Section>
  );
};
