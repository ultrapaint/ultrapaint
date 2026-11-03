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
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import { nodeKind, nodeLabel } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  BoxSelect,
  Code,
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
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "../components/icon-button.tsx";
import { LinkField } from "../components/link-field.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { Segmented } from "../components/segmented.tsx";
import { CommandKeys } from "../components/shortcut-sheet.tsx";
import {
  allSelected,
  areSiblings,
  deleteSelection,
  duplicateSelection,
  setHidden,
  setPropsOfSelection,
  unwrapSelection,
  wrapSelection,
} from "../lib/node-actions.ts";
import { TOKEN_FIELDS } from "../lib/node-fields.ts";
import { copyNodeRef } from "../lib/node-links.ts";
import {
  editPageUrl,
  implementPage,
  markImplemented,
  setPageReady,
} from "../lib/page-actions.ts";
import { presetOf, viewportPresets } from "../lib/presets.ts";
import { MIXED, sharedValue, shownAs } from "../lib/shared-value.ts";
import { withSides } from "../lib/sides.ts";
import { useCanvasPicks } from "../state/canvas-picks.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf, hasPrototypeLinks } from "../state/frame-ref.ts";
import {
  exportTokens,
  statusLabel,
  tokensWaiting,
  useImplementation,
} from "../state/implementation.ts";
import { setPreset } from "../state/page-layout.ts";
import { showLeftPanel, usePanels } from "../state/panels.ts";
import { reportError, useProject } from "../state/project.ts";
import { useInspected } from "../state/selection.ts";
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
  LayoutSection,
  SizeSection,
  SpacingSection,
  type WriteSides,
} from "./inspector-layout.tsx";
import { SlotsSection } from "./inspector-slots.tsx";
import { TextSection } from "./inspector-text.tsx";

export const Inspector = () => {
  const inspected = useInspected();
  const picked = useCanvasPicks((s) => s.ids.length);
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
  // Updated in place from one selection to the next, not mounted again: a selection costs what
  // changes, not every field and control drawn anew.
  return (
    <InspectedKey.Provider
      value={`${frame}#${nodes.map((n) => n.id).join(",")}`}
    >
      <div className="flex flex-col pb-4">
        <Header frame={frame} node={node} nodes={nodes} />
        {nodes.length === 1 && <IsolatedComponent frame={frame} node={node} />}
        {node.type === "page" && nodes.length === 1 && (
          <PageSection frame={frame} />
        )}
        {nodes.length === 1 && <BreakpointSection frame={frame} node={node} />}
        {oneComponent(nodes) && <InstanceSection frame={frame} nodes={nodes} />}
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
    </InspectedKey.Provider>
  );
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
      <span className="min-w-0 truncate font-small text-muted-foreground">
        {[...new Set(nodes.map(nodeKind))].join(", ")}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2 font-small text-muted-foreground tabular-nums">
      <span className="truncate">{nodeKind(node)}</span>
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
  const several = nodes.length > 1;
  // A page's root is named by its page, which the pages list renames.
  const pageName = useProject((s) =>
    isRoot ? s.pages.find((p) => p.id === frame)?.name : undefined
  );
  // What heads the panel when the name is not the node's to edit.
  let title: string | null = pageName ?? null;
  if (several) {
    title = `${nodes.length} selected`;
  }
  const hidden = nodes.every((n) => n.hidden === true);
  // Several nodes go into one container only from one parent.
  const wrappable = !several || areSiblings(allSelected());
  const wrapTip = (tip: string) =>
    wrappable ? tip : "Only siblings can be wrapped together";
  return (
    <div className="flex flex-col border-b px-3 pt-1.5 pb-2">
      <div className="flex h-8 items-center gap-1">
        <div className="min-w-0 flex-1">
          {title === null ? (
            <NameInput node={node} />
          ) : (
            <div className="truncate font-heading-xsmall" title={title}>
              {title}
            </div>
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
        {isRoot ? null : (
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
    <>
      <Section title="Page">
        <Row label="URL">
          <button
            className={cn(
              "h-7 min-w-0 flex-1 truncate rounded-md bg-muted px-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/25",
              page.route === undefined
                ? "font-body text-muted-foreground"
                : "font-code"
            )}
            onClick={() => editPageUrl(page)}
            title={
              page.route === undefined
                ? "No link or prototype reaches it"
                : "Change the URL"
            }
            type="button"
          >
            {page.route ?? "None"}
          </button>
        </Row>
        <Row label="Viewport">
          <OptionSelect
            onChange={(v) => setPreset(frame, v as ViewportPreset)}
            options={viewportPresets}
            value={presetOf(layout)}
          />
        </Row>
      </Section>
      <CodeLink page={page} />
    </>
  );
};

/**
 * The tokens a design uses whose value has not reached the code (ADR 0028), and a way to bring
 * them over; what changed on both sides is left for the Sync view.
 */
const TokensWaiting = ({ tokens }: { tokens: readonly string[] }) => (
  <div className="flex items-start gap-2">
    <p className="min-w-0 flex-1 font-small text-muted-foreground">
      {tokens.length === 1 ? "A token" : `${tokens.length} tokens`} it uses wait
      {tokens.length === 1 ? "s" : ""} for the code:{" "}
      <span className="font-code text-foreground">{tokens.join(", ")}</span>
    </p>
    <Button
      className="shrink-0"
      onClick={() => exportTokens(tokens)}
      size="sm"
      variant="outline"
    >
      Export
    </Button>
  </div>
);

/**
 * Where the page stands with the code that implements it (ADR 0030): the files, whether the
 * design or the code changed since, what changed in the design, and the way to implement it.
 */
const CodeLink = ({ page }: { page: Page }) => {
  const item = useImplementation((s) => s.byTarget[page.id]);
  const designChanged = item?.designChanged ?? false;
  // What changed is read for the page and the status it has now; an answer for another is not shown.
  const key = `${page.id}:${item?.at ?? 0}:${designChanged}`;
  const [read, setRead] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (!designChanged) {
      return;
    }
    api()
      .request("implementation.changes", { target: page.id })
      .then((c) => setRead({ key, text: c.text }))
      .catch(() => undefined);
  }, [page.id, designChanged, key]);
  const changes = designChanged && read?.key === key ? read.text : null;
  const bound = item?.status === "implemented" || item?.status === "changed";
  const draft = item?.status === "draft" || item === undefined;
  const behind = item?.status === "changed" || tokensWaiting(item);
  return (
    <Section title="Code">
      <Row label="Status">
        <span
          className="flex min-w-0 items-center gap-1.5 font-body"
          title={item?.files.join("\n")}
        >
          {behind ? (
            <span className="size-1.5 shrink-0 rounded-full bg-warning" />
          ) : null}
          <span className={cn("truncate", draft && "text-muted-foreground")}>
            {item && item.status !== "draft"
              ? statusLabel(item)
              : "Not implemented"}
          </span>
        </span>
      </Row>
      {bound && item ? (
        <Row label="Files">
          <span
            className="truncate font-code text-muted-foreground"
            title={item.files.join("\n")}
          >
            {item.files.join(", ")}
          </span>
        </Row>
      ) : null}
      {item?.tokens ? <TokensWaiting tokens={item.tokens} /> : null}
      {changes ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-code text-muted-foreground">
          {changes}
        </pre>
      ) : null}
      <div className="flex flex-col gap-1 pt-1">
        <Button
          className="w-full"
          onClick={() => implementPage(page)}
          variant="outline"
        >
          <Code />
          {item?.status === "changed" && item.designChanged
            ? "Implement what changed"
            : "Implement"}
        </Button>
        <div className="flex gap-1">
          {draft ? (
            <Button
              className="flex-1"
              onClick={() => setPageReady(page, true)}
              size="sm"
              variant="ghost"
            >
              Mark ready
            </Button>
          ) : null}
          <Button
            className="flex-1"
            onClick={() => markImplemented(page.id, page.name, item?.files)}
            size="sm"
            variant="ghost"
          >
            {bound ? "Mark implemented again…" : "Mark implemented…"}
          </Button>
        </div>
      </div>
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
            <span
              className="truncate font-code font-normal text-muted-foreground"
              title={node.from}
            >
              {node.from}
            </span>
          </span>
        }
      >
        {ownText ? (
          <Row label="Text">
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
      <Row label="Alt">
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
      <Row label="Tint">
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
