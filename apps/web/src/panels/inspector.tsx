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
import type {
  DesignNode,
  ImageNode,
  InstanceNode,
} from "@ultrapaint/contracts/document";
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import {
  breakpointAt,
  resolveAtBreakpoint,
} from "@ultrapaint/design-document/breakpoints";
import { nodeKind, nodeLabel } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  ArrowDown,
  ArrowRight,
  Code,
  Copy,
  Eye,
  EyeOff,
  Group,
  Hash,
  Trash2,
  Ungroup,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "../components/icon-button.tsx";
import { LinkField } from "../components/link-field.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty, Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
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
import { copyNodeRef } from "../lib/node-links.ts";
import {
  editPageUrl,
  implementPage,
  markImplemented,
  setPageReady,
} from "../lib/page-actions.ts";
import { presetOf, viewportPresets } from "../lib/presets.ts";
import { MIXED, sharedValue, shownAs } from "../lib/shared-value.ts";
import { api } from "../state/connection.ts";
import { useBreakpoints } from "../state/design-system.ts";
import {
  isNodeFrame,
  nodeIn,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import {
  exportTokens,
  statusLabel,
  tokensWaiting,
  useImplementation,
} from "../state/implementation.ts";
import { useInstances } from "../state/instances.ts";
import { reportError, useProject } from "../state/project.ts";
import { ComponentProps } from "./component-props.tsx";
import { AppearanceSection } from "./inspector-appearance.tsx";
import { BreakpointSection } from "./inspector-breakpoints.tsx";
import {
  allOf,
  allStacks,
  ColorField,
  nullIfMixed,
  oneComponent,
  set,
  sharedOf,
  TextInput,
  Warning,
} from "./inspector-fields.tsx";
import {
  LayoutSection,
  SidesSection,
  SizeSection,
} from "./inspector-layout.tsx";
import { TextSection } from "./inspector-text.tsx";

/**
 * The nodes the inspector is about: every one selected, the one it shows first leading; or the
 * root of the selected page.
 */
const useInspected = () => {
  const selection = useEditor((s) => s.selection);
  const also = useEditor((s) => s.also);
  const selectedPage = useEditor((s) => s.selectedPage);
  const canvas = useEditor((s) => s.canvas);
  const frame = selection?.frame ?? selectedPage;
  // The fields as the frame draws them: its breakpoint's values (ADR 0036).
  const breakpoints = useBreakpoints();
  const width = useEditor((s) =>
    frame === null ? undefined : s.frames[frame]?.width
  );
  const shown = width === undefined ? null : breakpointAt(breakpoints, width);
  const nodes = useDocuments(
    useShallow((s): DesignNode[] => {
      const at = (found: DesignNode) =>
        resolveAtBreakpoint(found, breakpoints, shown?.name ?? null);
      if (selection) {
        return [selection, ...also].flatMap((t) => {
          const node = nodeIn(s.docs, canvas, t.frame, t.nodeId);
          return node ? [at(node)] : [];
        });
      }
      const root = selectedPage
        ? rootOfFrame(s.docs, canvas, selectedPage)
        : null;
      return root ? [at(root)] : [];
    })
  );
  const [node] = nodes;
  return node && frame ? { frame, node, nodes } : null;
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
      {nodes.length === 1 && <BreakpointSection frame={frame} node={node} />}
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
      className="h-7 border-transparent bg-transparent px-1 font-heading-xsmall shadow-none hover:border-input dark:bg-transparent"
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
      <div className="truncate px-1 font-body text-muted-foreground">
        {[...new Set(nodes.map(nodeKind))].join(", ")}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-1 font-body text-muted-foreground">
      <span className={cn(node.type === "instance" && "text-component")}>
        {nodeKind(node)}
      </span>
      {rect ? (
        <span>
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      ) : null}
      {/* The id is for agents, not for reading: copied, it finds the element. */}
      <IconButton
        className="ml-auto size-5"
        onClick={() => copyNodeRef({ frame, nodeId: node.id })}
        size="icon-xs"
        tooltip="Copy element ID, which an agent finds it by"
      >
        <Hash className="size-3" />
      </IconButton>
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
            <div className="truncate px-1 font-heading-xsmall leading-7">
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
            "truncate text-left hover:underline",
            page.route === undefined
              ? "font-body text-muted-foreground"
              : "font-code"
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
        <span className="font-body text-muted-foreground">
          {Math.round(layout.width)} × {Math.round(layout.height)}
        </span>
      </Row>
      <CodeLink page={page} />
    </Section>
  );
};

/**
 * The tokens a design uses whose value has not reached the code (ADR 0028), and a way to bring
 * them over; what changed on both sides is left for the Sync view.
 */
const TokensWaiting = ({ tokens }: { tokens: readonly string[] }) => (
  <div className="flex items-start gap-1.5 font-body text-muted-foreground">
    <span className="min-w-0 flex-1">
      {tokens.length === 1 ? "A token" : `${tokens.length} tokens`} it uses wait
      {tokens.length === 1 ? "s" : ""} for the code:{" "}
      <span className="font-code">{tokens.join(", ")}</span>
    </span>
    <Button
      className="shrink-0"
      onClick={() => exportTokens(tokens)}
      size="xs"
      variant="ghost"
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
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <Row label="Code">
        <span
          className={cn(
            "truncate font-body",
            item?.status === "changed" || tokensWaiting(item)
              ? "text-warning"
              : "text-muted-foreground"
          )}
          title={item?.files.join("\n")}
        >
          {item && item.status !== "draft"
            ? statusLabel(item)
            : "Not implemented"}
        </span>
      </Row>
      {item?.tokens ? <TokensWaiting tokens={item.tokens} /> : null}
      {bound && item ? (
        <span
          className="truncate font-code text-muted-foreground"
          title={item.files.join("\n")}
        >
          {item.files.join(", ")}
        </span>
      ) : null}
      {changes ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-code text-muted-foreground">
          {changes}
        </pre>
      ) : null}
      <Button
        className="justify-start"
        onClick={() => implementPage(page)}
        size="sm"
        variant="outline"
      >
        <Code />
        {item?.status === "changed" && item.designChanged
          ? "Implement what changed"
          : "Implement in the application"}
      </Button>
      <div className="flex flex-wrap gap-1">
        {item?.status === "draft" || item === undefined ? (
          <Button
            onClick={() => setPageReady(page, true)}
            size="sm"
            variant="ghost"
          >
            Mark ready
          </Button>
        ) : null}
        <Button
          onClick={() => markImplemented(page.id, page.name, item?.files)}
          size="sm"
          variant="ghost"
        >
          {bound ? "Mark implemented again…" : "Mark implemented…"}
        </Button>
      </div>
    </div>
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
            className="truncate font-code text-muted-foreground"
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
      <Row label="Tint">
        <ColorField
          field="tint"
          {...shownAs(
            sharedOf(nodes, (n) => n.tint),
            "Its own colours"
          )}
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
