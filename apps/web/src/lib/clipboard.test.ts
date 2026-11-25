// @vitest-environment happy-dom
import type {
  AppliedChanges,
  ApplyInput,
  DesignNode,
  DocumentState,
} from "@ultrapaint/contracts/document";
import { applyOps } from "@ultrapaint/design-document/ops";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDesignSystem } from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { select } from "../state/selection.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { until } from "../testing/until.ts";
import { onPasteEvent } from "./clipboard.ts";
import { textOfNodes } from "./node-text.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

const HOME = "home.page.json";
/** A view of the home page at 800 px: `md`, of the default breakpoints. */
const TABLET = `${HOME}#tablet`;
/** A view of the home page at 390 px: below the first breakpoint, the base. */
const PHONE = `${HOME}#phone`;

const text = (id: string): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text" }) as DesignNode;

/** The server's side of `documents.apply`: the operations applied to the documents the editor has. */
const serve = () =>
  fakeApi.respond("documents.apply", (input: ApplyInput): AppliedChanges => {
    const changes: DocumentState[] = [];
    const created: string[] = [];
    for (const { doc, ops } of input.edits) {
      const before = useDocuments.getState().docs[doc];
      if (!before?.root) {
        throw new Error(`no document ${doc}`);
      }
      const applied = applyOps(before.root, ops, {
        canvas: false,
        next: (prefix = "n") => `${prefix}_server`,
      });
      created.push(...applied.created);
      changes.push({ doc, hash: `${doc}@1`, root: applied.root });
    }
    return { changes, created };
  });

/** The requests sent to the server to change documents: one each is one undo step. */
const applied = () =>
  fakeApi.calls
    .filter((c) => c.method === "documents.apply")
    .map((c) => c.input as ApplyInput);

const selected = () => {
  const { also, selection } = useEditor.getState();
  return selection ? [selection, ...also] : [];
};

/** A paste event of what a clipboard holds, by type, and the files on it. */
const pasted = (data: Record<string, string>, files: File[] = []) => {
  const event = {
    clipboardData: { files, getData: (type: string) => data[type] ?? "" },
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
  };
  return event;
};

/** The next toast's title and options, once it is shown. */
const nextToast = () =>
  new Promise<unknown[]>((resolve) => {
    vi.mocked(toast).mockImplementation((...args: unknown[]) => {
      resolve(args);
      return 1;
    });
  });

/** Pastes markup, and waits for the toast that says what came of it. */
const paste = async (data: Record<string, string>) => {
  const toasted = nextToast();
  const event = pasted(data);
  const taken = onPasteEvent(event as unknown as ClipboardEvent);
  return { event, taken, toasted: taken ? await toasted : undefined };
};

/** Pastes something that is not markup, which shows no toast. */
const pasteOther = (data: Record<string, string>, files: File[] = []) => {
  const event = pasted(data, files);
  return { event, taken: onPasteEvent(event as unknown as ClipboardEvent) };
};

const initial = useEditor.getState();

beforeEach(() => {
  fakeApi.reset();
  vi.mocked(toast).mockReset();
  useDesignSystem.setState({ designSystem: null });
  serve();
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main" }],
    info: { configured: true, storage: { mode: "managed" } },
    pages: [],
  });
  useEditor.setState(initial, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: {
        height: 900,
        preset: "desktop",
        views: [
          { height: 900, id: "tablet", width: 800, x: 1600, y: 0 },
          { height: 900, id: "phone", width: 390, x: 2500, y: 0 },
        ],
        width: 1440,
        x: 0,
        y: 0,
      },
      [PHONE]: { height: 900, preset: "custom", width: 390, x: 2500, y: 0 },
      [TABLET]: { height: 900, preset: "custom", width: 800, x: 1600, y: 0 },
    },
  });
  useDocuments.setState({
    canvas: "main",
    docs: {
      [HOME]: {
        doc: HOME,
        hash: `${HOME}@0`,
        root: {
          children: [{ children: [text("a")], id: "list", type: "column" }],
          id: "home",
          type: "page",
        },
      },
    },
    loaded: true,
  });
});

/** The one insert a paste sent, and the node it inserted. */
const inserted = () => {
  const [edit] = applied();
  const op = edit?.edits[0]?.ops[0] as
    | { node: DesignNode; op: string; parent: string }
    | undefined;
  return { label: edit?.label, node: op?.node, op, requests: applied().length };
};

describe("pasting markup on the canvas (ADR 0148)", () => {
  it("pastes a browser's HTML into the selected container, from the view's breakpoint up, and selects it", async () => {
    select({ frame: TABLET, nodeId: "list" });
    await paste({ "text/html": "<p>Hello</p>", "text/plain": "Hello" });
    const { label, node, op, requests } = inserted();
    expect(requests).toBe(1);
    expect(label).toBe("Paste");
    expect(op).toMatchObject({ op: "insert", parent: "list" });
    expect(node).toMatchObject({
      at: { md: { hidden: false } },
      hidden: true,
      text: "Hello",
      type: "text",
    });
    expect(selected()).toEqual([{ frame: TABLET, nodeId: node?.id }]);
  });

  it("pastes markup copied as plain text from a code editor", async () => {
    select({ frame: PHONE, nodeId: "list" });
    await paste({ "text/plain": `<h2 class="text-center">Plans</h2>` });
    expect(inserted().node).toMatchObject({
      align: "center",
      level: 2,
      role: "heading",
      text: "Plans",
    });
  });

  it("pastes the markup's layers, not those of the highlighted code beside it", async () => {
    select({ frame: PHONE, nodeId: "list" });
    await paste({
      "text/html": `<meta charset="utf-8"><div style="white-space: pre;"><span style="color:#f00">&lt;h2&gt;</span>Plans<span>&lt;/h2&gt;</span></div>`,
      "text/plain": "<h2>Plans</h2>",
    });
    expect(inserted().node).toMatchObject({ role: "heading", text: "Plans" });
  });

  it("still pastes the editor's own copied nodes as themselves", async () => {
    select({ frame: PHONE, nodeId: "list" });
    const before = useEditor.getState().selection;
    pasteOther({ "text/plain": textOfNodes([text("copy")]) });
    await until(useEditor, (s) => s.selection !== before);
    expect(inserted().node).toMatchObject({ id: "copy", text: "copy" });
  });

  it("leaves a paste holding image files to the canvas, whatever HTML is beside them", () => {
    const { event, taken } = pasteOther(
      { "text/html": `<img src="https://x.test/a.png">` },
      [new File([""], "a.png", { type: "image/png" })]
    );
    expect(taken).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(applied()).toEqual([]);
  });

  it("pastes a browser's copy of a word alone as a text, with the styles it was copied with", async () => {
    select({ frame: PHONE, nodeId: "list" });
    await paste({
      "text/html": `<meta charset="utf-8"><span style="color: rgb(255, 0, 0); font-size: 16px">word</span>`,
      "text/plain": "word",
    });
    expect(inserted().node).toMatchObject({
      color: "rgb(255, 0, 0)",
      size: 16,
      text: "word",
      type: "text",
    });
  });

  it("pastes nothing from words that are not markup", () => {
    expect(pasteOther({ "text/plain": "just words" }).taken).toBe(false);
    expect(applied()).toEqual([]);
  });

  it("pastes nothing from a code editor's highlighting of code that is not markup", () => {
    const { taken } = pasteOther({
      "text/html": `<meta charset="utf-8"><div style="white-space: pre;"><span>const</span> x = 1</div>`,
      "text/plain": "const x = 1",
    });
    expect(taken).toBe(false);
    expect(applied()).toEqual([]);
  });

  it("pastes a browser's copy of a block that wraps its words as layers", async () => {
    select({ frame: PHONE, nodeId: "list" });
    await paste({
      "text/html": `<div style="white-space: pre-wrap">A message</div>`,
      "text/plain": "A message",
    });
    expect(inserted().node).toMatchObject({ text: "A message" });
  });

  it("makes no layers of JSX, and says so", async () => {
    const { taken, toasted } = await paste({
      "text/plain": `<Card className="p-4">{title}</Card>`,
    });
    expect(taken).toBe(true);
    expect(applied()).toEqual([]);
    expect(toasted?.[0]).toBe("JSX isn’t pasted as layers");
  });

  it("says how many layers were pasted and what was not carried", async () => {
    select({ frame: PHONE, nodeId: "list" });
    const { toasted } = await paste({
      "text/plain": `<div class="grid shadow-glow"><p>One</p><p>Two</p></div>`,
    });
    expect(toasted).toEqual([
      "Pasted 3 layers",
      {
        description:
          "Not carried: a class not read, a grid laid out as a column.",
      },
    ]);
  });

  it("pastes nothing from markup of which nothing could be carried, and says why", async () => {
    const { taken, toasted } = await paste({ "text/plain": "<svg></svg>" });
    expect(taken).toBe(true);
    expect(applied()).toEqual([]);
    expect(toasted).toEqual([
      "Nothing to paste",
      { description: "Not carried: an SVG left out." },
    ]);
  });

  it("says nothing was pasted when there is nowhere to paste it", async () => {
    useEditor.setState({ activePage: null, selection: null });
    const { toasted } = await paste({ "text/html": "<p>Hello</p>" });
    expect(applied()).toEqual([]);
    expect(toasted).toEqual([
      "Nothing to paste",
      { description: "Select a page or an element to paste into." },
    ]);
  });
});
