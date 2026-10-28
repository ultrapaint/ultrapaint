import { describe, expect, it } from "vitest";
import { type CapabilityName, SHELL_BRIDGE } from "./shell-bridge.ts";

const names = Object.keys(SHELL_BRIDGE) as CapabilityName[];

describe("the shell bridge's table", () => {
  it("shows or hides a group whole, so a part the editor finds is all there", () => {
    const groups = new Map<string, Set<boolean>>();
    for (const name of names.filter((n) => n.includes("."))) {
      const group = name.split(".")[0] ?? name;
      const shown = groups.get(group) ?? new Set();
      shown.add(SHELL_BRIDGE[name].remote);
      groups.set(group, shown);
    }
    for (const [group, shown] of groups) {
      expect([group, shown.size]).toEqual([group, 1]);
    }
  });

  it("hides only this machine's agents and notices from a project on another machine", () => {
    expect(names.filter((name) => !SHELL_BRIDGE[name].remote)).toEqual([
      "agents.choosePath",
      "agents.clearPath",
      "agents.download",
      "agents.list",
      "agents.setApiKey",
      "agents.signIn",
      "notices",
    ]);
  });

  it("nests no deeper than a group, and no name is both a group and a capability", () => {
    const groups = new Set(
      names.filter((n) => n.includes(".")).map((n) => n.split(".")[0])
    );
    for (const name of names) {
      expect(name.split(".").length).toBeLessThanOrEqual(2);
      expect(groups.has(name)).toBe(false);
    }
  });
});
