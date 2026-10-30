// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type {
  AppliedChanges,
  ApplyInput,
  DesignNode,
  DocumentState,
} from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import type { Thread } from "@ultrapaint/contracts/threads";
import { applyOps } from "@ultrapaint/design-document/ops";
import { canvasDocOf, canvasOfDoc } from "@ultrapaint/design-document/tree";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "../state/agents.ts";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useComments } from "../state/comments.ts";
import { useComponents } from "../state/components.ts";
import type { MenuTarget } from "../state/context-menu.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useImplementation } from "../state/implementation.ts";
import { useIsolation } from "../state/isolation.ts";
import { usePagePicks } from "../state/page-picks.ts";
import { usePanels } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { useClipboard } from "./clipboard.ts";
import { commandList } from "./commands.ts";
import {
  type MenuAction,
  type MenuEntry,
  menuFor,
  runMenuAction,
} from "./menu-actions.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** What the dialogs answer: a name typed, a deletion confirmed. */
const answers = vi.hoisted(() => ({
  confirm: true,
  prompt: "Typed" as string | null,
}));

vi.mock("../components/dialogs.tsx", async (original) => ({
  ...(await original<typeof import("../components/dialogs.tsx")>()),
  confirmDialog: () => Promise.resolve(answers.confirm),
  promptDialog: () => Promise.resolve(answers.prompt),
}));

const HOME = "home.page.json";
const ABOUT = "about.page.json";
const BOLD = "home@bold.page.json";
/** A view of the home page at 800 px: `md`, of the default breakpoints. */
const TABLET = `${HOME}#tablet`;
const CANVAS = canvasDocOf("main");

const text = (id: string, extra: Partial<DesignNode> = {}): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text", ...extra }) as DesignNode;

const stateOf = (doc: string, root: DesignNode): DocumentState => ({
  doc,
  hash: `${doc}@0`,
  root,
});

const page = (path: string, name: string, more: Partial<Page> = {}): Page => ({
  canvas: "main",
  file: `designs/main/${path}`,
  id: path,
  name,
  path,
  ...more,
});

const thread = {
  agentId: "claude",
  createdAt: 0,
  id: "t1",
  status: "idle",
  title: "Work",
} as unknown as Thread;

let ids = 0;
/** Each state the fake server answers with has a hash of its own. */
let versions = 0;

/** The server's side of `documents.apply`: the operations applied to the documents the editor has. */
const serve = () =>
  fakeApi.respond("documents.apply", (input: ApplyInput): AppliedChanges => {
    const states = new Map<string, DocumentState>();
    const created: string[] = [];
    for (const { doc, ops } of input.edits) {
      const before = states.get(doc) ?? useDocuments.getState().docs[doc];
      if (!before?.root) {
        throw new Error(`no document ${doc}`);
      }
      const applied = applyOps(before.root, ops, {
        canvas: canvasOfDoc(doc) !== null,
        next: (prefix = "n") => {
          ids += 1;
          return `${prefix}_${ids}`;
        },
      });
      created.push(...applied.created);
      versions += 1;
      states.set(doc, { doc, hash: `${doc}@${versions}`, root: applied.root });
    }
    return { changes: [...states.values()], created };
  });

/** The requests of a method, their inputs in order. */
const sent = (method: string) =>
  fakeApi.calls.filter((c) => c.method === method).map((c) => c.input);

/** The operations of the last change to the documents, and its label. */
const lastEdit = () => {
  const input = sent("documents.apply").at(-1) as ApplyInput | undefined;
  return {
    label: input?.label,
    ops: input?.edits.flatMap((e) =>
      e.ops.map((op) => ({ doc: e.doc, ...op }))
    ),
  };
};

/** What the editor reads of the project, which a test leaves alone: as it was. */
const READS = ["project.info", "logs.recent", "edit.state"];

/** The project as the server tells it again after a change. */
const serveProject = () => {
  fakeApi.respond("project.info", () => {
    const { info, settings } = useProject.getState();
    return { ...info, ...(settings && { settings }) };
  });
  fakeApi.respond("pages.list", () => {
    const { canvases, pages } = useProject.getState();
    return { canvases, pages };
  });
};

const initial = useEditor.getState();

const setUp = () => {
  fakeApi.reset();
  serve();
  serveProject();
  answers.confirm = true;
  answers.prompt = "Typed";
  useClipboard.setState({ nodes: [] });
  usePagePicks.setState({ ids: [] });
  useCanvasGrid.setState({ visible: false });
  usePanels.setState({ left: false, right: true });
  useProject.setState({
    canvases: [
      {
        home: "/",
        id: "main",
        name: "Main",
        states: ["empty"],
        variants: ["bold", "dark"],
      },
      { home: "/", id: "", name: "App", variants: [] },
    ],
    info: {
      configured: true,
      storage: { mode: "managed" },
    },
    pages: [
      page(HOME, "Home", { route: "/" }),
      page(ABOUT, "About"),
      page(BOLD, "Home", { route: "/", variant: "bold" }),
    ],
  });
  useEditor.setState(initial, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [ABOUT]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 1200 },
      // Below the first breakpoint, so its edits are the nodes' own fields.
      [HOME]: {
        height: 900,
        preset: "mobile",
        views: [{ height: 900, id: "tablet", width: 800, x: 600, y: 0 }],
        width: 390,
        x: 0,
        y: 0,
      },
      [TABLET]: { height: 900, preset: "custom", width: 800, x: 600, y: 0 },
    },
    workspace: "design",
  });
  useDocuments.setState({
    canvas: "main",
    docs: {
      [ABOUT]: stateOf(ABOUT, {
        children: [text("intro")],
        id: "about",
        type: "page",
      }),
      [CANVAS]: stateOf(CANVAS, {
        children: [{ ...text("note"), x: 2000, y: 1500 }],
        id: "canvas",
        type: "group",
      }),
      [HOME]: stateOf(HOME, {
        children: [
          {
            children: [text("title"), text("lede"), text("cta")],
            id: "hero",
            type: "column",
          },
          // An instance of one of the project's own components.
          { component: "Promo", from: "#app", id: "promo", type: "instance" },
        ],
        id: "home",
        type: "page",
      }),
    },
    loaded: true,
  });
  useComments.setState({
    comments: [
      {
        author: null,
        createdAt: 0,
        element: "title",
        id: "c1",
        kind: "comment",
        nodeId: "title",
        page: HOME,
        replies: [],
        resolved: false,
        text: "Bigger",
        updatedAt: 0,
        x: 10,
        y: 10,
      },
    ],
    visible: true,
  });
  useAgents.setState({ current: null, following: null, threads: [thread] });
  useComponents.setState({
    components: [
      {
        name: "Promo",
        origin: "app",
        properties: [],
        slots: [],
        tree: { children: [text("sale")], id: "p-root", type: "column" },
        version: 1,
      },
    ],
  });
  useIsolation.setState({ isolated: null });
};

beforeEach(setUp);

const nodeAt = (frame: string, nodeId: string): MenuTarget => ({
  frame,
  kind: "node",
  nodeId,
});

const homePage: MenuTarget = { kind: "page", pageId: HOME };

type Act = Record<string, unknown>;

/** Every item of a menu, a submenu's among them. */
const itemsOf = (entries: readonly MenuEntry[]): MenuEntry[] =>
  entries.flatMap((e) => {
    if (e.kind === "submenu") {
      return itemsOf(e.entries);
    }
    return e.kind === "item" ? [e] : [];
  });

/** The item of the menu whose action is the one described: every field said is as said. */
const itemOf = (target: MenuTarget, what: Act) => {
  const found = itemsOf(menuFor(target) ?? []).find(
    (e) =>
      e.kind === "item" &&
      Object.entries(what).every(
        ([key, value]) => (e.action.act as Act)[key] === value
      )
  );
  if (found?.kind !== "item") {
    throw new Error(`no item ${JSON.stringify(what)}`);
  }
  return found;
};

/** Runs the item of the target's menu, as a click on it does, and waits for what it sent. */
const choose = async (target: MenuTarget, what: Act) => {
  await runMenuAction(itemOf(target, what).action);
};

const labels = (entries: readonly MenuEntry[] | undefined) =>
  (entries ?? []).map((e) => ("label" in e ? e.label : e.kind));

const submenu = (target: MenuTarget, id: string) => {
  const found = menuFor(target)?.find(
    (e) => e.kind === "submenu" && e.id === id
  );
  return found?.kind === "submenu" ? found : undefined;
};

const selected = () => {
  const { also, selection } = useEditor.getState();
  return selection ? [selection, ...also] : [];
};

describe("a node's menu", () => {
  it("is read off the stores: the node, its siblings, the pages it can lead to", () => {
    const title = nodeAt(HOME, "title");
    expect(itemOf(title, { kind: "editText" }).label).toBe("Edit text");
    // The variant's drawing of Home is not a page of its own to lead to.
    expect(labels(submenu(title, "link")?.entries)).toEqual([
      "About",
      "Home",
      "separator",
      "Back",
      "A URL or another site…",
    ]);
    expect(itemOf(title, { kind: "arrange", to: "up" }).disabled).toBe(true);
    expect(itemOf(title, { kind: "arrange", to: "down" }).disabled).toBe(false);
    expect(itemOf(title, { kind: "paste" }).disabled).toBe(true);
  });

  it("changes the node it was opened on, each item as one request", async () => {
    const title = nodeAt(HOME, "title");
    await choose(title, { kind: "hide" });
    expect(lastEdit()).toEqual({
      label: "Hide",
      ops: [{ doc: HOME, id: "title", op: "update", set: { hidden: true } }],
    });
    // The menu reads the node again: it is hidden, so it shows it.
    expect(itemOf(title, { hidden: false, kind: "hide" }).label).toBe("Show");

    await choose(title, { kind: "link", to: ABOUT });
    expect(lastEdit()).toEqual({
      label: "Link",
      ops: [{ doc: HOME, id: "title", op: "update", set: { link: ABOUT } }],
    });
    expect(itemOf(title, { kind: "link", to: ABOUT }).checked).toBe(true);
    await choose(title, { kind: "link", to: null });
    expect(lastEdit().ops).toEqual([
      { doc: HOME, id: "title", op: "update", set: { link: null } },
    ]);

    answers.prompt = "/invoices/42";
    await choose(title, { kind: "linkUrl" });
    expect(lastEdit().ops).toEqual([
      {
        doc: HOME,
        id: "title",
        op: "update",
        set: { link: "/invoices/42" },
      },
    ]);

    await choose(title, { kind: "lock" });
    expect(lastEdit().ops).toEqual([
      { doc: HOME, id: "title", op: "update", set: { locked: true } },
    ]);
    expect(itemOf(title, { kind: "lock" }).label).toBe("Unlock");

    answers.prompt = "Headline";
    await choose(title, { kind: "rename" });
    expect(lastEdit().ops).toEqual([
      { doc: HOME, id: "title", op: "update", set: { name: "Headline" } },
    ]);
  });

  it("arranges, wraps, duplicates and deletes the node", async () => {
    const lede = nodeAt(HOME, "lede");
    await choose(lede, { kind: "arrange", to: "top" });
    expect(lastEdit().label).toBe("Arrange");
    const hero = () => {
      const root = useDocuments.getState().docs[HOME]?.root;
      const [first] = root && "children" in root ? (root.children ?? []) : [];
      return first && "children" in first
        ? (first.children ?? []).map((c) => c.id)
        : [];
    };
    expect(hero()).toEqual(["lede", "title", "cta"]);

    await choose(lede, { in: "row", kind: "wrap" });
    expect(lastEdit()).toEqual({
      label: "Wrap in a row",
      ops: [{ doc: HOME, ids: ["lede"], op: "wrap", type: "row" }],
    });
    const [wrapper] = selected();
    expect(hero()[0]).toBe(wrapper?.nodeId);

    const cta = nodeAt(HOME, "cta");
    await choose(cta, { kind: "duplicate" });
    expect(lastEdit()).toEqual({
      label: "Duplicate",
      ops: [{ doc: HOME, id: "cta", op: "duplicate" }],
    });
    await choose(cta, { kind: "delete" });
    expect(lastEdit()).toEqual({
      label: "Delete",
      ops: [{ doc: HOME, id: "cta", op: "remove" }],
    });
    // What it was for is gone: the menu with it.
    expect(menuFor(cta)).toBeNull();
  });

  it("copies the node, and pastes it into another once copied", async () => {
    await choose(nodeAt(HOME, "title"), { kind: "copy" });
    expect(useClipboard.getState().nodes.map((n) => n.id)).toEqual(["title"]);
    const hero = nodeAt(HOME, "hero");
    expect(itemOf(hero, { kind: "paste" }).disabled).toBe(false);
    await choose(hero, { kind: "paste" });
    expect(lastEdit()).toMatchObject({
      label: "Paste",
      ops: [{ doc: HOME, op: "insert", parent: "hero" }],
    });
  });

  it("shows the node's code in the right panel, on the canvas", async () => {
    useEditor.getState().setWorkspace("prototype");
    await choose(nodeAt(HOME, "lede"), { kind: "viewCode" });
    expect(useEditor.getState()).toMatchObject({
      rightTab: "code",
      selection: { frame: HOME, nodeId: "lede" },
      workspace: "design",
    });
    expect(usePanels.getState().right).toBe(false);
  });

  it("acts on the whole selection when the node is one of it, and on it alone when not", async () => {
    useEditor.getState().selectMany([
      { frame: HOME, nodeId: "title" },
      { frame: HOME, nodeId: "lede" },
    ]);
    const title = nodeAt(HOME, "title");
    expect(menuFor(title)?.[0]).toEqual({ kind: "label", label: "2 selected" });
    expect(itemOf(title, { kind: "rename" }).disabled).toBe(true);
    await choose(title, { in: "group", kind: "wrap" });
    expect(lastEdit().ops).toEqual([
      { doc: HOME, ids: ["title", "lede"], op: "wrap", type: "group" },
    ]);

    useEditor.getState().select({ frame: HOME, nodeId: "hero" });
    await choose(nodeAt(HOME, "cta"), { kind: "hide" });
    expect(lastEdit().ops).toEqual([
      { doc: HOME, id: "cta", op: "update", set: { hidden: true } },
    ]);
  });

  it("in a view, lands at the view's breakpoint (ADR 0036)", async () => {
    const title = nodeAt(TABLET, "title");
    // A view of a page is the page: comments and links are there.
    expect(itemOf(title, { kind: "comment" }).label).toBe("Comment on this");
    await choose(title, { kind: "hide" });
    expect(lastEdit().ops).toEqual([
      { at: "md", doc: HOME, id: "title", op: "update", set: { hidden: true } },
    ]);
  });

  it("beside the pages, has no comment, link or app component", async () => {
    const note = nodeAt("node:note", "note");
    const kinds = itemsOf(menuFor(note) ?? []).map((e) =>
      e.kind === "item" ? e.action.act.kind : e.kind
    );
    for (const kind of ["comment", "link", "linkUrl", "makeApp"]) {
      expect(kinds).not.toContain(kind);
    }
    await choose(note, { kind: "hide" });
    expect(lastEdit().ops).toEqual([
      { doc: CANVAS, id: "note", op: "update", set: { hidden: true } },
    ]);
  });
});

describe("a page's menu", () => {
  it("is read off the stores: the variants and states still free, the other canvases", () => {
    expect(labels(submenu(homePage, "variant")?.entries)).toEqual([
      "dark",
      "separator",
      "New variant…",
    ]);
    expect(labels(submenu(homePage, "state")?.entries)).toEqual([
      "empty",
      "separator",
      "New state…",
    ]);
    expect(labels(submenu(homePage, "copyTo")?.entries)).toEqual([
      "App",
      "separator",
      "New canvas…",
    ]);
    expect(itemOf(homePage, { kind: "preset", preset: "mobile" }).checked).toBe(
      true
    );
    // A variant's drawing is not drawn again.
    expect(submenu({ kind: "page", pageId: BOLD }, "variant")).toBeUndefined();
  });

  it("sends what each item asks of the server", async () => {
    fakeApi.respond("pages.createVariant", () => ({
      ...page(BOLD, "Home"),
      id: "home@dark.page.json",
      variant: "dark",
    }));
    fakeApi.respond("pages.copyTo", () => []);
    await choose(homePage, { kind: "variant", variant: "dark" });
    await choose(homePage, { kind: "state", state: "empty" });
    await choose(homePage, { canvas: "", kind: "copyTo", move: true });
    answers.prompt = "Experiment";
    await choose(homePage, { canvas: null, kind: "copyTo", move: false });
    await choose(homePage, { kind: "ready", ready: true });
    await choose(homePage, { kind: "duplicate" });
    await choose(homePage, { kind: "removeUrl" });
    answers.prompt = "start";
    await choose(homePage, { kind: "setUrl" });
    await choose(homePage, { kind: "delete" });
    // The project read again after a page changed is left out.
    const asked = fakeApi.calls.filter(
      (c) => !(c.method === "pages.list" || READS.includes(c.method))
    );
    expect(asked).toMatchObject([
      {
        input: { id: HOME, variant: "dark" },
        method: "pages.createVariant",
      },
      { input: { id: HOME, state: "empty" }, method: "pages.createState" },
      {
        input: { ids: [HOME], move: true, target: { canvas: "" } },
        method: "pages.copyTo",
      },
      {
        input: { ids: [HOME], move: false, target: { name: "Experiment" } },
        method: "pages.copyTo",
      },
      {
        input: { ready: true, target: HOME },
        method: "implementation.setReady",
      },
      { input: { id: HOME }, method: "pages.duplicate" },
      { input: { id: HOME, route: null }, method: "pages.setRoute" },
      { input: { id: HOME, route: "/start" }, method: "pages.setRoute" },
      { input: { id: HOME }, method: "pages.delete" },
    ]);
  });

  it("leaves the page when a deletion is not confirmed", async () => {
    answers.confirm = false;
    await choose(homePage, { kind: "delete" });
    expect(sent("pages.delete")).toEqual([]);
  });

  it("sets the page's viewport", async () => {
    await choose(homePage, { kind: "preset", preset: "tablet" });
    expect(useEditor.getState().frames[HOME]).toMatchObject({
      preset: "tablet",
      width: 834,
    });
    expect(itemOf(homePage, { kind: "preset", preset: "tablet" }).checked).toBe(
      true
    );
  });

  it("acts on every page picked when it is one of them", async () => {
    usePagePicks.getState().set([HOME, ABOUT]);
    fakeApi.respond("implementation.setReadyAll", () => ({ changed: 2 }));
    const item = itemOf(homePage, { kind: "readyAll" });
    expect(item.label).toBe("Mark 2 pages ready to implement");
    await runMenuAction(item.action);
    expect(sent("implementation.setReadyAll")).toEqual([
      { ready: true, targets: [HOME, ABOUT] },
    ]);
  });
});

describe("the canvas's menu", () => {
  const canvas: MenuTarget = { at: { x: 100, y: 100 }, kind: "canvas" };

  it("runs the editor's commands, and says what they would do now", async () => {
    await choose(canvas, { id: "toggleComments", kind: "command" });
    expect(useComments.getState().visible).toBe(false);
    expect(itemOf(canvas, { id: "toggleComments" }).label).toBe(
      "Show comments"
    );
    await choose(canvas, { id: "grid", kind: "command" });
    expect(useCanvasGrid.getState().visible).toBe(true);
    expect(itemOf(canvas, { id: "grid" }).label).toBe("Hide grid");
    await choose(canvas, { id: "tool:text", kind: "command" });
    expect(useEditor.getState().mode).toBe("text");
    useEditor.setState({ view: { x: 0, y: 0, zoom: 0.5 } });
    await choose(canvas, { id: "zoom100", kind: "command" });
    expect(useEditor.getState().view.zoom).toBe(1);
  });

  it("pastes only with something copied", () => {
    expect(itemOf(canvas, { kind: "paste" }).disabled).toBe(true);
    useClipboard.setState({ nodes: [text("copied")] });
    expect(itemOf(canvas, { kind: "paste" }).disabled).toBe(false);
  });

  it("names commands that run", () => {
    for (const item of itemsOf(menuFor(canvas) ?? [])) {
      if (item.kind === "item" && item.action.act.kind === "command") {
        const { id } = item.action.act;
        expect(commandList().find((c) => c.id === id)?.run, id).toBeTypeOf(
          "function"
        );
      }
    }
  });
});

/**
 * Every kind of action of every menu: the type checker asks for one more here when an action is
 * added, and the sweep below finds it in a menu and runs it.
 */
const EVERY_ACTION = {
  canvas: { command: true, paste: true },
  canvasEntry: {
    adopt: true,
    componentSheet: true,
    delete: true,
    duplicate: true,
    duplicateWithAgent: true,
    move: true,
    openCanvas: true,
    readyAll: true,
    rename: true,
  },
  comment: {
    copyText: true,
    delete: true,
    note: true,
    open: true,
    resolve: true,
    selectElement: true,
    send: true,
  },
  component: { copyName: true, insert: true, insertCanvas: true },
  node: {
    arrange: true,
    ask: true,
    comment: true,
    copy: true,
    copyLink: true,
    copyRef: true,
    cut: true,
    delete: true,
    detach: true,
    duplicate: true,
    editComponent: true,
    editText: true,
    hide: true,
    link: true,
    linkUrl: true,
    lock: true,
    makeApp: true,
    paste: true,
    rename: true,
    selectParent: true,
    unwrap: true,
    viewCode: true,
    wrap: true,
    zoomTo: true,
  },
  page: {
    adopt: true,
    comment: true,
    copyTo: true,
    delete: true,
    duplicate: true,
    goTo: true,
    implement: true,
    markImplemented: true,
    paste: true,
    preset: true,
    ready: true,
    readyAll: true,
    removeUrl: true,
    rename: true,
    setUrl: true,
    state: true,
    unlink: true,
    variant: true,
    zoomTo: true,
  },
  thread: { delete: true, follow: true, open: true, stop: true },
} satisfies {
  [A in MenuAction as A["on"]]: Record<A["act"]["kind"], true>;
};

/** Targets whose menus between them hold every kind of action. */
const everyTarget = (): MenuTarget[] => [
  nodeAt(HOME, "title"),
  nodeAt(HOME, "hero"),
  nodeAt(HOME, "promo"),
  homePage,
  { kind: "page", pageId: ABOUT },
  { kind: "page", pageId: BOLD },
  { canvasId: "", kind: "canvasEntry" },
  { at: { x: 100, y: 100 }, kind: "canvas" },
  { commentId: "c1", kind: "comment" },
  {
    kind: "component",
    make: () => text("made"),
    name: "Card",
  },
  { kind: "thread", threadId: "t1" },
];

const CONTACT = "contact.page.json";

/**
 * The stores as the menus between them show every item: something copied and selected, a page
 * implemented, two picked together, an agent at work.
 */
const setUpForEvery = () => {
  setUp();
  useClipboard.setState({ nodes: [text("copied")] });
  useEditor.getState().select({ frame: HOME, nodeId: "title" });
  useProject.setState((s) => ({
    pages: [...s.pages, page(CONTACT, "Contact")],
  }));
  usePagePicks.getState().set([BOLD, CONTACT]);
  useImplementation.setState({
    byTarget: { [ABOUT]: { files: ["src/about.tsx"], status: "implemented" } },
  } as never);
  useAgents.setState({ threads: [{ ...thread, status: "running" }] });
};

describe("every action", () => {
  it("is in a menu, and runs", async () => {
    setUpForEvery();
    const seen = new Map<string, MenuAction>();
    for (const target of everyTarget()) {
      for (const item of itemsOf(menuFor(target) ?? [])) {
        if (item.kind === "item") {
          const key = `${item.action.on}.${item.action.act.kind}`;
          if (!seen.has(key)) {
            seen.set(key, item.action);
          }
        }
      }
    }
    const every = Object.entries(EVERY_ACTION).flatMap(([on, kinds]) =>
      Object.keys(kinds).map((kind) => `${on}.${kind}`)
    );
    const missing = every.filter((key) => !seen.has(key));
    expect(missing).toEqual([]);
    for (const [key, action] of seen) {
      setUpForEvery();
      try {
        // biome-ignore lint/performance/noAwaitInLoops: each runs on the stores set up again for it.
        await runMenuAction(action);
      } catch (error) {
        throw new Error(`${key} failed`, { cause: error });
      }
    }
  });
});
