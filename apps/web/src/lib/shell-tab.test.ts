// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { afterEach, describe, expect, it } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { useProject } from "../state/project.ts";
import { followShellTab } from "./shell-tab.ts";

const initial = useProject.getState();

afterEach(() => {
  setPlatform(null);
  useProject.setState(initial, true);
});

describe("followShellTab", () => {
  it("tells the desktop app the project's name and icon once read, and at each change", () => {
    const told: unknown[] = [];
    setPlatform({
      projects: {
        describe: (look: unknown) => {
          told.push(look);
          return Promise.resolve();
        },
      },
      serverUrl: "",
    } as unknown as Platform);
    const stop = followShellTab();
    // Not read yet: nothing to say.
    expect(told).toEqual([]);
    const info = { ...initial.info, name: "shop" };
    useProject.setState({ info, loaded: true });
    // Something else changed: said once only.
    useProject.setState({ settingsOpen: true });
    const icon = { color: "blue", kind: "icon", name: "boxes" } as const;
    useProject.setState({ info: { ...info, icon, name: "shop-admin" } });
    stop();
    expect(told).toEqual([{ name: "shop" }, { icon, name: "shop-admin" }]);
  });
});
