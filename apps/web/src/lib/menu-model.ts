/**
 * What each context menu holds, as data: the items a target offers, which are there at all and
 * which are only greyed out. Pure, over the facts the host reads off the stores, so a menu can
 * be read — and tested — without an editor. What an item does is `menu-actions.ts`'s.
 */
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { ViewportPreset } from "@ultrapaint/contracts/pages";
import {
  isContainer,
  nodeKind,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import type { MenuTokenKind } from "../state/context-menu.ts";
import { viewportPresets } from "./presets.ts";

export type Entry =
  | {
      kind: "item";
      /** What the item does; `wrap:row`, `apply:fill` and the like carry their argument. */
      id: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      destructive?: boolean;
      /** Marked as the current choice among its neighbours. */
      checked?: boolean;
    }
  | { kind: "separator" }
  | { kind: "label"; label: string }
  | {
      kind: "submenu";
      id: string;
      label: string;
      disabled?: boolean;
      entries: readonly Entry[];
    };

const item = (
  id: string,
  label: string,
  more: Omit<Extract<Entry, { kind: "item" }>, "kind" | "id" | "label"> = {}
): Entry => ({ id, kind: "item", label, ...more });

const separator: Entry = { kind: "separator" };

/** No separator at either end, and never two in a row: optional items leave gaps. */
export const tidy = (entries: readonly (Entry | false | null)[]): Entry[] => {
  const out: Entry[] = [];
  for (const e of entries) {
    if (!e) {
      continue;
    }
    if (
      e.kind === "separator" &&
      (out.length === 0 || out.at(-1)?.kind === "separator")
    ) {
      continue;
    }
    out.push(e);
  }
  if (out.at(-1)?.kind === "separator") {
    out.pop();
  }
  return out;
};

// ---- Nodes ----

export interface NodeFacts {
  /** Something copied that can be pasted. */
  canPaste: boolean;
  /**
   * How many nodes the menu acts on: the whole selection when the node is one of it, the node
   * alone otherwise. What is about one node only is greyed out for several.
   */
  count: number;
  /** Every node it acts on is hidden, so the item shows them; else it hides them all. */
  hidden: boolean;
  /** Where it sits among its siblings. */
  index: number;
  /** The canvas's pages a link can lead to, by file; empty for a node beside the pages. */
  linkTargets?: readonly { name: string; path: string }[];
  /** The node clicked, or the one of the selection the inspector shows. */
  node: DesignNode;
  /** The frame is a page, which is what comments are pinned on. */
  onPage: boolean;
  /** It is inside something other than a page's root, which Select parent goes to. */
  parentSelectable: boolean;
  siblings: number;
  /** The nodes can go into one new container: one node, or siblings. */
  wrappable: boolean;
}

/**
 * Where a node can lead in the prototype: a page (`link:<file>`), back, a URL or another site,
 * or nowhere. Only a node in a page has one: one beside the pages is never in the prototype.
 */
const linkEntries = (f: NodeFacts): Entry | false => {
  if (!f.onPage || f.node.type === "page") {
    return false;
  }
  const { link } = f.node;
  return {
    entries: tidy([
      ...(f.linkTargets ?? []).map((p) =>
        item(`link:${p.path}`, p.name, { checked: link === p.path })
      ),
      (f.linkTargets ?? []).length > 0 && separator,
      item("link:back", "Back", { checked: link === "back" }),
      item("link:url", "A URL or another site…"),
      link !== undefined && separator,
      link !== undefined && item("link:none", "Remove link"),
    ]),
    id: "link",
    kind: "submenu",
    label: link === undefined ? "Link to" : "Links to",
  };
};

/** The node's name and what it is, once when they are the same. */
const headingOf = (node: DesignNode) => {
  const label = nodeLabel(node);
  const kind = nodeKind(node);
  return label === kind ? label : `${label} · ${kind}`;
};

/** A page's root is the page: it is not copied, moved, deleted or duplicated as a node. */
export const isPageRoot = (node: DesignNode) => node.type === "page";

export const nodeEntries = (f: NodeFacts): Entry[] => {
  const { node } = f;
  const root = isPageRoot(node);
  const several = f.count > 1;
  // About one node only: greyed out when the menu acts on several.
  const one = { disabled: several };
  const first = f.index <= 0;
  const last = f.index >= f.siblings - 1;
  return tidy([
    { kind: "label", label: several ? `${f.count} selected` : headingOf(node) },
    item("ask", "Add to chat"),
    item("askNew", "Add to a new chat"),
    node.type === "text" &&
      item("editText", "Edit text", { ...one, shortcut: "⏎" }),
    item("rename", "Rename…", one),
    item("viewCode", "View code", one),
    f.onPage && item("comment", "Comment on this", one),
    // A part of the page made a component the code does not have yet (ADR 0029).
    f.onPage &&
      !root &&
      !(node.type === "instance" && node.from === "#draft") &&
      item("makeDraft", "Make a draft component…", one),
    linkEntries(f),
    f.parentSelectable &&
      item("selectParent", "Select parent", { ...one, shortcut: "Esc" }),
    separator,
    item("copyLink", "Copy link to element", one),
    item("copyRef", "Copy element ID", one),
    separator,
    !root && item("copy", "Copy", { shortcut: "⌘C" }),
    !root && item("cut", "Cut", { shortcut: "⌘X" }),
    item("paste", "Paste", { disabled: !f.canPaste, shortcut: "⌘V" }),
    !root && item("duplicate", "Duplicate", { shortcut: "⌘D" }),
    separator,
    !root && {
      disabled: !f.wrappable,
      entries: [
        item("wrap:group", "Group", { shortcut: "⌘G" }),
        item("wrap:row", "Row", { shortcut: "⌥⌘G" }),
        item("wrap:column", "Column", { shortcut: "⇧⌘G" }),
      ],
      id: "wrap",
      kind: "submenu",
      label: "Wrap in",
    },
    !root && isContainer(node) && item("unwrap", "Unwrap"),
    !root && {
      disabled: several || f.siblings < 2,
      entries: [
        item("arrange:up", "Move up", { disabled: first }),
        item("arrange:down", "Move down", { disabled: last }),
        item("arrange:top", "Move to the top", { disabled: first }),
        item("arrange:bottom", "Move to the bottom", { disabled: last }),
      ],
      id: "arrange",
      kind: "submenu",
      label: "Arrange",
    },
    item("toggleHidden", f.hidden ? "Show" : "Hide"),
    !root && item("toggleLocked", node.locked ? "Unlock" : "Lock"),
    item("zoomTo", "Zoom to selection", { shortcut: "⇧2" }),
    separator,
    !root &&
      item("delete", several ? `Delete ${f.count} elements` : "Delete", {
        destructive: true,
        shortcut: "⌫",
      }),
  ]);
};

// ---- Pages ----

export interface PageFacts {
  canPaste: boolean;
  /** The other canvases, which the page can be copied or moved into. */
  canvases: readonly { id: string; name: string }[];
  /** How many pages the menu acts on: the picked ones, when the page is one of them. */
  count: number;
  /** Where it stands with its code (ADR 0030). */
  implementation: "draft" | "ready" | "implemented" | "changed";
  name: string;
  /** The canvas is on screen: the prototype has no frames to zoom to. */
  onCanvas: boolean;
  preset: ViewportPreset | null;
  /** The URL it serves in the prototype; absent when it has none. */
  route?: string;
  /** The page's own state (ADR 0030); absent for a base page. */
  state?: string;
  /** The canvas's states the page has no drawing for yet. */
  statesFree: readonly string[];
  /** The page's own variant; absent for a base page. */
  variant?: string;
  /** The canvas's variants the page has no drawing for yet. */
  variantsFree: readonly string[];
}

/**
 * Into another canvas, or a new one: `copyTo:@<id>` (the root canvas is `copyTo:@`),
 * `copyTo:new`, and the same for a move.
 */
const canvasTargets = (verb: "copyTo" | "moveTo", f: PageFacts): Entry[] =>
  tidy([
    ...f.canvases.map((c) => item(`${verb}:@${c.id}`, c.name)),
    f.canvases.length > 0 && separator,
    item(`${verb}:new`, "New canvas…"),
  ]);

/** Whether the page is a base page, not a variant's or a state's drawing of one. */
const isBasePage = (f: PageFacts) =>
  f.variant === undefined && f.state === undefined;

/** A base page drawn again: for a variant of the prototype, or in a state (ADR 0030). */
const drawingEntries = (f: PageFacts): (Entry | false)[] =>
  isBasePage(f)
    ? [
        {
          entries: tidy([
            ...f.variantsFree.map((v) => item(`variant:${v}`, v)),
            f.variantsFree.length > 0 && separator,
            item("variant:new", "New variant…"),
          ]),
          id: "variant",
          kind: "submenu",
          label: "Draw a variant",
        },
        {
          entries: tidy([
            ...f.statesFree.map((v) => item(`state:${v}`, v)),
            f.statesFree.length > 0 && separator,
            item("state:new", "New state…"),
          ]),
          id: "state",
          kind: "submenu",
          label: "Draw a state",
        },
      ]
    : [];

/** The page and the code that implements it (ADR 0030). */
const codeEntries = (f: PageFacts): (Entry | false)[] => {
  const bound =
    f.implementation === "implemented" || f.implementation === "changed";
  return [
    item("implement", "Implement with an agent"),
    f.implementation === "draft" && item("ready", "Mark ready to implement"),
    f.implementation === "ready" && item("notReady", "Mark not ready"),
    item(
      "markImplemented",
      bound ? "Mark implemented again…" : "Mark implemented…"
    ),
    bound && item("unlink", "Unlink from its code"),
  ];
};

export const pageEntries = (f: PageFacts): Entry[] => {
  const pages = f.count === 1 ? "page" : `${f.count} pages`;
  return tidy([
    {
      kind: "label",
      label: `${f.name}${f.variant ? ` · ${f.variant}` : ""}${f.state ? ` · ${f.state}` : ""} · ${f.route ?? "no URL"}`,
    },
    item("goTo", f.route ? `Go to ${f.route}` : "Go to page"),
    f.onCanvas && item("zoomTo", "Zoom to page"),
    f.onCanvas &&
      item("paste", "Paste into page", {
        disabled: !f.canPaste,
        shortcut: "⌘V",
      }),
    f.onCanvas && {
      entries: viewportPresets.map((p) =>
        item(`preset:${p.value}`, p.label, { checked: f.preset === p.value })
      ),
      id: "preset",
      kind: "submenu",
      label: "Viewport",
    },
    separator,
    f.variant === undefined &&
      f.state === undefined &&
      item("rename", "Rename…"),
    item("setUrl", f.route ? "Change URL…" : "Set URL…"),
    f.route !== undefined && item("removeUrl", "Remove URL"),
    item("duplicate", "Duplicate page"),
    ...drawingEntries(f),
    {
      entries: canvasTargets("copyTo", f),
      id: "copyTo",
      kind: "submenu",
      label: `Copy ${pages} to canvas`,
    },
    {
      entries: canvasTargets("moveTo", f),
      id: "moveTo",
      kind: "submenu",
      label: `Move ${pages} to canvas`,
    },
    separator,
    ...codeEntries(f),
    f.onCanvas && item("comment", "Add a comment"),
    separator,
    item("delete", "Delete page…", { destructive: true }),
  ]);
};

// ---- Canvases ----

export interface CanvasEntryFacts {
  /** It is the one on screen. */
  current: boolean;
  first: boolean;
  last: boolean;
  /** The only canvas there is, which cannot be deleted. */
  only: boolean;
}

export const canvasListEntries = (f: CanvasEntryFacts): Entry[] =>
  tidy([
    !f.current && item("openCanvas", "Open"),
    item("rename", "Rename…"),
    item("duplicate", "Duplicate…"),
    item("duplicateWithAgent", "Duplicate with an agent…"),
    item("componentSheet", "Draw the components with an agent"),
    separator,
    item("moveUp", "Move up", { disabled: f.first }),
    item("moveDown", "Move down", { disabled: f.last }),
    separator,
    item("delete", "Delete canvas…", {
      destructive: true,
      disabled: f.only,
    }),
  ]);

// ---- The canvas ----

export interface CanvasFacts {
  canPaste: boolean;
  commentsVisible: boolean;
  gridVisible: boolean;
}

export const canvasEntries = (f: CanvasFacts): Entry[] =>
  tidy([
    item("paste", "Paste here", { disabled: !f.canPaste, shortcut: "⌘V" }),
    separator,
    item("newPage", "New page…"),
    item("importFigma", "Import a Figma file…"),
    separator,
    item("zoomFit", "Zoom to fit", { shortcut: "⇧1" }),
    item("zoom100", "Zoom to 100%", { shortcut: "⇧0" }),
    separator,
    item(
      "toggleComments",
      f.commentsVisible ? "Hide comments" : "Show comments",
      { shortcut: "⇧C" }
    ),
    item("toggleGrid", f.gridVisible ? "Hide grid" : "Show grid", {
      shortcut: "⌘'",
    }),
    item("tool:text", "Text tool", { shortcut: "T" }),
    item("tool:group", "Group tool", { shortcut: "G" }),
  ]);

// ---- Comments ----

export interface CommentFacts {
  /** A behaviour note (ADR 0030) rather than talk about the design. */
  behaviour?: boolean;
  /** The chat in use, when there is one; `busy` while its agent works. */
  current: { busy: boolean; title: string } | null;
  /** It is pinned on an element, which can be selected. */
  hasElement: boolean;
  resolved: boolean;
}

export const commentEntries = (f: CommentFacts): Entry[] =>
  tidy([
    item("open", "Open"),
    f.hasElement && item("selectElement", "Select the element"),
    item("resolve", f.resolved ? "Reopen" : "Resolve"),
    item(
      "kind",
      f.behaviour ? "Make it a plain comment" : "Make it a behaviour note"
    ),
    {
      entries: [
        item(
          "send:current",
          f.current ? `Current chat · ${f.current.title}` : "Current chat",
          { disabled: !f.current || f.current.busy }
        ),
        item("send:new", "New chat"),
      ],
      id: "send",
      kind: "submenu",
      label: "Send to an agent",
    },
    item("copyText", "Copy text"),
    separator,
    item("delete", "Delete…", { destructive: true }),
  ]);

// ---- Tokens ----

/** A field of a node a token can go in, and what the item says. */
export interface TokenField {
  field:
    | "border.color"
    | "border.width"
    | "color"
    | "fill"
    | "font"
    | "gap"
    | "margin"
    | "maxWidth"
    | "minWidth"
    | "padding"
    | "radius"
    | "shadow"
    | "size";
  label: string;
}

const hasGap = (node: DesignNode) =>
  node.type === "page" || node.type === "row" || node.type === "column";

/** The fields of this node a token of this kind fits. */
export const tokenFields = (
  kind: MenuTokenKind,
  node: DesignNode | null
): TokenField[] => {
  if (!node) {
    return [];
  }
  const text = node.type === "text";
  switch (kind) {
    case "color":
      return [
        { field: "fill", label: "Fill" },
        ...(text ? [{ field: "color", label: "Text colour" } as const] : []),
        { field: "border.color", label: "Border colour" },
      ];
    case "font":
      return text ? [{ field: "font", label: "Font" }] : [];
    case "radius":
      return [{ field: "radius", label: "Radius" }];
    case "shadow":
      return [{ field: "shadow", label: "Shadow" }];
    case "borderWidth":
      return [{ field: "border.width", label: "Border width" }];
    case "container":
      return [
        { field: "maxWidth", label: "Max width" },
        { field: "minWidth", label: "Min width" },
      ];
    case "fontSize":
      return text ? [{ field: "size", label: "Font size" }] : [];
    case "spacing":
      return [
        ...(hasGap(node) ? [{ field: "gap", label: "Gap" } as const] : []),
        { field: "padding", label: "Padding" },
        { field: "margin", label: "Margin" },
      ];
    default:
      return [];
  }
};

/** The fields every one of these nodes has that a token of this kind fits. */
export const sharedTokenFields = (
  kind: MenuTokenKind,
  nodes: readonly DesignNode[]
): TokenField[] => {
  const [first, ...rest] = nodes;
  const others = rest.map((n) => tokenFields(kind, n).map((t) => t.field));
  return tokenFields(kind, first ?? null).filter((t) =>
    others.every((fields) => fields.includes(t.field))
  );
};

/** What a token or a text style is applied to: the node selected, or how many are. */
const appliedTo = (selected: readonly DesignNode[], none: string) => {
  const [first] = selected;
  if (!first) {
    return none;
  }
  return selected.length === 1
    ? `Apply to ${nodeLabel(first)}`
    : `Apply to ${selected.length} elements`;
};

export interface TokenFacts {
  kind: MenuTokenKind;
  name: string;
  /** What is selected, which is what the token is applied to. */
  selected: readonly DesignNode[];
  value: string;
}

export const tokenEntries = (f: TokenFacts): Entry[] => {
  const fields = sharedTokenFields(f.kind, f.selected);
  return tidy([
    item("copyRef", `Copy $${f.name}`),
    item("copyValue", `Copy ${f.value}`),
    // The value is the code's (ADR 0025): it is changed where the code declares it.
    item("edit", "Edit the value in the code…"),
    separator,
    {
      disabled: fields.length === 0,
      entries: fields.map((t) => item(`apply:${t.field}`, t.label)),
      id: "apply",
      kind: "submenu",
      label: appliedTo(f.selected, "Apply to the selection"),
    },
  ]);
};

export const textStyleEntries = (f: {
  name: string;
  /** What is selected, which the style is applied to when every one of it is text. */
  selected: readonly DesignNode[];
}): Entry[] => {
  const texts =
    f.selected.length > 0 && f.selected.every((n) => n.type === "text");
  return [
    item(
      "apply:textStyle",
      appliedTo(texts ? f.selected : [], "Apply to the selected text"),
      { disabled: !texts }
    ),
    item("copyName", `Copy ${f.name}`),
  ];
};

// ---- The Assets panel ----

export interface ComponentFacts {
  isComponent: boolean;
  name: string;
  onCanvas: boolean;
  /** Where Insert puts it, as the Assets panel says it: `the page`, `Card`; null when nowhere. */
  target: string | null;
}

export const componentEntries = (f: ComponentFacts): Entry[] =>
  tidy([
    item("insert", f.target ? `Insert into ${f.target}` : "Insert", {
      disabled: f.target === null,
    }),
    f.onCanvas && item("insertCanvas", "Insert on the canvas"),
    f.isComponent && separator,
    f.isComponent && item("copyName", `Copy ${f.name}`),
  ]);

// ---- Threads ----

export interface ThreadFacts {
  following: boolean;
  running: boolean;
  title: string;
}

export const threadEntries = (f: ThreadFacts): Entry[] =>
  tidy([
    { kind: "label", label: f.title },
    item("open", "Open in chat"),
    item("follow", f.following ? "Stop following" : "Follow on the canvas"),
    f.running && item("stop", "Stop the turn"),
    separator,
    item("delete", "Delete thread…", { destructive: true }),
  ]);
