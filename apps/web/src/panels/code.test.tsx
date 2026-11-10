// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { viewFrameOf } from "../state/frame-ref.ts";
import { useProject } from "../state/project.ts";
import { select } from "../state/selection.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { CodePanel } from "./code.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";

const text = (id: string): DesignNode =>
  ({ id, role: "paragraph", text: id, type: "text" }) as DesignNode;

const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: [text("title"), text("lede")],
    id: "home",
    type: "page",
  } as DesignNode,
};

const initialEditor = useEditor.getState();
const initialProject = useProject.getState();

let mounted: Root;
let container: HTMLElement;

/** Selects a node and waits for the answer about its code to be drawn. */
const selectAndRead = async (nodeId: string, asked: number, frame = HOME) => {
  act(() => select({ frame, nodeId }));
  await act(() => fakeApi.requested("code.write", asked));
};

beforeEach(() => {
  fakeApi.reset();
  // The title's code is written; the lede's cannot be.
  fakeApi.respond("code.write", ({ node }) =>
    node.id === "title"
      ? { code: "<p>the title's code</p>", language: "tsx" }
      : Promise.reject(new RequestError("internal", "no code"))
  );
  useEditor.setState(initialEditor, true);
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
    workspace: "design",
  });
  useDocuments.setState({ canvas: "main", docs: { [HOME]: home } });
  useProject.setState(initialProject, true);
  useProject.setState({
    pages: [
      {
        canvas: "main",
        file: `designs/main/${HOME}`,
        id: HOME,
        name: "Home",
        path: HOME,
        route: "/orders",
      },
    ],
  });
  container = document.createElement("div");
  mounted = createRoot(container);
  act(() => mounted.render(<CodePanel />));
});

afterEach(() => {
  act(() => mounted.unmount());
});

describe("the code of the node selected", () => {
  it("is not the last node's when its own could not be written", async () => {
    await selectAndRead("title", 1);
    expect(container.textContent).toContain("the title's code");
    await selectAndRead("lede", 2);
    expect(container.textContent).toContain("Couldn’t write the code");
    expect(container.textContent).not.toContain("the title's code");
  });

  it("is asked for in its canvas, whose pages its links lead to", async () => {
    await selectAndRead("title", 1);
    expect(fakeApi.calls.at(-1)).toMatchObject({
      input: { canvas: "main", node: { id: "title" } },
      method: "code.write",
    });
  });

  it("names a page's component in a view of the page as in its own frame", async () => {
    await selectAndRead("home", 1, viewFrameOf(HOME, "tablet"));
    expect(fakeApi.calls.at(-1)?.input).toMatchObject({
      component: "OrdersPage",
    });
  });
});
