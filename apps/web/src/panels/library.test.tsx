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
const initialComponents = useComponents.getState();

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
  // The catalogue read: the system components, and no app component.
  useComponents.setState({ status: "ready" });
  // Nothing lands: no canvas takes it.
  insertNode.mockReturnValue([]);
  drawNothing();
  container = document.createElement("div");
  // In the document, so that focus moves.
  document.body.append(container);
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  localStorage.removeItem(VIEW_KEY);
  useProject.setState(initialProject, true);
  useComponents.setState(initialComponents, true);
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

const sectionTitles = () =>
  [...container.querySelectorAll("h3")].map((h) => h.textContent);
const rowNamed = (name: string) =>
  [...container.querySelectorAll<HTMLElement>("[data-row]")].find(
    (r) => r.textContent === name || r.getAttribute("aria-label") === name
  );
/** Types into the search, as React hears it. */
const search = (text: string) =>
  act(() => {
    const field = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search components"]'
    );
    if (field) {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
const press = (target: HTMLElement | undefined, key: string) =>
  act(() => {
    target?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key })
    );
  });

describe("the Library's catalogue", () => {
  it("draws skeleton rows under both groups while the catalogue is read", () => {
    useComponents.setState({ status: "loading" });
    act(() => mounted.render(<Library />));
    expect(container.querySelectorAll("section[aria-busy]").length).toBe(2);
    expect(sectionTitles()).toEqual(["App components", "System components"]);
    expect(container.querySelectorAll("[data-row]").length).toBe(0);
  });

  it("says the catalogue didn’t load, and reads it again with Try again", async () => {
    useComponents.setState({ status: "loading" });
    localStorage.setItem(VIEW_KEY, "list");
    act(() => mounted.render(<Library />));
    // components.list has no answer: the read fails.
    await act(() => useComponents.getState().load());
    expect(container.textContent).toContain("The components didn’t load");
    expect(container.querySelectorAll("[data-row]").length).toBe(0);

    fakeApi.respond("components.list", () => ({ components: [] }));
    const retry = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again"
    );
    await act(async () => {
      retry?.click();
      await fakeApi.requested("components.list", 2);
    });
    await act(() => Promise.resolve());
    expect(container.textContent).not.toContain("didn’t load");
    expect(rowNamed("Button")).toBeDefined();
  });
});

describe("the Library's Recent group", () => {
  it("is shown only once a component is placed, leads the list, and is kept for the project", async () => {
    localStorage.setItem(VIEW_KEY, "list");
    useProject.setState({
      info: { ...useProject.getState().info, repoPath: "/recent-shop" },
    });
    insertNode.mockReturnValue(Promise.resolve(["n1"]));
    act(() => mounted.render(<Library />));
    expect(sectionTitles()).not.toContain("Recent");

    await act(async () => {
      rowNamed("Card")?.click();
      await Promise.resolve();
    });
    expect(sectionTitles()[0]).toBe("Recent");
    expect(
      container.querySelector("section")?.querySelector("[data-row]")
        ?.textContent
    ).toBe("Card");
    expect(
      localStorage.getItem("ultrapaint:recent-components:/recent-shop")
    ).toBe(JSON.stringify(["Card"]));

    // A search leaves it out.
    search("card");
    expect(sectionTitles()).not.toContain("Recent");
    search("");
    expect(sectionTitles()[0]).toBe("Recent");

    // Another project has its own.
    act(() =>
      useProject.setState({
        info: { ...useProject.getState().info, repoPath: "/other-shop" },
      })
    );
    expect(sectionTitles()).not.toContain("Recent");
    localStorage.removeItem("ultrapaint:recent-components:/recent-shop");
  });

  it("is not recorded for an insert that did not land", async () => {
    localStorage.setItem(VIEW_KEY, "list");
    useProject.setState({
      info: { ...useProject.getState().info, repoPath: "/nowhere-shop" },
    });
    act(() => mounted.render(<Library />));
    await act(async () => {
      rowNamed("Card")?.click();
      await Promise.resolve();
    });
    expect(sectionTitles()).not.toContain("Recent");
  });
});

describe("the Library's keyboard", () => {
  it("is one Tab stop per group, the arrow keys moving among its rows", () => {
    localStorage.setItem(VIEW_KEY, "list");
    act(() => mounted.render(<Library />));
    const rows = [
      ...container.querySelectorAll<HTMLElement>(
        "section:last-child [data-row]"
      ),
    ];
    expect(rows.map((r) => r.tabIndex).filter((t) => t === 0)).toHaveLength(1);
    expect(rows[0]?.tabIndex).toBe(0);
    // The board's chevron is no Tab stop: the row's menu has Open board.
    expect(
      [
        ...container.querySelectorAll<HTMLElement>(
          'section:last-child button[aria-label^="Open "]'
        ),
      ].every((b) => b.tabIndex === -1)
    ).toBe(true);

    act(() => rows[0]?.focus());
    press(rows[0], "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1]?.tabIndex).toBe(0);
    expect(rows[0]?.tabIndex).toBe(-1);
    press(rows[1], "ArrowUp");
    expect(document.activeElement).toBe(rows[0]);
    press(rows[0], "End");
    expect(document.activeElement).toBe(rows.at(-1));
  });

  it("moves across and down a grid's tiles", async () => {
    act(() => mounted.render(<Library />));
    await settled();
    const tiles = [
      ...container.querySelectorAll<HTMLElement>(
        "section:last-child [data-row]"
      ),
    ];
    act(() => tiles[0]?.focus());
    press(tiles[0], "ArrowRight");
    expect(document.activeElement).toBe(tiles[1]);
    press(tiles[1], "ArrowDown");
    expect(document.activeElement).toBe(tiles[3]);
  });
});
