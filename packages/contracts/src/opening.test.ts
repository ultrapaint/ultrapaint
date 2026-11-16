import { describe, expect, it } from "vitest";
import {
  estimateFrom,
  failOpening,
  noteLine,
  type Opening,
  openingSteps,
  problemOf,
  reachStep,
  stepTimes,
} from "./opening.ts";

const local = (): Opening => ({
  log: [],
  name: "bike-shop",
  remote: false,
  since: 1000,
  steps: openingSteps("local"),
  where: "~/Code/bike-shop",
});

describe("an opening", () => {
  it("names the steps of each kind of open", () => {
    expect(openingSteps("local").map((s) => s.label)).toEqual([
      "Starting the server",
      "Reading the project",
      "Drawing the canvas",
    ]);
    expect(openingSteps("ssh", "naf-mini").map((s) => s.label)).toEqual([
      "Connecting to naf-mini",
      "Starting ultrapaint there",
      "Loading the editor",
      "Reading the project",
    ]);
    expect(openingSteps("browser").map((s) => s.id)).toEqual([
      "editor",
      "project",
      "canvas",
    ]);
  });

  it("times each step from when it began to when the next one did", () => {
    let o = reachStep(local(), "server", 1000);
    o = reachStep(o, "project", 1450);
    o = reachStep(o, "canvas", 1700);
    expect(o.steps.map((s) => [s.id, s.state, s.ms])).toEqual([
      ["server", "done", 450],
      ["project", "done", 250],
      ["canvas", "now", undefined],
    ]);
    expect(o.steps[2]?.since).toBe(1700);
    o = reachStep(o, null, 1800);
    expect(stepTimes(o)).toEqual({ canvas: 100, project: 250, server: 450 });
  });

  it("keeps the last line printed, on the step at work and in the log", () => {
    let o = reachStep(local(), "server", 1000);
    o = noteLine(o, "pnpm install · 214 packages\n");
    o = noteLine(o, "   ");
    expect(o.steps[0]?.line).toBe("pnpm install · 214 packages");
    expect(o.log).toEqual(["pnpm install · 214 packages"]);
    o = reachStep(o, "project", 1200);
    expect(o.steps[0]?.line).toBeUndefined();
  });

  it("marks the step at work failed, with the reason and what to do", () => {
    let o = reachStep(local(), "server", 1000);
    o = failOpening(
      o,
      "naf-mini did not accept a key. Load your key into the agent with ssh-add, then try again:\nPermission denied (publickey)",
      1400
    );
    expect(o.steps[0]).toMatchObject({ ms: 400, state: "failed" });
    expect(o.problem).toEqual({
      hint: "Load your key into the agent with ssh-add, then try again.",
      reason: "naf-mini did not accept a key.",
    });
  });

  it("says a message of one sentence as its reason alone", () => {
    expect(
      problemOf("the server did not say where it listens within 90 seconds")
    ).toEqual({
      reason: "The server did not say where it listens within 90 seconds.",
    });
  });

  it("estimates from the last open only when every step has a time", () => {
    const steps = openingSteps("local");
    expect(estimateFrom(steps, undefined)).toBeUndefined();
    expect(estimateFrom(steps, { project: 200, server: 500 })).toBeUndefined();
    expect(
      estimateFrom(steps, { canvas: 300, project: 200, server: 500 })
    ).toBe(1000);
  });
});
