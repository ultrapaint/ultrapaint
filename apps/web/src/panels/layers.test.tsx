// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { until } from "../testing/until.ts";
import { Layers } from "./layers.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;

beforeEach(() => {
  fakeApi.reset();
  useEditor.setState({ canvas: "" });
  useProject.setState({ error: null, pages: [] });
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  useDocuments.setState({
    canvas: null,
    docs: {},
    failed: false,
    loaded: false,
  });
  useEditor.setState({ canvas: null });
});

describe("Layers while the canvas's documents are read", () => {
  it("says they didn't load in place of the loading rows, and Try again reads them", async () => {
    fakeApi.respond("documents.list", () =>
      Promise.reject(new Error("the server is gone"))
    );
    await act(() => useDocuments.getState().load(""));
    act(() => mounted.render(<Layers />));
    expect(container.querySelector("[aria-label='Loading layers']")).toBeNull();
    // Said as an alert in the list's place, as every panel says a failed load (ADR 0080).
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "The layers didn’t loadTry again"
    );

    fakeApi.respond("documents.list", () => []);
    act(() =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Try again")
        ?.click()
    );
    await act(() => until(useDocuments, (s) => s.loaded));
    expect(container.textContent).not.toContain("didn’t load");
    expect(container.textContent).toContain("No pages yet");
  });
});
