import "../testing/fake-browser.ts";
import type { Comment } from "@ultrapaint/contracts/comments";
import { emptySetup } from "@ultrapaint/contracts/design-system-setup";
import type {
  DocumentPatch,
  DocumentState,
} from "@ultrapaint/contracts/document";
import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import type { CanvasLayout, Page, PageList } from "@ultrapaint/contracts/pages";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { HistoryPoint, PointView } from "@ultrapaint/contracts/snapshots";
import { emptyDrift, type SyncPlan } from "@ultrapaint/contracts/sync";
import type { Thread } from "@ultrapaint/contracts/threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useAgents } from "./agents.ts";
import { useComments } from "./comments.ts";
import { useComponents } from "./components.ts";
import { useDesignSystem } from "./design-system.ts";
import { useDesignSystemSetup } from "./design-system-setup.ts";
import { useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { useHistory } from "./history.ts";
import { useImplementation } from "./implementation.ts";
import { applyLayout, layoutOf } from "./page-layout.ts";
import { useProject } from "./project.ts";
import { caughtUp, followServer, viewSnapshot } from "./server-data.ts";
import { useSkills } from "./skills.ts";
import { useSlashCommands } from "./slash-commands.ts";
import { useSnapshotView } from "./snapshot-view.ts";
import { useSync } from "./sync.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const settings: Settings = {
  designsDir: "designs",
  hostCss: [],
  libraryDirs: [],
  repoPath: "/work/shop",
};

const page = (id: string, name: string): Page => ({
  canvas: "",
  file: `designs/${id}`,
  id,
  name,
  path: id,
});

const doc = (hash: string): DocumentState => ({
  doc: "home.page.json",
  hash,
  root: { children: [], id: "root", type: "page" },
});

const layoutAt = (x: number): CanvasLayout => ({
  frames: {
    "home.page.json": { height: 900, preset: "desktop", width: 1440, x, y: 0 },
  },
  version: 1,
});

const comment = (text: string): Comment => ({
  author: null,
  createdAt: 1,
  element: null,
  id: text,
  kind: "comment",
  nodeId: null,
  page: "home.page.json",
  replies: [],
  resolved: false,
  text,
  updatedAt: 1,
  x: 0,
  y: 0,
});

const item = (target: string): ImplementationItem => ({
  changedFiles: [],
  codeChanged: false,
  designChanged: false,
  files: [],
  kind: "page",
  name: "Home",
  ready: false,
  status: "draft",
  target,
});

const plan = (at: number): SyncPlan => ({
  at,
  case: "maintain",
  drift: emptyDrift,
  facts: {
    app: true,
    designSystem: true,
    stylesheets: 1,
  },
  steps: [],
  summary: "",
});

const point = (id: string): HistoryPoint => ({
  at: 1,
  canvases: [],
  files: [],
  id,
  kind: "edits",
});

const thread = (id: string): Thread => ({
  agentId: "claude-code",
  createdAt: 1,
  id,
  status: "idle",
  title: id,
  updatedAt: 1,
});

/** The server: everything it holds is of its version, which moves while the editor is away. */
const server = { v: 1 };

const info = (): ProjectInfo => ({
  configured: true,
  name: `shop ${server.v}`,
  settings: { ...settings, libraryDirs: [`src/v${server.v}`] },
  storage: { mode: "managed" },
});

const pagesNow = (): PageList => ({
  canvases: [{ home: "/", id: "", name: "Designs", variants: [] }],
  pages: [page("home.page.json", `Home ${server.v}`)],
});

const answerAll = () => {
  const v = () => server.v;
  fakeApi.respond("project.info", info);
  fakeApi.respond("pages.list", pagesNow);
  fakeApi.respond("edit.state", () => ({ canRedo: false, canUndo: v() > 1 }));
  fakeApi.respond("documents.list", () => [doc(`h${v()}`)]);
  fakeApi.respond("canvas.get", () => layoutAt(100 * v()));
  fakeApi.respond("history.get", () => ({
    pending: null,
    points: [point(`hp${v()}`)],
  }));
  fakeApi.respond("comments.list", () => ({
    comments: [comment(`c${v()}`)],
    version: 1,
  }));
  fakeApi.respond("designSystem.get", () => ({
    designSystem: null,
    document: null,
    problem: `css ${v()}`,
  }));
  fakeApi.respond("components.list", () => ({
    components: [{ file: `v${v()}.component.json` }],
  }));
  fakeApi.respond("implementation.list", () => ({ items: [item(`t${v()}`)] }));
  fakeApi.respond("sync.plan", () => plan(v()));
  fakeApi.respond("agents.list", () => []);
  fakeApi.respond("threads.list", () => [thread(`t${v()}`)]);
  fakeApi.respond("dsSetup.get", () => emptySetup(v()));
  fakeApi.respond("dsSetup.inventory", () => null);
  fakeApi.respond("dsSetup.audit", () => null);
  fakeApi.respond("dsSetup.mapping", () => null);
  fakeApi.respond("skills.list", () => ({
    installed: [`skills ${v()}`],
    skills: [],
  }));
  fakeApi.respond("commands.list", () =>
    Array.from({ length: v() }, (_, i) => ({
      description: "",
      name: `c${i}`,
    }))
  );
};

/** What the editor holds of the server, by the version each store says it read. */
const held = () => ({
  agents: useAgents.getState().threads.map((t) => t.id),
  commands: useSlashCommands.getState().commands.length,
  comments: useComments.getState().comments.map((c) => c.text),
  components: useComponents.getState().entries.map((e) => e.file),
  designSystem: useDesignSystem.getState().problem,
  documents: useDocuments.getState().docs["home.page.json"]?.hash,
  history: useHistory.getState().points?.map((p) => p.id),
  implementation: Object.keys(useImplementation.getState().byTarget),
  layout: useEditor.getState().layout.frames["home.page.json"]?.x,
  pages: useProject.getState().pages.map((p) => p.name),
  project: useProject.getState().info.name,
  settings: useProject.getState().settings?.libraryDirs,
  setup: useDesignSystemSetup.getState().setup?.updatedAt,
  skills: useSkills.getState().installed[0],
  sync: useSync.getState().plan?.at,
  undo: useProject.getState().undo.canUndo,
});

const heldAt = (v: number) => ({
  agents: [`t${v}`],
  commands: v,
  comments: [`c${v}`],
  components: [`v${v}.component.json`],
  designSystem: `css ${v}`,
  documents: `h${v}`,
  history: [`hp${v}`],
  implementation: [`t${v}`],
  layout: 100 * v,
  pages: [`Home ${v}`],
  project: `shop ${v}`,
  settings: [`src/v${v}`],
  setup: v,
  skills: `skills ${v}`,
  sync: v,
  undo: v > 1,
});

/** The editor as it is once open on the designs' canvas, with every panel that reads opened once. */
const openEditor = async () => {
  await caughtUp();
  useEditor.setState({ canvas: "" });
  await Promise.all([
    useDesignSystem.getState().load(),
    useComponents.getState().load(),
    useImplementation.getState().load(),
    useSync.getState().load(),
    useAgents.getState().load(),
    useComments.getState().load(""),
    useDocuments.getState().load(""),
    layoutOf(""),
    useDesignSystemSetup.getState().load(),
    useSkills.getState().load(),
    useSlashCommands.getState().load(),
    useHistory.getState().load(),
  ]);
  // The canvas opens with the layout it read, as `goTo` does.
  applyLayout("", await layoutOf(""));
};

const reported: unknown[] = [];
let stop: () => void = () => undefined;

beforeEach(() => {
  fakeApi.reset();
  server.v = 1;
  reported.length = 0;
  useSnapshotView.setState({ live: null, view: null });
  answerAll();
  stop = followServer({ report: (error) => reported.push(error) });
});

afterEach(() => stop());

describe("following the server", () => {
  it("reads the project at the first open", async () => {
    await caughtUp();
    expect(held().project).toBe("shop 1");
    expect(held().pages).toEqual(["Home 1"]);
  });

  it("reads every store again when the connection opens again, catching up on what it missed", async () => {
    await openEditor();
    expect(held()).toEqual(heldAt(1));
    fakeApi.disconnect();
    // The server restarts, and its news meanwhile reaches nobody.
    server.v = 2;
    fakeApi.emit("designSystem", {
      designSystem: null,
      document: null,
      problem: "css 2",
    });
    expect(held()).toEqual(heldAt(1));
    fakeApi.connect();
    await caughtUp();
    expect(held()).toEqual(heldAt(2));
    expect(reported).toEqual([]);
  });

  it("follows the news in between", async () => {
    await openEditor();
    fakeApi.emit("syncPlan", plan(7));
    fakeApi.emit("document", doc("h7"));
    fakeApi.emit("canvas", { canvas: "", layout: layoutAt(700) });
    expect(held()).toMatchObject({ documents: "h7", layout: 700, sync: 7 });
  });

  it("follows the settings in force when nothing else of the project changes", async () => {
    await openEditor();
    fakeApi.calls.length = 0;
    // Someone else changed the configuration file's components' directories: the same project.
    fakeApi.emit("project", {
      ...info(),
      settings: { ...settings, libraryDirs: ["src/ui"] },
    });
    expect(useProject.getState().settings?.libraryDirs).toEqual(["src/ui"]);
    expect(fakeApi.calls).not.toContainEqual(
      expect.objectContaining({ method: "project.info" })
    );
  });

  it("drops an answer for a canvas no longer open", async () => {
    await openEditor();
    let answer: (states: DocumentState[]) => void = () => undefined;
    fakeApi.respond(
      "documents.list",
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const opening = useDocuments.getState().load("");
    useDocuments.setState({ canvas: "other", docs: {} });
    answer([doc("late")]);
    await opening;
    expect(useDocuments.getState().docs).toEqual({});
  });

  it("follows the history the server publishes, whoever made its points", async () => {
    await openEditor();
    fakeApi.calls.length = 0;
    fakeApi.emit("history", [point("hp7"), point("hp1")]);
    expect(held()).toMatchObject({ history: ["hp7", "hp1"] });
    expect(fakeApi.calls).toEqual([]);
  });

  it("drops an answer older than the server's news of it", async () => {
    await openEditor();
    let answer: (list: { pending: null; points: HistoryPoint[] }) => void =
      () => undefined;
    fakeApi.respond(
      "history.get",
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const reading = useHistory.getState().load();
    // A turn makes a point while the history is on its way, older than the turn.
    fakeApi.emit("history", [point("hp8"), point("hp1")]);
    answer({ pending: null, points: [point("hp1")] });
    await reading;
    expect(held().history).toEqual(["hp8", "hp1"]);
  });

  describe("a document's news told while the canvas's documents are read", () => {
    /** The page's change over the state `from`: a heading put on it. */
    const headed = (from: string, hash: string): DocumentPatch => ({
      doc: "home.page.json",
      from,
      hash,
      nodes: [
        { children: ["h"], node: { id: "root", type: "page" } },
        { node: { id: "h", text: "Hello", type: "text" } },
      ],
      rootId: "root",
    });
    let answer: (states: DocumentState[]) => void = () => undefined;
    const listLater = () =>
      fakeApi.respond(
        "documents.list",
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );

    it("is taken after the list's answer, which the server read before it", async () => {
      await openEditor();
      listLater();
      const opening = useDocuments.getState().load("");
      fakeApi.emit("document", headed("h1", "h2"));
      answer([doc("h1")]);
      await opening;
      expect(held().documents).toBe("h2");
      expect(
        useDocuments.getState().docs["home.page.json"]?.root
      ).toMatchObject({ children: [{ id: "h" }] });
    });

    it("is taken after the answer of the read a connection open makes", async () => {
      await openEditor();
      listLater();
      const lists = fakeApi.calls.filter(
        (c) => c.method === "documents.list"
      ).length;
      fakeApi.disconnect();
      fakeApi.connect();
      // The open's read of the documents has gone out, its answer held.
      await fakeApi.requested("documents.list", lists + 1);
      fakeApi.emit("document", doc("h7"));
      answer([doc("h1")]);
      await caughtUp();
      expect(held().documents).toBe("h7");
      expect(reported).toEqual([]);
    });
  });

  it("drops an answer older than one taken already", async () => {
    await openEditor();
    const answers: ((list: {
      pending: null;
      points: HistoryPoint[];
    }) => void)[] = [];
    fakeApi.respond(
      "history.get",
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        })
    );
    const first = useHistory.getState().load();
    const second = useHistory.getState().load();
    answers[1]?.({ pending: null, points: [point("hp9")] });
    await second;
    answers[0]?.({ pending: null, points: [point("hp1")] });
    await first;
    expect(held().history).toEqual(["hp9"]);
  });

  it("stops following when asked: the news and the opens reach nobody", async () => {
    await openEditor();
    stop();
    fakeApi.emit("syncPlan", plan(7));
    fakeApi.disconnect();
    server.v = 2;
    fakeApi.calls.length = 0;
    fakeApi.connect();
    // A read at the open would have gone out as the connection opened: nothing went.
    expect(fakeApi.calls).toEqual([]);
    expect(held()).toEqual(heldAt(1));
  });
});

describe("a point of the history on screen", () => {
  const view: PointView = {
    canvases: [{ home: "/", id: "", name: "Designs", variants: [] }],
    documents: [doc("kept")],
    layouts: { "": layoutAt(-50) },
    pages: [page("home.page.json", "Home kept")],
    point: { ...point("hp1"), name: "Before" },
  };

  it("shows what it keeps, holds back the files' news, and leaves the rest live", async () => {
    await openEditor();
    await viewSnapshot(view);
    expect(held()).toMatchObject({
      documents: "kept",
      layout: -50,
      pages: ["Home kept"],
    });
    fakeApi.emit("pages", pagesNow());
    fakeApi.emit("document", doc("h9"));
    fakeApi.emit("canvas", { canvas: "", layout: layoutAt(900) });
    fakeApi.emit("designSystem", {
      designSystem: null,
      document: null,
      problem: "css 9",
    });
    fakeApi.emit("history", [point("hp9"), point("hp1")]);
    expect(held()).toMatchObject({
      designSystem: "css 9",
      documents: "kept",
      history: ["hp9", "hp1"],
      layout: -50,
      pages: ["Home kept"],
    });
  });

  it("reads from the snapshot again at a connection open", async () => {
    await openEditor();
    await viewSnapshot(view);
    fakeApi.disconnect();
    server.v = 2;
    fakeApi.connect();
    await caughtUp();
    expect(held()).toMatchObject({
      documents: "kept",
      layout: -50,
      pages: ["Home kept"],
      sync: 2,
    });
  });

  it("goes back to the files as they are now, and follows them again", async () => {
    await openEditor();
    await viewSnapshot(view);
    server.v = 2;
    fakeApi.emit("document", doc("h9"));
    await viewSnapshot(null);
    expect(held()).toMatchObject({
      documents: "h2",
      layout: 200,
      pages: ["Home 2"],
    });
    fakeApi.emit("document", doc("h3"));
    expect(held().documents).toBe("h3");
  });
});
