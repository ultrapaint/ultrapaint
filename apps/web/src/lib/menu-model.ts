/**
 * What each context menu holds, as data: the items a target offers, which are there at all and
 * which are only greyed out, and what each does, as a typed action with its argument
 * (`{ kind: "wrap", in: "row" }`). Pure, over the facts read off the stores, so a menu can be
 * read — and tested — without an editor. `menu-actions.ts` reads the facts and runs the actions.
 */
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { ViewportPreset } from "@ultrapaint/contracts/pages";
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
  | "copyTo"
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
  | { kind: "editText" }
  | { kind: "rename" }
  | { kind: "viewCode" }
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
  | { kind: "copyLink" }
  | { kind: "copyRef" }
  | { kind: "copy" }
  | { kind: "cut" }
  | { kind: "paste" }
  | { kind: "duplicate" }
  | { kind: "wrap"; in: Wrapper }
  | { kind: "unwrap" }
  | { kind: "arrange"; to: Arrangement }
  | { kind: "hide"; hidden: boolean }
  | { kind: "lock"; locked: boolean }
  | { kind: "zoomTo" }
  | { kind: "delete" };

export interface NodeFacts {
  /** Something copied that can be pasted. */
  canPaste: boolean;
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
  /** The canvas's pages a link can lead to, by file; empty for a node beside the pages. */
  linkTargets?: readonly { name: string; path: string }[];
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
 * a node in a page has one: one beside the pages is never in the prototype.
 */
const linkEntries = (f: NodeFacts): Entry<NodeAction> | false => {
  if (!hasPrototypeLinks(f.frame) || f.node.type === "page") {
    return false;
  }
  const { link } = f.node;
  const to = (target: string | null): NodeAction => ({
    kind: "link",
    to: target,
  });
  return {
    entries: tidy<NodeAction>([
      ...(f.linkTargets ?? []).map((p) =>
        item(to(p.path), p.name, { checked: link === p.path })
      ),
      (f.linkTargets ?? []).length > 0 && separator,
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

/** The node's name and what it is, once when they are the same. */
const headingOf = (node: DesignNode) => {
  const label = nodeLabel(node);
  const kind = nodeKind(node);
  return label === kind ? label : `${label} · ${kind}`;
};

/** A page's root is the page: it is not copied, moved, deleted or duplicated as a node. */
export const isPageRoot = (node: DesignNode) => node.type === "page";

/**
 * What a node's frame gives it: its code, a comment and an app component made of it on a page;
 * the code alone beside the pages; none of them on a board, whose document is generated.
 */
const frameEntries = (f: NodeFacts): (Item<NodeAction> | false)[] => {
  const one = { disabled: f.count > 1 };
  return [
    f.frame.kind !== "board" && item({ kind: "viewCode" }, "View code", one),
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
      item({ kind: "editComponent" }, "Edit component", {
        disabled: several,
      }),
    app && item({ kind: "detach" }, "Detach"),
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

export const nodeEntries = (f: NodeFacts): Entry<NodeAction>[] => {
  const { node } = f;
  const root = isPageRoot(node);
  const several = f.count > 1;
  // About one node only: greyed out when the menu acts on several.
  const one = { disabled: several };
  const first = f.index <= 0;
  const last = f.index >= f.siblings - 1;
  return tidy<NodeAction>([
    { kind: "label", label: several ? `${f.count} selected` : headingOf(node) },
    item({ kind: "ask", newChat: false }, "Add to chat"),
    item({ kind: "ask", newChat: true }, "Add to a new chat"),
    node.type === "text" &&
      item({ kind: "editText" }, "Edit text", {
        ...one,
        command: "editText",
      }),
    item({ kind: "rename" }, "Rename…", one),
    ...frameEntries(f),
    ...instanceEntries(f),
    linkEntries(f),
    f.parentSelectable &&
      item({ kind: "selectParent" }, "Select parent", {
        ...one,
        command: "escape",
      }),
    separator,
    ...addressEntries(f),
    separator,
    !root && item({ kind: "copy" }, "Copy", { command: "copy" }),
    !root && item({ kind: "cut" }, "Cut", { command: "cut" }),
    item({ kind: "paste" }, "Paste", {
      command: "paste",
      disabled: !f.canPaste,
    }),
    !root && item({ kind: "duplicate" }, "Duplicate", { command: "duplicate" }),
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
    !root &&
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
  /** Draws the page for a variant of the canvas's, or for one asked for (`null`). */
  | { kind: "variant"; variant: string | null }
  /** Draws the page in a state of the canvas's, or in one asked for (`null`). */
  | { kind: "state"; state: string | null }
  /**
   * Copies or moves the pages into another canvas (`""` is the designs directory's own), or
   * into a new one asked for (`null`).
   */
  | { canvas: string | null; kind: "copyTo"; move: boolean }
  | { kind: "implement" }
  | { kind: "adopt" }
  | { kind: "ready"; ready: boolean }
  | { kind: "readyAll" }
  | { kind: "markImplemented" }
  | { kind: "unlink" }
  | { kind: "comment" }
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
  /** The page's own variant; absent for a base page. */
  variant?: string;
  /** The canvas's variants the page has no drawing for yet. */
  variantsFree: readonly string[];
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

/** Whether the page is a base page, not a variant's or a state's drawing of one. */
const isBasePage = (f: PageFacts) =>
  f.variant === undefined && f.state === undefined;

/** A base page drawn again: for a variant of the prototype, or in a state (ADR 0030). */
const drawingEntries = (f: PageFacts): Entry<PageAction>[] =>
  isBasePage(f)
    ? [
        {
          entries: tidy<PageAction>([
            ...f.variantsFree.map((v) =>
              item<PageAction>({ kind: "variant", variant: v }, v)
            ),
            f.variantsFree.length > 0 && separator,
            item<PageAction>(
              { kind: "variant", variant: null },
              "New variant…"
            ),
          ]),
          id: "variant",
          kind: "submenu",
          label: "Draw a variant",
        },
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
 * marked ready, or linked by an agent to the code that already implements them.
 */
const codeEntries = (f: PageFacts): (Entry<PageAction> | false)[] => {
  if (f.count > 1) {
    return [
      item({ kind: "readyAll" }, `Mark ${f.count} pages ready to implement`),
      item(
        { kind: "adopt" },
        `Find the code of ${f.count} pages with an agent`
      ),
    ];
  }
  const bound =
    f.implementation === "implemented" || f.implementation === "changed";
  return [
    item({ kind: "implement" }, "Implement with an agent"),
    !bound && item({ kind: "adopt" }, "Find its code with an agent"),
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
      label: `${f.name}${f.variant ? ` · ${f.variant}` : ""}${f.state ? ` · ${f.state}` : ""} · ${f.route ?? "no URL"}`,
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
    item({ kind: "setUrl" }, f.route ? "Change URL…" : "Set URL…"),
    f.route !== undefined && item({ kind: "removeUrl" }, "Remove URL"),
    item({ kind: "duplicate" }, "Duplicate page"),
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
    separator,
    item({ kind: "delete" }, "Delete page…", { destructive: true }),
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

/** Pastes at the point clicked; the rest are the editor's commands. */
export type CanvasAction = { kind: "paste" } | CommandAction;

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
  | { kind: "copyName" };

interface ComponentFacts {
  name: string;
  onCanvas: boolean;
  /** Where Insert puts it, as the Library says it: `the page`, `Card`; null when nowhere. */
  target: string | null;
}

export const componentEntries = (f: ComponentFacts): Entry<ComponentAction>[] =>
  tidy<ComponentAction>([
    item({ kind: "insert" }, f.target ? `Insert into ${f.target}` : "Insert", {
      disabled: f.target === null,
    }),
    f.onCanvas && item({ kind: "insertCanvas" }, "Insert on the canvas"),
    separator,
    item({ kind: "copyName" }, `Copy ${f.name}`),
  ]);

// ---- Threads ----

export type ThreadAction =
  | { kind: "open" }
  /** Follows it on the canvas, or stops. */
  | { follow: boolean; kind: "follow" }
  | { kind: "stop" }
  | { kind: "delete" };

interface ThreadFacts {
  following: boolean;
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
    separator,
    item({ kind: "delete" }, "Delete thread…", { destructive: true }),
  ]);
