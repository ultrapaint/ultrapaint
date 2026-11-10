// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { ReviewSettings } from "@ultrapaint/contracts/review";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../testing/fake-api.ts";
import { ReviewGroup } from "./settings-review.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;
let saved: (ReviewSettings | undefined)[];

const render = (review: ReviewSettings | undefined) => {
  act(() => {
    mounted.render(
      <ReviewGroup onChange={(next) => saved.push(next)} review={review} />
    );
  });
};

const level = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name);

const pressed = () =>
  [...container.querySelectorAll("button[aria-pressed=true]")].map(
    (b) => b.textContent
  );

const rows = () =>
  [...container.querySelectorAll("label")].map((l) => l.textContent);

beforeEach(() => {
  fakeApi.reset();
  fakeApi.respond("agents.options", () => []);
  saved = [];
  container = document.createElement("div");
  mounted = createRoot(container);
});

afterEach(() => {
  act(() => mounted.unmount());
});

describe("Settings › Agents › Review", () => {
  it("shows the project's level, Standard when nothing is set, with what it does", () => {
    render(undefined);
    expect(pressed()).toEqual(["Standard"]);
    expect(container.textContent).toContain(
      "One review model looks, in turn; then all of them check the fixes."
    );
    // Keeping findings is the person's, in Preferences (ADR 0066).
    expect(rows()).toEqual(["Level", "Review models"]);
  });

  it("saves a level as its settings, the defaults left out", () => {
    render(undefined);
    act(() => level("Quick")?.click());
    expect(saved.at(-1)).toEqual({ approval: "one", eachRound: "one" });
    act(() => level("Off")?.click());
    expect(saved.at(-1)).toEqual({ on: false });
  });

  it("shows Off with its warning, and no review models to choose", () => {
    render({ on: false });
    expect(pressed()).toEqual(["Off"]);
    expect(container.textContent).toContain("Not recommended.");
    expect(rows()).toEqual(["Level"]);
  });

  it("opens Custom's rows when chosen, and is Custom with a goal", () => {
    render(undefined);
    act(() => level("Custom")?.click());
    expect(saved).toEqual([]);
    expect(rows()).toEqual([
      "Level",
      "Review models",
      "Each round",
      "Approval",
      "Goal",
    ]);
    render({ goal: { score: 90 } });
    expect(pressed()).toContain("Custom");
    expect(pressed()).toContain("A score");
  });

  it("keeps a saved Custom's rows while one is set to what a named level has", () => {
    // Everyone looks each round and the round's reviewer approves: no named level.
    render({ approval: "one", eachRound: "all" });
    expect(pressed()).toContain("Custom");
    act(() => level("One")?.click());
    // Quick's own settings now, and still Custom's rows to go on choosing with.
    expect(saved.at(-1)).toEqual({ approval: "one", eachRound: "one" });
    render(saved.at(-1));
    expect(pressed()).toContain("Custom");
    expect(rows()).toEqual([
      "Level",
      "Review models",
      "Each round",
      "Approval",
      "Goal",
    ]);
    // A level pressed puts them away.
    act(() => level("Quick")?.click());
    render(saved.at(-1));
    expect(pressed()).toEqual(["Quick"]);
    expect(rows()).toEqual(["Level", "Review models"]);
  });

  it("moves nothing on a drop after a drag let go outside the list", () => {
    render({
      reviewModels: [
        { agentId: "claude", model: "opus" },
        { agentId: "codex", model: "sol" },
      ],
    });
    act(() =>
      container
        .querySelector<HTMLElement>("button[aria-label^='Review models']")
        ?.click()
    );
    const handle = (name: string) =>
      document.body.querySelector<HTMLElement>(
        `button[aria-label='Move ${name}']`
      );
    const drag = (type: string, target: Element | null | undefined) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const data = new Map<string, string>();
      Object.assign(event, {
        dataTransfer: {
          effectAllowed: "uninitialized",
          setData: (format: string, value: string) => data.set(format, value),
        },
      });
      act(() => {
        target?.dispatchEvent(event);
      });
      return { data, event };
    };
    const picked = drag("dragstart", handle("opus"));
    // What the browser carries, so the drag starts in every browser.
    expect(picked.data.get("text/plain")).toBe("opus");
    drag("dragend", handle("opus"));
    drag("drop", handle("sol")?.closest("li"));
    expect(saved).toEqual([]);

    drag("dragstart", handle("opus"));
    drag("drop", handle("sol")?.closest("li"));
    expect(saved.at(-1)?.reviewModels?.map((m) => m.model)).toEqual([
      "sol",
      "opus",
    ]);
  });
});
