// @vitest-environment happy-dom
import {
  type Opening,
  openingSteps,
  reachStep,
} from "@ultrapaint/contracts/opening";
import { afterEach, describe, expect, it } from "vitest";
import {
  browserOpening,
  editorTimes,
  keepOpeningHere,
  LAST_OPENING_KEY,
  withEditorSteps,
} from "./editor-opening.ts";

afterEach(() => localStorage.clear());

/** A local project the shell opened: its server took 500 ms, the editor's steps begin at 1500. */
const fromShell = (): Opening => {
  let opening: Opening = {
    log: [],
    name: "bike-shop",
    remote: false,
    since: 1000,
    steps: openingSteps("local"),
    where: "~/Code/bike-shop",
  };
  opening = reachStep(opening, "server", 1000);
  return reachStep(opening, "project", 1500);
};

describe("the editor's steps of an open", () => {
  it("finish the shell's, timed from where it left off", () => {
    const opening = withEditorSteps(fromShell(), {
      editor: 1600,
      project: 1800,
    });
    expect(opening.steps.map((s) => [s.id, s.state, s.ms])).toEqual([
      ["server", "done", 500],
      // The editor's code counts in the step after it, which this open does not list.
      ["project", "done", 300],
      ["canvas", "now", undefined],
    ]);
    expect(opening.steps[2]?.since).toBe(1800);
    expect(
      editorTimes(withEditorSteps(fromShell(), { canvas: 2000, project: 1800 }))
    ).toEqual({ canvas: 200, project: 300 });
  });

  it("are the whole open in a browser, its estimate the last one here", () => {
    expect(browserOpening({ name: "", since: 0, where: "" }).estimate).toBe(
      undefined
    );
    keepOpeningHere({ canvas: 300, editor: 400, project: 200 });
    const here = browserOpening({ name: "bike-shop", since: 0, where: "" });
    expect(here.estimate).toBe(900);
    expect(withEditorSteps(here, {}).steps.map((s) => s.state)).toEqual([
      "now",
      "next",
      "next",
    ]);
  });

  it("have no estimate when what the browser kept is unreadable", () => {
    localStorage.setItem(LAST_OPENING_KEY, "{not json");
    expect(browserOpening({ name: "", since: 0, where: "" }).estimate).toBe(
      undefined
    );
  });
});
