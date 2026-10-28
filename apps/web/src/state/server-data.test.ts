import "../testing/fake-browser.ts";
import type { Comment } from "@ultrapaint/contracts/comments";
import { emptySetup } from "@ultrapaint/contracts/design-system-setup";
import type { DocumentState } from "@ultrapaint/contracts/document";
import type { ImplementationItem } from "@ultrapaint/contracts/implementation";
import type {
  CanvasLayout,
  Page,
  PageList,
} from "@ultrapaint/contracts/pages";
import type { ProjectInfo } from "@ultrapaint/contracts/project";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { SnapshotView } from "@ultrapaint/contracts/snapshots";
import { emptyDrift, type SyncPlan } from "@ultrapaint/contracts/sync";
import type { Thread } from "@ultrapaint/contracts/threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { useAgents } from "./agents.ts";
import { useCatalogue } from "./catalogue.ts";
import { useComments } from "./comments.ts";
import { useDesignSystem } from "./design-system.ts";
import { useDesignSystemSetup } from "./design-system-setup.ts";
import { useDocuments } from "./documents.ts";
import { layoutOf, useEditor } from "./editor.ts";
import { useImplementation } from "./implementation.ts";
import { useProject } from "./project.ts";
import { followServer, viewSnapshot } from "./server-data.ts";
import { useSkills } from "./skills.ts";
import { useSlashCommands } from "./slash-commands.ts";
import { useSnapshotView } from "./snapshot-view.ts";
import { useSpecs } from "./specs.ts";
import { useSync } from "./sync.ts";

vi.mock(
  "./connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** Lets every answer on its way land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const settings: Settings = {
  componentPackages: [],
  designsDir: "designs",
  hostCss: [],
  libraryDirs: [],
  repoPath: "/work/shop",
  theme: "light",
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
    components: 0,
    designSystem: true,
    libraryDirs: [],
    styleSystem: "tailwind-v4",
    stylesheets: 1,
    tokens: 0,
  },
  steps: [],
  summary: "",
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
  host: { state: "stopped" },
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
  fakeApi.respond("logs.recent", () => []);
  fakeApi.respond("edit.state", () => ({ canRedo: false, canUndo: v() > 1 }));
  fakeApi.respond("documents.list", () => [doc(`h${v()}`)]);
  fakeApi.respond("canvas.get", () => layoutAt(100 * v()));
  fakeApi.respond("comments.list", () => ({
    comments: [comment(`c${v()}`)],
    version: 1,
  }));
  fakeApi.respond("designSystem.get", () => ({
    designSystem: null,
    document: null,
    previewCss: `css ${v()}`,
  }));
  fakeApi.respond("catalogue.get", () => ({
    builtAt: v(),
    components: [],
    coverage: { total: 0, usable: 0 },
  }));
  fakeApi.respond("specs.list", () => ({
    specs: [{ file: `v${v()}.spec.json` }],
  }));
  fakeApi.respond("implementation.list", () => ({ items: [item(`t${v()}`)] }));
  fakeApi.respond("sync.plan", () => plan(v()));
  fakeApi.respond("agents.list", () => []);
  fakeApi.respond("threads.list", () => [thread(`t${v()}`)]);
  fakeApi.respond("dsSetup.get", () => emptySetup(v()));
  fakeApi.respond("dsSetup.inventory", () => null);
  fakeApi.respond("dsSetup.audit", () => null);
  fakeApi.respond("dsSetup.mapping", () => null);
  fakeApi.respond("skills.list", () => ({ dir: `skills ${v()}`, skills: [] }));
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
  catalogue: useCatalogue.getState().catalogue?.builtAt,
  commands: useSlashCommands.getState().commands.length,
  comments: useComments.getState().comments.map((c) => c.text),
  designSystem: useDesignSystem.getState().previewCss,
  documents: useDocuments.getState().docs["home.page.json"]?.hash,
  implementation: Object.keys(useImplementation.getState().byTarget),
  layout: useEditor.getState().layout.frames["home.page.json"]?.x,
  pages: useProject.getState().pages.map((p) => p.name),
  project: useProject.getState().info.name,
  settings: useProject.getState().settings?.libraryDirs,
  setup: useDesignSystemSetup.getState().setup?.updatedAt,
  skills: useSkills.getState().dir,
  specs: useSpecs.getState().entries.map((e) => e.file),
  sync: useSync.getState().plan?.at,
  undo: useProject.getState().undo.canUndo,
});

const heldAt = (v: number) => ({
  agents: [`t${v}`],
  catalogue: v,
  commands: v,
  comments: [`c${v}`],
  designSystem: `css ${v}`,
  documents: `h${v}`,
  implementation: [`t${v}`],
  layout: 100 * v,
  pages: [`Home ${v}`],
  project: `shop ${v}`,
  settings: [`src/v${v}`],
  setup: v,
  skills: `skills ${v}`,
  specs: [`v${v}.spec.json`],
  sync: v,
  undo: v > 1,
});

/** The editor as it is once open on the designs' canvas, with every panel that reads opened once. */
const openEditor = async () => {
  await settle();
  useEditor.setState({ canvas: "" });
  await Promise.all([
    useDesignSystem.getState().load(),
    useCatalogue.getState().load(),
    useSpecs.getState().load(),
    useImplementation.getState().load(),
    useSync.getState().load(),
    useAgents.getState().load(),
    useComments.getState().load(""),
    useDocuments.getState().load(""),
    layoutOf(""),
    useDesignSystemSetup.getState().load(),
    useSkills.getState().load(),
    useSlashCommands.getState().load(),
  ]);
  // The canvas opens with the layout it read, as `goTo` does.
  useEditor.getState().applyLayout("", await layoutOf(""));
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
    await settle();
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
      previewCss: "css 2",
    });
    expect(held()).toEqual(heldAt(1));
    fakeApi.connect();
    await settle();
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

  it("stops following when asked: the news and the opens reach nobody", async () => {
    await openEditor();
    stop();
    fakeApi.emit("syncPlan", plan(7));
    fakeApi.disconnect();
    server.v = 2;
    fakeApi.connect();
    await settle();
    expect(held()).toEqual(heldAt(1));
  });
});

describe("a snapshot on screen", () => {
  const view: SnapshotView = {
    canvases: [{ home: "/", id: "", name: "Designs", variants: [] }],
    documents: [doc("kept")],
    layouts: { "": layoutAt(-50) },
    pages: [page("home.page.json", "Home kept")],
    snapshot: { at: 1, files: 1, id: "s1", name: "Before" },
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
      previewCss: "css 9",
    });
    expect(held()).toMatchObject({
      designSystem: "css 9",
      documents: "kept",
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
    await settle();
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
