import { describe, expect, it } from "vitest";
import type { Selection } from "./editor.ts";
import {
  emptyMemory,
  modeFor,
  nothingPicked,
  type Picked,
  stillThere,
  switchWorkspace,
} from "./workspace-memory.ts";

const a: Selection = { frame: "p1", nodeId: "a" };
const b: Selection = { frame: "p1", nodeId: "b" };
const c: Selection = { frame: "p2", nodeId: "c" };

const picked: Picked = { also: [b], selection: a };

const everything = { node: () => true };

describe("modeFor", () => {
  it("gives a workspace never left its first tool", () => {
    expect(modeFor("design", undefined)).toBe("select");
    expect(modeFor("prototype", undefined)).toBe("interact");
  });

  it("gives the prototype none of the canvas's tools", () => {
    expect(modeFor("prototype", "comment")).toBe("comment");
    expect(modeFor("prototype", "group")).toBe("interact");
    expect(modeFor("prototype", "pan")).toBe("interact");
  });

  it("gives a canvas workspace the tool it was left with", () => {
    expect(modeFor("design", "text")).toBe("text");
  });
});

describe("stillThere", () => {
  it("keeps what can still be found", () => {
    expect(stillThere(picked, everything)).toEqual(picked);
  });

  it("puts the next one in place of a deleted node the inspector showed", () => {
    const kept = stillThere(
      { also: [b], selection: a },
      { node: (s) => s.nodeId !== "a" }
    );
    expect(kept).toEqual({ also: [], selection: b });
  });

  it("leaves out others of another frame", () => {
    const kept = stillThere({ also: [c, b], selection: a }, everything);
    expect(kept.also).toEqual([b]);
  });

  it("drops a deleted page's root", () => {
    const root: Selection = { frame: "p9", nodeId: "root" };
    const kept = stillThere(
      { also: [], selection: root },
      { node: (s) => s.frame !== "p9" }
    );
    expect(kept).toEqual(nothingPicked);
  });
});

describe("switchWorkspace", () => {
  it("selects nothing in the prototype, and finds the selection again after it", () => {
    const away = switchWorkspace(
      { mode: "pan", picked, workspace: "design" },
      "prototype",
      emptyMemory,
      everything
    );
    expect(away.picked).toEqual(nothingPicked);
    expect(away.mode).toBe("interact");

    const back = switchWorkspace(
      { mode: "comment", picked: away.picked, workspace: "prototype" },
      "design",
      away.memory,
      everything
    );
    expect(back.picked).toEqual(picked);
    expect(back.mode).toBe("pan");
    expect(back.memory.putAside).toBeNull();
    expect(back.memory.modes.prototype).toBe("comment");
  });

  it("finds again only what was not deleted while the prototype was shown", () => {
    const away = switchWorkspace(
      { mode: "select", picked, workspace: "design" },
      "prototype",
      emptyMemory,
      everything
    );
    const back = switchWorkspace(
      { mode: "interact", picked: nothingPicked, workspace: "prototype" },
      "design",
      away.memory,
      { node: () => false }
    );
    expect(back.picked).toEqual(nothingPicked);
  });

  it("restores each workspace's own tool", () => {
    let memory = emptyMemory;
    const go = (
      from: "design" | "prototype",
      mode: "select" | "text" | "comment" | "pan" | "interact",
      to: "design" | "prototype"
    ) => {
      const next = switchWorkspace(
        { mode, picked: nothingPicked, workspace: from },
        to,
        memory,
        everything
      );
      ({ memory } = next);
      return next.mode;
    };
    expect(go("design", "text", "prototype")).toBe("interact");
    expect(go("prototype", "comment", "design")).toBe("text");
    expect(go("design", "pan", "prototype")).toBe("comment");
    expect(go("prototype", "interact", "design")).toBe("pan");
  });
});
