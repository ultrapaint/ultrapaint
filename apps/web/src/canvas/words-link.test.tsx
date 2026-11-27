// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { DesignNode, DocumentState } from "@ultrapaint/contracts/document";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { askWordsLink, WordsLinkPopover } from "./words-link.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "home.page.json";
const TERMS = "terms.page.json";

const home: DocumentState = {
  doc: HOME,
  hash: `${HOME}@0`,
  root: {
    children: [
      {
        id: "legal",
        role: "paragraph",
        text: "By signing up you accept the terms",
        type: "text",
      },
    ],
    id: "home",
    type: "page",
  } as DesignNode,
};

let mounted: Root;
let container: HTMLElement;

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({
    canvases: [{ home: "/", id: "main", name: "Main" }],
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
      {
        canvas: "main",
        file: `designs/${TERMS}`,
        id: TERMS,
        name: "Terms",
        path: TERMS,
        route: "/terms",
      },
    ],
  });
  useEditor.setState({
    canvas: "main",
    frames: {
      [HOME]: { height: 900, preset: "desktop", width: 1440, x: 0, y: 0 },
    },
  });
  useDocuments.setState({ canvas: "main", docs: { [HOME]: home } });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() => mounted.render(<WordsLinkPopover />));
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
});

describe("the words of a text asked about on ⌘K (ADR 0163)", () => {
  const asked = {
    anchor: { height: 16, width: 40, x: 200, y: 120 },
    end: 34,
    frame: HOME,
    nodeId: "legal",
    start: 29,
  };

  it("open the inspector's Goes to by them", () => {
    expect(document.body.textContent).not.toContain("Goes to");
    act(() => askWordsLink(asked));
    expect(document.body.textContent).toContain("Goes to");
    expect(document.querySelector('[role="combobox"]')).not.toBeNull();
  });
});
