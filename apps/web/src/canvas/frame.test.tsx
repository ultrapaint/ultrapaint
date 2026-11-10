// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useSkeletons } from "./agent-work.tsx";
import { frameOf } from "./editor-frame.ts";
import { useWatchedRects } from "./frame.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** The turn is over: a handle with nothing left of it is forgotten. */
const turnOver = () => Promise.resolve();

/** What a frame with a selection in it tells its handle, drawn and taken away again. */
const drawnAndGone = async (id: string, Told: () => null) => {
  const handle = frameOf(id);
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Told />));
  await turnOver();
  const held = frameOf(id) === handle;
  act(() => root.unmount());
  await turnOver();
  return { forgotten: frameOf(id) !== handle, held };
};

describe("a frame taken off the canvas", () => {
  it("leaves no node watched on its handle, which is forgotten", async () => {
    const Watching = () => {
      useWatchedRects("watched", ["selected", null, "hovered"]);
      return null;
    };
    expect(await drawnAndGone("watched", Watching)).toEqual({
      forgotten: true,
      held: true,
    });
  });

  it("leaves no skeleton on its handle, which is forgotten", async () => {
    const Working = () => {
      useSkeletons("working", ["title"]);
      return null;
    };
    expect(await drawnAndGone("working", Working)).toEqual({
      forgotten: true,
      held: true,
    });
  });
});
