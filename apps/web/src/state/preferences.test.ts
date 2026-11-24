// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  type AgentsAtWork,
  agentSweeps,
  applyPreferences,
  DEFAULT_PREFERENCES,
  type Motion,
  readPreferences,
} from "./preferences.ts";

describe("the person's preferences", () => {
  it("are the defaults when nothing was kept, or something unreadable", () => {
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences("not json")).toEqual(DEFAULT_PREFERENCES);
  });

  it("keep each value only when it is one of its choices", () => {
    expect(
      readPreferences(
        JSON.stringify({
          accent: "teal",
          motion: "sideways",
          textSize: "large",
        })
      )
    ).toEqual({ ...DEFAULT_PREFERENCES, accent: "teal", textSize: "large" });
  });

  it("keep how the chat list is grouped, By state when nothing or an unknown grouping was kept", () => {
    expect(DEFAULT_PREFERENCES.chatGrouping).toBe("state");
    expect(
      readPreferences(JSON.stringify({ chatGrouping: "page" })).chatGrouping
    ).toBe("page");
    expect(
      readPreferences(JSON.stringify({ chatGrouping: "colour" })).chatGrouping
    ).toBe("state");
  });

  it("mark an agent at work as Animated, unless Calm was kept", () => {
    expect(DEFAULT_PREFERENCES.agentsAtWork).toBe("animated");
    expect(
      readPreferences(JSON.stringify({ agentsAtWork: "calm" })).agentsAtWork
    ).toBe("calm");
    expect(
      readPreferences(JSON.stringify({ agentsAtWork: "still" })).agentsAtWork
    ).toBe("animated");
  });

  it("are drawn on the root, where the stylesheet reads them", () => {
    const root = document.createElement("html");
    applyPreferences(
      { ...DEFAULT_PREFERENCES, accent: "graphite", contrast: true },
      root
    );
    expect(root.dataset).toMatchObject({
      accent: "graphite",
      contrast: "more",
      motion: "system",
      textSize: "default",
    });
    applyPreferences(DEFAULT_PREFERENCES, root);
    expect(root.dataset.contrast).toBeUndefined();
  });

  it("leave Agents at work off the root: the canvas's overlays read it", () => {
    const root = document.createElement("html");
    applyPreferences({ ...DEFAULT_PREFERENCES, agentsAtWork: "calm" }, root);
    expect(root.dataset.agentsAtWork).toBeUndefined();
  });
});

describe("the light passing through an agent's work", () => {
  const under = (
    agentsAtWork: AgentsAtWork,
    motion: Motion,
    systemReduces = false
  ) => agentSweeps({ agentsAtWork, motion }, systemReduces);

  it("passes under Animated while motion is not reduced", () => {
    expect(under("animated", "system")).toBe(true);
    expect(under("animated", "full")).toBe(true);
  });

  it("passes under Full even when the computer asks for reduced motion", () => {
    expect(under("animated", "full", true)).toBe(true);
  });

  it("is still under Reduced, and under System when the computer asks for reduced motion", () => {
    expect(under("animated", "reduced")).toBe(false);
    expect(under("animated", "system", true)).toBe(false);
  });

  it("is still under Calm, whatever the motion", () => {
    expect(under("calm", "full")).toBe(false);
    expect(under("calm", "system")).toBe(false);
  });
});
