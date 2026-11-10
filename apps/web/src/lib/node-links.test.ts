import "../testing/fake-browser.ts";
import type { Page } from "@ultrapaint/contracts/pages";
import { parseEditorLink } from "@ultrapaint/shared/node-ref";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "../state/editor.ts";
import { viewFrameOf } from "../state/frame-ref.ts";
import { useProject } from "../state/project.ts";
import { fakeBrowser } from "../testing/fake-browser.ts";
import { copyNodeLink, copyNodeRef, copyPageLink } from "./node-links.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

// The toast says what was copied; what was copied is the clipboard's.
vi.mock("sonner", () => ({ toast: { success: () => undefined } }));

const page = (path: string, extra: Partial<Page> = {}): Page => ({
  canvas: "main",
  file: `designs/main/${path}`,
  id: `main/${path}`,
  name: path,
  path,
  ...extra,
});

const pricing = page("pricing.page.json", { route: "/pricing" });
const bold = page("pricing@bold.page.json", {
  route: "/pricing",
  variant: "bold",
});
const draft = page("draft.page.json");

const initialEditor = useEditor.getState();
const initialProject = useProject.getState();

/** What the editor copied last. */
let copied = "";

beforeEach(() => {
  copied = "";
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: (text: string) => {
        copied = text;
        return Promise.resolve();
      },
    },
  });
  fakeBrowser.visit("/?canvas=main");
  useEditor.setState({ ...initialEditor, canvas: "main" }, true);
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main", variants: ["bold"] }],
    pages: [pricing, bold, draft],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useEditor.setState(initialEditor, true);
  useProject.setState(initialProject, true);
});

describe("a node's reference", () => {
  it("names a page by its URL, and one without a URL by its file", async () => {
    await copyNodeRef({ frame: pricing.id, nodeId: "c_1" });
    expect(copied).toBe("/pricing#c_1");
    await copyNodeRef({ frame: draft.id, nodeId: "c_1" });
    expect(copied).toBe("draft.page.json#c_1");
  });

  it("names a variant's page by its file, in its own frame or in a view of it", async () => {
    await copyNodeRef({ frame: bold.id, nodeId: "c_1" });
    expect(copied).toBe("pricing@bold.page.json#c_1");
    await copyNodeRef({ frame: viewFrameOf(bold.id, "w390"), nodeId: "c_1" });
    expect(copied).toBe("pricing@bold.page.json#c_1");
  });

  it("says the canvas first when there are several", async () => {
    useProject.setState({
      canvases: [
        { home: "/", id: "main", name: "Main", variants: ["bold"] },
        { home: "/", id: "other", name: "Other", variants: [] },
      ],
    });
    await copyNodeRef({ frame: bold.id, nodeId: "c_1" });
    expect(copied).toBe("main:pricing@bold.page.json#c_1");
  });
});

describe("a link the editor copies", () => {
  it("says the variant of a variant's page, to a node of it and to the page", async () => {
    await copyNodeLink({ frame: bold.id, nodeId: "c_1" });
    expect(parseEditorLink(copied)).toEqual({
      canvas: "main",
      nodeId: "c_1",
      page: "/pricing",
      variant: "bold",
    });
    await copyPageLink(bold);
    expect(parseEditorLink(copied)).toEqual({
      canvas: "main",
      page: "/pricing",
      variant: "bold",
    });
  });

  it("says none for the base page", async () => {
    await copyNodeLink({ frame: pricing.id, nodeId: "c_1" });
    expect(parseEditorLink(copied)).toEqual({
      canvas: "main",
      nodeId: "c_1",
      page: "/pricing",
    });
  });
});
