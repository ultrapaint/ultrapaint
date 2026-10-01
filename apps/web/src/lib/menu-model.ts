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
import type { TokenKind } from "../state/context-menu.ts";

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

/** The node's name and what it is, once when they are the same. */
const headingOf = (node: DesignNode) => {
  const label = nodeLabel(node);
  const kind = nodeKind(node);
  return label === kind ? label : `${label} · ${kind}`;
};

/** A page's root is the page: it is not copied, moved or deleted as a node. */
const isPageRoot = (node: DesignNode) => node.type === "page";

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
  name: string;
  /** The canvas is on screen: the prototype has no frames to zoom to. */
  onCanvas: boolean;
  preset: ViewportPreset | null;
  /** The URL it serves in the prototype; absent when it has none. */
  route?: string;
  /** The page's own variant; absent for a base page. */
  variant?: string;
  /** The canvas's variants the page has no drawing for yet. */
  variantsFree: readonly string[];
}

export const PRESETS: readonly { label: string; value: ViewportPreset }[] = [
  { label: "Mobile", value: "mobile" },
  { label: "Tablet", value: "tablet" },
  { label: "Desktop", value: "desktop" },
];

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

export const pageEntries = (f: PageFacts): Entry[] => {
  const pages = f.count === 1 ? "page" : `${f.count} pages`;
  return tidy([
    {
      kind: "label",
      label: `${f.name}${f.variant ? ` · ${f.variant}` : ""} · ${f.route ?? "no URL"}`,
    },
    item("goTo", f.route ? `Go to ${f.route}` : "Go to page"),
    f.onCanvas && item("zoomTo", "Zoom to page"),
    f.onCanvas &&
      item("paste", "Paste into page", {
        disabled: !f.canPaste,
        shortcut: "⌘V",
      }),
    f.onCanvas && {
      entries: PRESETS.map((p) =>
        item(`preset:${p.value}`, p.label, { checked: f.preset === p.value })
      ),
      id: "preset",
      kind: "submenu",
      label: "Viewport",
    },
    separator,
    f.variant === undefined && item("rename", "Rename…"),
    item("setUrl", f.route ? "Change URL…" : "Set URL…"),
    f.route !== undefined && item("removeUrl", "Remove URL"),
    item("duplicate", "Duplicate page"),
    f.variant === undefined && {
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
    item("implement", "Implement with an agent"),
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
    item("tool:text", "Text tool", { shortcut: "T" }),
    item("tool:group", "Group tool", { shortcut: "G" }),
  ]);

// ---- Comments ----

export interface CommentFacts {
  /** The session in use, when there is one; `busy` while its agent works. */
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
    {
      entries: [
        item(
          "send:current",
          f.current
            ? `Current session · ${f.current.title}`
            : "Current session",
          { disabled: !f.current || f.current.busy }
        ),
        item("send:new", "New thread"),
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
    | "color"
    | "fill"
    | "font"
    | "gap"
    | "margin"
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
  kind: TokenKind,
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
    case "size":
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
  kind: TokenKind,
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
  kind: TokenKind;
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

// ---- The palette ----

export interface ComponentFacts {
  isComponent: boolean;
  name: string;
  onCanvas: boolean;
  /** Where Insert puts it, as the palette says it: `the page`, `Card`; null when nowhere. */
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
