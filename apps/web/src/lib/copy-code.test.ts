import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { selectMany } from "../state/selection.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { copyCode } from "./copy-code.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

/** What the toasts said. */
const toasts: string[] = [];
vi.mock("sonner", () => ({
  toast: { success: (message: string) => toasts.push(message) },
}));

const HOME = "home.page.json";

const text = (id: string): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text" }) as DesignNode;

const title = text("title");
const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: [
      title,
      { children: [text("price"), text("per")], id: "row", type: "row" },
      text("lede"),
    ],
    id: "home",
    type: "page",
  } as DesignNode,
};

const initialEditor = useEditor.getState();
const initialProject = useProject.getState();

/** What the clipboard holds, and when the write was opened against when its text came. */
let clipboard: string | null = null;
const events: string[] = [];

/** The clipboard's item, as a browser's: what it holds may still be on its way. */
class FakeClipboardItem {
  readonly items: Record<string, Promise<Blob> | Blob | string>;
  constructor(items: Record<string, Promise<Blob> | Blob | string>) {
    this.items = items;
  }
}

beforeEach(() => {
  clipboard = null;
  events.length = 0;
  toasts.length = 0;
  fakeApi.reset();
  fakeApi.respond("code.write", ({ format, node }) => {
    events.push(`answered ${node.id}`);
    return { code: `<${format} ${node.id}>`, language: format ?? "tsx" };
  });
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  vi.stubGlobal("navigator", {
    clipboard: {
      write: async (items: readonly FakeClipboardItem[]) => {
        events.push("write opened");
        const held = await items[0]?.items["text/plain"];
        clipboard =
          typeof held === "string" ? held : ((await held?.text()) ?? null);
      },
    },
  });
  useEditor.setState(initialEditor, true);
  useEditor.setState({ canvas: "main", workspace: "design" });
  useDocuments.setState({ canvas: "main", docs: { [HOME]: home } });
  useProject.setState(initialProject, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  useEditor.setState(initialEditor, true);
  useProject.setState(initialProject, true);
});

const at = (nodeId: string) => ({ frame: HOME, nodeId });

describe("Copy as code", () => {
  it("copies an element's JSX without its imports, in its canvas, and says so", async () => {
    await copyCode(at("title"), "tsx");
    expect(fakeApi.calls).toEqual([
      {
        input: {
          canvas: "main",
          format: "tsx",
          imports: false,
          node: title,
          parent: "column",
        },
        method: "code.write",
      },
    ]);
    expect(clipboard).toBe("<tsx title>");
    expect(toasts).toEqual(["JSX copied"]);
  });

  it("copies several elements as one snippet, in the order the layers list them, each against its own parent's layout", async () => {
    selectMany([at("lede"), at("price"), at("title")]);
    await copyCode(at("lede"), "html");
    expect(clipboard).toBe("<html title>\n\n<html price>\n\n<html lede>");
    expect(
      fakeApi.calls.map((c) => (c.input as { parent: string }).parent)
    ).toEqual(["column", "row", "column"]);
    expect(toasts).toEqual(["HTML copied"]);
  });

  it("writes an element selected with one inside it once, with what is inside it", async () => {
    selectMany([at("per"), at("row")]);
    await copyCode(at("row"), "html");
    expect(clipboard).toBe("<html row>");
  });

  it("opens the clipboard's write with the click, before the code is written", async () => {
    let answer: (code: string) => unknown = () => undefined;
    fakeApi.respond(
      "code.write",
      () =>
        new Promise((resolve) => {
          answer = (code) => resolve({ code, language: "html" });
        })
    );
    const copied = copyCode(at("title"), "html");
    // Still in the click: the write is open, its text on its way.
    expect(events).toEqual(["write opened"]);
    expect(clipboard).toBeNull();
    answer("<p>title</p>");
    await copied;
    expect(clipboard).toBe("<p>title</p>");
  });

  it("writes nothing when the code cannot be written, and reports why", async () => {
    fakeApi.respond("code.write", ({ node }) =>
      node.id === "lede"
        ? Promise.reject(new RequestError("internal", "no code for lede"))
        : { code: node.id, language: "html" }
    );
    selectMany([at("title"), at("lede")]);
    await copyCode(at("title"), "html");
    expect(clipboard).toBeNull();
    expect(toasts).toEqual([]);
    expect(useProject.getState().error).toContain("no code for lede");
  });
});
