/**
 * What each context menu holds, as data: the items a target offers, which are there at all and
 * which are only greyed out, and what each does, as a typed action with its argument
 * (`{ kind: "wrap", in: "row" }`). Pure, over the facts read off the stores, so a menu can be
 * read — and tested — without an editor. `menu-actions.ts` reads the facts and runs the actions.
 */
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { isBound } from "@ultrapaint/contracts/implementation";
import type { ViewportPreset } from "@ultrapaint/contracts/pages";
import type { CodeFormat } from "@ultrapaint/contracts/rpc";
import { runLinks } from "@ultrapaint/design-document/text-runs";
import {
  isContainer,
  nodeKind,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import {
  type FrameRef,
  hasPrototypeLinks,
  pageOfRef,
  takesComments,
} from "../state/frame-ref.ts";
import type { Arrangement, Wrapper } from "./node-actions.ts";
import { viewportPresets } from "./presets.ts";

export interface Item<A> {
  /** What the item does, with what it does it with. */
  action: A;
  /** Marked as the current choice among its neighbours. */
  checked?: boolean;
  /** The editor's command it is, whose keys it shows (`commands.ts`). */
  command?: string;
  destructive?: boolean;
  disabled?: boolean;
  kind: "item";
  label: string;
}

/** The submenus, by what they gather: their icon is told by it. */
export type SubmenuId =
  | "arrange"
  /** An element's code, copied as JSX or HTML (ADR 0150). */
  | "code"
  | "copyTo"
  /** The layers under the point the menu was right-clicked at (ADR 0143). */
  | "layers"
  | "link"
  | "moveTo"
  | "preset"
  | "send"
  | "state"
  | "variant"
  | "wrap";

export type Entry<A = unknown> =
  | Item<A>
  | { kind: "separator" }
  | { kind: "label"; label: string }
  | {
      kind: "submenu";
      id: SubmenuId;
      label: string;
      disabled?: boolean;
      entries: readonly Entry<A>[];
    };

const item = <A>(
  action: A,
  label: string,
  more: Omit<Item<A>, "action" | "kind" | "label"> = {}
): Item<A> => ({ action, kind: "item", label, ...more });

const separator = { kind: "separator" } as const;

/** An item that runs one of the editor's commands, and shows its keys. */
interface CommandAction {
  /** The command's id in `commands.ts`. */
  id: string;
  kind: "command";
}

const commandItem = (
  id: string,
  label: string,
  more: Omit<Item<CommandAction>, "action" | "command" | "kind" | "label"> = {}
) => item({ id, kind: "command" } as const, label, { command: id, ...more });

/** No separator at either end, and never two in a row: optional items leave gaps. */
export const tidy = <A>(
  entries: readonly (Entry<A> | false | null)[]
): Entry<A>[] => {
  const out: Entry<A>[] = [];
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

/** The same menu, each action made another: bound to the target it acts on. */
export const mapActions = <A, B>(
  entries: readonly Entry<A>[],
  to: (action: A) => B
): Entry<B>[] =>
  entries.map((e): Entry<B> => {
    switch (e.kind) {
      case "item":
        return { ...e, action: to(e.action) };
      case "submenu":
        return { ...e, entries: mapActions(e.entries, to) };
      default:
        return e;
    }
  });

// ---- Nodes ----

export type NodeAction =
  | { kind: "ask"; newChat: boolean }
  /** Ask an agent's popover on the node, set to make variations of it (ADR 0098). */
  | { kind: "variations" }
  | { kind: "editText" }
  | { kind: "rename" }
  | { kind: "viewCode" }
  /** The element's code, the outermost of those it acts on, put on the clipboard (ADR 0150). */
  | { kind: "copyCode"; format: CodeFormat }
  | { kind: "comment" }
  | { kind: "makeApp" }
  /** An app component's instance: its component edited in place, or the instance detached from it (ADR 0041). */
  | { kind: "editComponent" }
  | { kind: "detach" }
  /** Leads to a page, by its file, or `back`; `null` takes the link away. */
  | { kind: "link"; to: string | null }
  /** Asks for a URL or another site to lead to. */
  | { kind: "linkUrl" }
  | { kind: "selectParent" }
  /** One of the layers under the point the menu was right-clicked at, selected alone (ADR 0143). */
  | { kind: "selectLayerUnder"; id: string }
  | { kind: "copyLink" }
  | { kind: "copyRef" }
  | { kind: "copy" }
  | { kind: "cut" }
  | { kind: "paste" }
  | { kind: "duplicate" }
  /** The node's look kept, and given to the nodes acted on (`style-clipboard.ts`). */
  | { kind: "copyStyle" }
  | { kind: "pasteStyle" }
  | { kind: "wrap"; in: Wrapper }
  | { kind: "unwrap" }
  | { kind: "arrange"; to: Arrangement }
  | { kind: "hide"; hidden: boolean }
  | { kind: "lock"; locked: boolean }
  | { kind: "zoomTo" }
  | { kind: "delete" };

/** A layer under the point a menu was right-clicked at, as Select layer lists it (ADR 0143). */
export interface LayerUnder {
  id: string;
  /** What the Layers panel calls it. */
  label: string;
  /** It is one of the selection. */
  selected: boolean;
}

export interface NodeFacts {
  /** Something copied that can be pasted. */
  canPaste: boolean;
  /** A style copied, which Paste style gives the nodes. */
  canPasteStyle: boolean;
  /**
   * How many nodes the menu acts on: the whole selection when the node is one of it, the node
   * alone otherwise. What is about one node only is greyed out for several.
   */
  count: number;
  /**
   * The frame it is in: a page's (or a view's) takes comments and links, and its nodes can be
   * made an app component; a board's (an app component's tree edited on it) has no code, link or
   * reference of its own, being generated (ADR 0045).
   */
  frame: FrameRef;
  /** Every node it acts on is hidden, so the item shows them; else it hides them all. */
  hidden: boolean;
  /** Where it sits among its siblings. */
  index: number;
  /**
   * The node is a layer of an app component's instance (ADR 0114), as the document resolves it:
   * its main component's to move, copy, detach or rename.
   */
  layer?: boolean;
  /**
   * The layers under the point the menu was right-clicked at, the deepest first and the frame's
   * root last (ADR 0143); none for a menu opened without a point (the keyboard, a Layers row).
   */
  layersUnder?: readonly LayerUnder[];
  /** The canvas's pages a link can lead to, by file; empty for a node beside the pages. */
  /** The routes, then the drafts (ADR 0075), which a link to gives a route first. */
  linkTargets?: readonly { draft?: boolean; name: string; path: string }[];
  /** The node clicked, or the one of the selection the inspector shows. */
  node: DesignNode;
  /** It is inside something other than a page's root, which Select parent goes to. */
  parentSelectable: boolean;
  siblings: number;
  /** The nodes can go into one new container: one node, or siblings. */
  wrappable: boolean;
}

/**
 * Where a node can lead in the prototype: a page, back, a URL or another site, or nowhere. Only
 * a node in a page has one: one beside the pages is never in the prototype, and a text whose
 * words link (ADR 0163) leads nowhere as a whole.
 */
const linkEntries = (f: NodeFacts): Entry<NodeAction> | false => {
  if (
    !hasPrototypeLinks(f.frame) ||
    f.node.type === "page" ||
    runLinks(f.node).length > 0
  ) {
    return false;
  }
  const { link } = f.node;
  const to = (target: string | null): NodeAction => ({
    kind: "link",
    to: target,
  });
  return {
    entries: tidy<NodeAction>([
      ...(f.linkTargets ?? [])
        .filter((p) => !p.draft)
        .map((p) => item(to(p.path), p.name, { checked: link === p.path })),
      (f.linkTargets ?? []).length > 0 && separator,
      ...(f.linkTargets ?? [])
        .filter((p) => p.draft)
        .map((p) =>
          item(to(p.path), `${p.name} (draft)`, { checked: link === p.path })
        ),
      (f.linkTargets ?? []).some((p) => p.draft) && separator,
      item(to("back"), "Back", { checked: link === "back" }),
      item({ kind: "linkUrl" }, "A URL or another site…"),
      link !== undefined && separator,
      link !== undefined && item(to(null), "Remove link"),
    ]),
    id: "link",
    kind: "submenu",
    label: link === undefined ? "Link to" : "Links to",
  };
};

/**
 * Select layer: every layer under the point the menu was right-clicked at, one pick away, the
 * selected ones ticked (ADR 0143). Not offered for a single layer, which is no choice.
 */
const layerEntries = (f: NodeFacts): Entry<NodeAction> | false => {
  const under = f.layersUnder ?? [];
  return (
    under.length > 1 && {
      entries: under.map((l) =>
        item({ id: l.id, kind: "selectLayerUnder" }, l.label, {
          checked: l.selected,
        })
      ),
      id: "layers",
      kind: "submenu",
      label: "Select layer",
    }
  );
};

/** The node's name and what it is, once when they are the same. */
const headingOf = (node: DesignNode) => {
  const label = nodeLabel(node);
  const kind = nodeKind(node);
  return label === kind ? label : `${label} · ${kind}`;
};

/** A page's root is the page: it is not copied, moved, deleted or duplicated as a node. */
export const isPageRoot = (node: DesignNode) => node.type === "page";

/**
 * The style system the copied code's classes are in, which the items name: Tailwind v4's is the
 * only one (ADR 0024).
 */
const CLASSES = "Tailwind classes";

/** The element's code to copy, in each format (ADR 0150). */
const copyCodeEntry: Entry<NodeAction> = {
  entries: [
    item({ format: "tsx", kind: "copyCode" }, `JSX with ${CLASSES}`),
    item({ format: "html", kind: "copyCode" }, `HTML with ${CLASSES}`),
  ],
  id: "code",
  kind: "submenu",
  label: "Copy as code",
};

/**
 * What a node's frame gives it: its code to view or copy, a comment and an app component made of
 * it on a page; the code alone beside the pages; none of them on a board, whose document is
 * generated.
 */
const frameEntries = (f: NodeFacts): (Entry<NodeAction> | false)[] => {
  const one = { disabled: f.count > 1 };
  return [
    f.frame.kind !== "board" && item({ kind: "viewCode" }, "View code", one),
    f.frame.kind !== "board" && copyCodeEntry,
    takesComments(f.frame) && item({ kind: "comment" }, "Comment on this", one),
    // Part of the page, siblings, made one of the project's own components (ADR 0041).
    pageOfRef(f.frame) !== null &&
      !isPageRoot(f.node) &&
      item({ kind: "makeApp" }, "Make an app component…", {
        disabled: !f.wrappable,
      }),
  ];
};

/** An instance's own: an app component's edited or detached. */
const instanceEntries = (f: NodeFacts): (Entry<NodeAction> | false)[] => {
  const { node } = f;
  if (node.type !== "instance") {
    return [];
  }
  const several = f.count > 1;
  const app = node.from === APP_FROM;
  return [
    app &&
      item({ kind: "editComponent" }, "Edit main component", {
        disabled: several,
      }),
    // A nested instance is detached in its main component, never on the page (ADR 0114).
    app && f.layer !== true && item({ kind: "detach" }, "Detach"),
  ];
};

/** Where the node is found again: a link to it and its reference; a board's has neither. */
const addressEntries = (f: NodeFacts): (Item<NodeAction> | false)[] => {
  const one = { disabled: f.count > 1 };
  return f.frame.kind === "board"
    ? []
    : [
        item({ kind: "copyLink" }, "Copy link to element", one),
        item({ kind: "copyRef" }, "Copy element ID", one),
      ];
};

/**
 * Copy, Cut, Paste and Duplicate, then Copy style and Paste style. A page's root and a layer of an
 * instance are copied as nodes neither (ADR 0114), and a layer is pasted into nowhere; a layer's
 * look is copied and pasted on the page too, and a page's root, the page, has neither (ADR 0075).
 */
const clipboardEntries = (f: NodeFacts): (Item<NodeAction> | false)[] => {
  const page = isPageRoot(f.node);
  const layer = f.layer === true;
  const root = page || layer;
  return [
    !root && item({ kind: "copy" }, "Copy", { command: "copy" }),
    !root && item({ kind: "cut" }, "Cut", { command: "cut" }),
    !layer &&
      item({ kind: "paste" }, "Paste", {
        command: "paste",
        disabled: !f.canPaste,
      }),
    !root && item({ kind: "duplicate" }, "Duplicate", { command: "duplicate" }),
    !page &&
      item({ kind: "copyStyle" }, "Copy style", { command: "copyStyle" }),
    !page &&
      item({ kind: "pasteStyle" }, "Paste style", {
        command: "pasteStyle",
        disabled: !f.canPasteStyle,
      }),
  ];
};

export const nodeEntries = (f: NodeFacts): Entry<NodeAction>[] => {
  const { node } = f;
  // A page's root, and a layer of an instance (ADR 0114), stay where they are: the layer is
  // moved, copied or made anything else in its main component.
  const layer = f.layer === true;
  const root = isPageRoot(node) || layer;
  const several = f.count > 1;
  // About one node only: greyed out when the menu acts on several.
  const one = { disabled: several };
  const first = f.index <= 0;
  const last = f.index >= f.siblings - 1;
  return tidy<NodeAction>([
    { kind: "label", label: several ? `${f.count} selected` : headingOf(node) },
    item({ kind: "ask", newChat: false }, "Add to chat"),
    item({ kind: "ask", newChat: true }, "Add to a new chat"),
    !layer && item({ kind: "variations" }, "Make variations…", one),
    node.type === "text" &&
      item({ kind: "editText" }, "Edit text", {
        ...one,
        command: "editText",
      }),
    !layer && item({ kind: "rename" }, "Rename…", one),
    ...(layer ? [] : frameEntries(f)),
    ...instanceEntries(f),
    linkEntries(f),
    f.parentSelectable &&
      item({ kind: "selectParent" }, "Select parent", {
        ...one,
        command: "escape",
      }),
    layerEntries(f),
    separator,
    ...addressEntries(f),
    separator,
    ...clipboardEntries(f),
    separator,
    !root && {
      disabled: !f.wrappable,
      entries: (
        [
          ["group", "Group"],
          ["row", "Row"],
          ["column", "Column"],
        ] as const
      ).map(([into, label]) =>
        item({ in: into, kind: "wrap" }, label, {
          command: `wrap:${into}`,
        })
      ),
      id: "wrap",
      kind: "submenu",
      label: "Wrap in",
    },
    !root && isContainer(node) && item({ kind: "unwrap" }, "Unwrap"),
    !root && {
      disabled: several || f.siblings < 2,
      entries: [
        item({ kind: "arrange", to: "up" }, "Move up", {
          disabled: first,
        }),
        item({ kind: "arrange", to: "down" }, "Move down", {
          disabled: last,
        }),
        item({ kind: "arrange", to: "top" }, "Move to the top", {
          disabled: first,
        }),
        item({ kind: "arrange", to: "bottom" }, "Move to the bottom", {
          disabled: last,
        }),
      ],
      id: "arrange",
      kind: "submenu",
      label: "Arrange",
    },
    item({ hidden: !f.hidden, kind: "hide" }, f.hidden ? "Show" : "Hide"),
    !root &&
      item(
        { kind: "lock", locked: !node.locked },
        node.locked ? "Unlock" : "Lock"
      ),
    item({ kind: "zoomTo" }, "Zoom to selection", {
      command: "zoomSelection",
    }),
    separator,
    // A layer of an instance is hidden there by Delete (ADR 0114).
    !isPageRoot(node) &&
      item(
        { kind: "delete" },
        several ? `Delete ${f.count} elements` : "Delete",
        { command: "delete", destructive: true }
      ),
  ]);
};

// ---- Pages ----

export type PageAction =
  | { kind: "goTo" }
  | { kind: "zoomTo" }
  | { kind: "paste" }
  | { kind: "preset"; preset: ViewportPreset }
  | { kind: "rename" }
  | { kind: "setUrl" }
  | { kind: "removeUrl" }
  | { kind: "duplicate" }
  /** Ask an agent's popover on the page, set to make variations of it (ADR 0098). */
  | { kind: "variations" }
  /** The page as it is copied as a new variation, put in use to be edited (ADR 0098). */
  | { kind: "newVariation" }
  /** Draws the page in a state of the canvas's, or in one asked for (`null`). */
  | { kind: "state"; state: string | null }
  /**
   * Copies or moves the pages into another canvas (`""` is the designs directory's own), or
   * into a new one asked for (`null`).
   */
  | { canvas: string | null; kind: "copyTo"; move: boolean }
  | { kind: "implement" }
  | { kind: "adopt" }
  /** Has an agent bring the pages up to date from their code (ADR 0115). */
  | { kind: "updateFromCode" }
  | { kind: "ready"; ready: boolean }
  | { kind: "readyAll" }
  | { kind: "markImplemented" }
  | { kind: "unlink" }
  | { kind: "comment" }
  | { kind: "copyLink" }
  | { kind: "delete" };

interface PageFacts {
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
}

/** Into another canvas, or a new one. */
const canvasTargets = (move: boolean, f: PageFacts): Entry<PageAction>[] =>
  tidy<PageAction>([
    ...f.canvases.map((c) =>
      item<PageAction>({ canvas: c.id, kind: "copyTo", move }, c.name)
    ),
    f.canvases.length > 0 && separator,
    item<PageAction>({ canvas: null, kind: "copyTo", move }, "New canvas…"),
  ]);

/** Whether the page is a base page, not a state's drawing of one. */
const isBasePage = (f: PageFacts) => f.state === undefined;

/** A base page drawn again: another way, as a variation (ADR 0098), or in a state (ADR 0030). */
const drawingEntries = (f: PageFacts): Entry<PageAction>[] =>
  isBasePage(f)
    ? [
        item<PageAction>({ kind: "newVariation" }, "New variation", {
          disabled: f.count > 1,
        }),
        {
          entries: tidy<PageAction>([
            ...f.statesFree.map((v) =>
              item<PageAction>({ kind: "state", state: v }, v)
            ),
            f.statesFree.length > 0 && separator,
            item<PageAction>({ kind: "state", state: null }, "New state…"),
          ]),
          id: "state",
          kind: "submenu",
          label: "Draw a state",
        },
      ]
    : [];

/**
 * The page and the code that implements it (ADR 0030); several pages picked, all of them at once:
 * marked ready, linked by an agent to the code that already implements them, or brought up to
 * date from it (ADR 0115).
 */
const codeEntries = (f: PageFacts): (Entry<PageAction> | false)[] => {
  if (f.count > 1) {
    return [
      item({ kind: "readyAll" }, `Mark ${f.count} pages ready to implement`),
      item(
        { kind: "adopt" },
        `Find the code of ${f.count} pages with an agent`
      ),
      item({ kind: "updateFromCode" }, `Update ${f.count} pages from code`),
    ];
  }
  const bound = isBound(f.implementation);
  return [
    item({ kind: "implement" }, "Implement with an agent"),
    !bound && item({ kind: "adopt" }, "Find its code with an agent"),
    // As the Code tab's ⋯ menu has it (ADR 0102): a page whose code changed has its button there.
    !bound && item({ kind: "updateFromCode" }, "Update from code"),
    f.implementation === "draft" &&
      item({ kind: "ready", ready: true }, "Mark ready to implement"),
    f.implementation === "ready" &&
      item({ kind: "ready", ready: false }, "Mark not ready"),
    item(
      { kind: "markImplemented" },
      bound ? "Mark implemented again…" : "Mark implemented…"
    ),
    bound && item({ kind: "unlink" }, "Unlink from its code"),
  ];
};

export const pageEntries = (f: PageFacts): Entry<PageAction>[] => {
  const pages = f.count === 1 ? "page" : `${f.count} pages`;
  return tidy<PageAction>([
    {
      kind: "label",
      label: `${f.name}${f.state ? ` · ${f.state}` : ""} · ${f.route ?? "draft"}`,
    },
    item({ kind: "goTo" }, f.route ? `Go to ${f.route}` : "Go to page"),
    f.onCanvas && item({ kind: "zoomTo" }, "Zoom to page"),
    f.onCanvas &&
      item({ kind: "paste" }, "Paste into page", {
        command: "paste",
        disabled: !f.canPaste,
      }),
    f.onCanvas && {
      entries: viewportPresets.map((p) =>
        item<PageAction>({ kind: "preset", preset: p.value }, p.label, {
          checked: f.preset === p.value,
        })
      ),
      id: "preset",
      kind: "submenu",
      label: "Viewport",
    },
    separator,
    isBasePage(f) && item({ kind: "rename" }, "Rename…"),
    item({ kind: "setUrl" }, f.route ? "Change route…" : "Give it a route…"),
    f.route !== undefined && item({ kind: "removeUrl" }, "Remove route"),
    item({ kind: "duplicate" }, "Duplicate page"),
    f.onCanvas &&
      item({ kind: "variations" }, "Make variations…", {
        disabled: f.count > 1,
      }),
    ...drawingEntries(f),
    {
      entries: canvasTargets(false, f),
      id: "copyTo",
      kind: "submenu",
      label: `Copy ${pages} to canvas`,
    },
    {
      entries: canvasTargets(true, f),
      id: "moveTo",
      kind: "submenu",
      label: `Move ${pages} to canvas`,
    },
    separator,
    ...codeEntries(f),
    f.onCanvas && item({ kind: "comment" }, "Add a comment"),
    item({ kind: "copyLink" }, "Copy link to page"),
    separator,
    item({ kind: "delete" }, "Delete page", { destructive: true }),
  ]);
};

// ---- Canvases ----

export type CanvasEntryAction =
  | { kind: "openCanvas" }
  | { kind: "rename" }
  | { kind: "duplicate" }
  | { kind: "duplicateWithAgent" }
  | { kind: "readyAll" }
  | { kind: "adopt" }
  | { kind: "updateFromCode" }
  /** Up (-1) or down (1) the list. */
  | { by: -1 | 1; kind: "move" }
  | { kind: "delete" };

interface CanvasEntryFacts {
  /** It is the one on screen. */
  current: boolean;
  first: boolean;
  last: boolean;
  /** The only canvas there is, which cannot be deleted. */
  only: boolean;
}

export const canvasListEntries = (
  f: CanvasEntryFacts
): Entry<CanvasEntryAction>[] =>
  tidy<CanvasEntryAction>([
    !f.current && item({ kind: "openCanvas" }, "Open"),
    item({ kind: "rename" }, "Rename…"),
    item({ kind: "duplicate" }, "Duplicate…"),
    item({ kind: "duplicateWithAgent" }, "Duplicate with an agent…"),
    separator,
    item({ kind: "readyAll" }, "Mark every page ready to implement"),
    item({ kind: "adopt" }, "Find the pages' code with an agent"),
    item({ kind: "updateFromCode" }, "Update its pages from code"),
    separator,
    item({ by: -1, kind: "move" }, "Move up", { disabled: f.first }),
    item({ by: 1, kind: "move" }, "Move down", { disabled: f.last }),
    separator,
    item({ kind: "delete" }, "Delete canvas…", {
      destructive: true,
      disabled: f.only,
    }),
  ]);

// ---- The canvas ----

/** Pastes or starts a comment at the point clicked; the rest are the editor's commands. */
export type CanvasAction =
  | { kind: "paste" }
  | { kind: "comment" }
  | CommandAction;

interface CanvasFacts {
  canPaste: boolean;
  commentsVisible: boolean;
  gridVisible: boolean;
}

export const canvasEntries = (f: CanvasFacts): Entry<CanvasAction>[] =>
  tidy<CanvasAction>([
    item({ kind: "paste" }, "Paste here", {
      command: "paste",
      disabled: !f.canPaste,
    }),
    item({ kind: "comment" }, "Add a comment"),
    separator,
    commandItem("newPage", "New page…"),
    commandItem("importFigma", "Import a Figma file…"),
    separator,
    commandItem("zoomFit", "Zoom to fit"),
    commandItem("zoom100", "Zoom to 100%"),
    separator,
    commandItem(
      "toggleComments",
      f.commentsVisible ? "Hide comments" : "Show comments"
    ),
    commandItem("grid", f.gridVisible ? "Hide grid" : "Show grid"),
    commandItem("tool:text", "Text tool"),
    commandItem("tool:group", "Group tool"),
  ]);

// ---- Comments ----

export type CommentAction =
  | { kind: "open" }
  | { kind: "selectElement" }
  | { kind: "resolve"; resolved: boolean }
  /** A behaviour note (ADR 0030), or a plain comment. */
  | { behaviour: boolean; kind: "note" }
  /** To the chat in use, by its id, or to a new one (`null`). */
  | { kind: "send"; threadId: string | null }
  | { kind: "copyText" }
  | { kind: "delete" };

interface CommentFacts {
  /** A behaviour note (ADR 0030) rather than talk about the design. */
  behaviour?: boolean;
  /** The chat in use, when there is one; `busy` while its agent works. */
  current: { busy: boolean; id: string; title: string } | null;
  /** It is pinned on an element, which can be selected. */
  hasElement: boolean;
  /** It is on a page, rather than the canvas itself, which is never implemented (ADR 0097). */
  onPage: boolean;
  resolved: boolean;
}

export const commentEntries = (f: CommentFacts): Entry<CommentAction>[] =>
  tidy<CommentAction>([
    item({ kind: "open" }, "Open"),
    f.hasElement && item({ kind: "selectElement" }, "Select the element"),
    item(
      { kind: "resolve", resolved: !f.resolved },
      f.resolved ? "Reopen" : "Resolve"
    ),
    (f.onPage || f.behaviour === true) &&
      item(
        { behaviour: !f.behaviour, kind: "note" },
        f.behaviour ? "Make it a plain comment" : "Make it a behaviour note"
      ),
    {
      entries: [
        item<CommentAction>(
          { kind: "send", threadId: f.current?.id ?? null },
          f.current ? `Current chat · ${f.current.title}` : "Current chat",
          { disabled: !f.current || f.current.busy }
        ),
        item<CommentAction>({ kind: "send", threadId: null }, "New chat"),
      ],
      id: "send",
      kind: "submenu",
      label: "Send to an agent",
    },
    item({ kind: "copyText" }, "Copy text"),
    separator,
    item({ kind: "delete" }, "Delete…", { destructive: true }),
  ]);

// ---- The Library ----

export type ComponentAction =
  | { kind: "insert" }
  | { kind: "insertCanvas" }
  | { kind: "openBoard" }
  | { kind: "implement" }
  | { kind: "updateFromCode" }
  | { kind: "copyName" }
  /** A system component's look started from its default, to edit. */
  | { kind: "takeOver" }
  /** A system component's own look taken away: it draws its default again. */
  | { kind: "resetLook" }
  /** An app component's file taken away. */
  | { kind: "delete" };

interface ComponentFacts {
  /** An app component; else a system component. */
  app: boolean;
  /** Its code changed since it was implemented: its board's menu offers Update from code too (ADR 0122). */
  codeChanged: boolean;
  name: string;
  onCanvas: boolean;
  /** A system component whose look the project made its own; an app component's is always. */
  ownLook: boolean;
  /** Where Insert puts it, as the Library says it: `the page`, `Card`; null when nowhere. */
  target: string | null;
}

/**
 * A component's menu, the same from its row in the Library (a right-click) and from its board's
 * "…" (ADR 0102): insert it, open its board, implement it or update it from its code (ADR 0122),
 * copy its name, and take its look over, reset it or delete it.
 */
export const componentEntries = (f: ComponentFacts): Entry<ComponentAction>[] =>
  tidy<ComponentAction>([
    item({ kind: "insert" }, f.target ? `Insert into ${f.target}` : "Insert", {
      disabled: f.target === null,
    }),
    f.onCanvas && item({ kind: "insertCanvas" }, "Insert on the canvas"),
    separator,
    item({ kind: "openBoard" }, "Open board"),
    item({ kind: "implement" }, "Implement"),
    f.codeChanged && item({ kind: "updateFromCode" }, "Update from code"),
    item({ kind: "copyName" }, `Copy ${f.name}`),
    separator,
    lastEntry(f),
  ]);

/** What a component's menu ends on: an app component deleted, a system component's look reset or taken over. */
const lastEntry = (f: ComponentFacts): Entry<ComponentAction> => {
  if (f.app) {
    return item({ kind: "delete" }, "Delete component", { destructive: true });
  }
  return f.ownLook
    ? item({ kind: "resetLook" }, "Reset to default look", {
        destructive: true,
      })
    : item({ kind: "takeOver" }, "Take the look over");
};

// ---- Threads ----

export type ThreadAction =
  | { kind: "open" }
  /** Follows it on the canvas, or stops. */
  | { follow: boolean; kind: "follow" }
  | { kind: "stop" }
  /** On a row of the list (ADR 0141): its title edited in place, or read as unread again. */
  | { kind: "rename" }
  | { kind: "markUnread" }
  | { kind: "delete" };

interface ThreadFacts {
  following: boolean;
  /** Opened on a row of the chat list, where Rename… and Mark unread apply. */
  inList: boolean;
  running: boolean;
  title: string;
}

export const threadEntries = (f: ThreadFacts): Entry<ThreadAction>[] =>
  tidy<ThreadAction>([
    { kind: "label", label: f.title },
    item({ kind: "open" }, "Open in chat"),
    item(
      { follow: !f.following, kind: "follow" },
      f.following ? "Stop following" : "Follow on the canvas"
    ),
    f.running && item({ kind: "stop" }, "Stop the turn"),
    f.inList && separator,
    f.inList && item({ kind: "rename" }, "Rename…"),
    f.inList && item({ kind: "markUnread" }, "Mark unread"),
    separator,
    item({ kind: "delete" }, "Delete thread…", { destructive: true }),
  ]);
