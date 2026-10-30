// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type {
  DesignNode,
  DocumentState,
} from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openBoard, useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useIsolation } from "../state/isolation.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Inspector } from "./inspector.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
/** Promo's board, which draws its tree with no variant to choose. */
const PROMO_BOARD = "board:library/Promo/component";

const text = (id: string): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text" }) as DesignNode;

const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: { children: [text("title")], id: "home", type: "page" } as DesignNode,
};

const initialEditor = useEditor.getState();
const initialBoard = useBoard.getState();

let mounted: Root;
let container: HTMLElement;

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main", variants: [] }],
    info: { configured: true, storage: { mode: "managed" } },
    pages: [
      {
        canvas: "main",
        file: `designs/${HOME}`,
        id: HOME,
        name: "Home",
        path: HOME,
        route: "/",
      },
    ],
  });
  useComponents.setState({
    components: [
      {
        name: "Promo",
        origin: "app",
        properties: [],
        slots: [],
        tree: { children: [text("sale")], id: "p-root", type: "column" },
        version: 1,
      } as never,
    ],
  });
  useEditor.setState(initialEditor, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    workspace: "design",
  });
  useBoard.setState(initialBoard, true);
  useIsolation.setState({ isolated: null });
  useDocuments.setState({ canvas: "main", docs: { [HOME]: home } });
  container = document.createElement("div");
  mounted = createRoot(container);
  act(() => mounted.render(<Inspector />));
});

afterEach(() => {
  act(() => mounted.unmount());
});

describe("the inspector's sections", () => {
  it("say where a node of a page leads in the prototype", () => {
    act(() => useEditor.getState().select({ frame: HOME, nodeId: "title" }));
    expect(container.textContent).toContain("Prototype");
  });

  it("have no prototype for a node of an app component's tree on its board", () => {
    act(() => {
      openBoard({ item: "Promo", view: "library" });
      useEditor.getState().select({ frame: PROMO_BOARD, nodeId: "sale" });
    });
    expect(useEditor.getState().selection?.nodeId).toBe("sale");
    expect(container.textContent).toContain("sale");
    expect(container.textContent).not.toContain("Prototype");
  });
});
