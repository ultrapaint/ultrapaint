// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { defaultSettings } from "@ultrapaint/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComponents } from "../state/components.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { Library } from "./library.tsx";

const { drawSpecimen, insertNode } = vi.hoisted(() => ({
  drawSpecimen: vi.fn<() => Promise<string | null>>(),
  insertNode: vi.fn(),
}));

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);
vi.mock("../canvas/specimens.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../canvas/specimens.ts")>()),
  drawSpecimen,
}));
vi.mock("../lib/node-actions.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/node-actions.ts")>()),
  insertNode,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW_KEY = "ultrapaint:library-view";
const initialProject = useProject.getState();

let mounted: Root;
let container: HTMLElement;
/** Resolves once every component listed has been drawn, or has failed to be. */
let allDrawn: Promise<void>;

/** Every component is drawn as nothing, as a specimen that does not render is. */
const drawNothing = () => {
  const count = useComponents.getState().catalogue.length;
  let drawn = 0;
  let done: () => void = () => undefined;
  allDrawn = new Promise((resolve) => {
    done = resolve;
  });
  drawSpecimen.mockImplementation(() => {
    drawn += 1;
    if (drawn === count) {
      done();
    }
    return Promise.resolve(null);
  });
};

/**
 * Waits for the stored thumbnails' read to land, which starts the draws, then for the draws, then
 * for what the last one sets off to be drawn.
 */
const settled = async () => {
  await act(() => Promise.resolve());
  await act(() => allDrawn);
  await act(() => Promise.resolve());
};

const tile = (name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const loading = () => container.querySelectorAll(".animate-pulse").length;
const noPicture = () => container.querySelectorAll("[data-no-picture]").length;

const choose = (view: "List" | "Grid") =>
  act(() =>
    container
      .querySelector<HTMLButtonElement>(`[aria-label="${view}"]`)
      ?.click()
  );

beforeEach(() => {
  fakeApi.reset();
  localStorage.setItem(VIEW_KEY, "grid");
  useProject.setState({
    info: { ...initialProject.info, configured: true, name: "shop" },
    settings: defaultSettings("/repo"),
  });
  drawNothing();
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  localStorage.removeItem(VIEW_KEY);
  useProject.setState(initialProject, true);
  drawSpecimen.mockReset();
  insertNode.mockReset();
});

describe("the Library's grid", () => {
  it("shows a tile that cannot be drawn as having no picture, not as loading", async () => {
    // No stored thumbnails can be read: thumbnails.get has no answer, so every one is drawn here.
    act(() => mounted.render(<Library />));
    await settled();
    expect(loading()).toBe(0);
    expect(noPicture()).toBe(useComponents.getState().catalogue.length);
  });

  it("draws again what failed when the grid is opened again", async () => {
    act(() => mounted.render(<Library />));
    await settled();
    const first = drawSpecimen.mock.calls.length;
    await choose("List");
    drawNothing();
    await choose("Grid");
    await settled();
    expect(drawSpecimen.mock.calls.length).toBe(first * 2);
  });

  it("inserts a component from a click on its name, which is part of its tile", async () => {
    act(() => mounted.render(<Library />));
    await settled();
    const button = tile("Button");
    const name = [...(button?.querySelectorAll("span") ?? [])].find(
      (s) => s.textContent === "Button"
    );
    expect(name).toBeDefined();
    act(() => name?.click());
    expect(insertNode).toHaveBeenCalledOnce();
    expect(insertNode.mock.calls[0]?.[0]).toMatchObject({
      component: "Button",
    });
  });
});
