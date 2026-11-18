// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { type Platform, setPlatform } from "../platform.ts";
import { useProject } from "../state/project.ts";
import { ShellNotices } from "./shell-notices.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);

afterEach(() => {
  act(() => root.render(null));
  setPlatform(null);
  useProject.setState({ settingsOpen: false });
});

describe("the shell's notices", () => {
  it("say what is wrong in one line, and Details opens the settings that say the rest", async () => {
    setPlatform({
      notices: () =>
        Promise.resolve([
          { id: "node", section: "about", title: "Node.js didn’t run" },
        ]),
      serverUrl: "ws://localhost:4000/ws",
    } as unknown as Platform);
    await act(async () => root.render(<ShellNotices />));
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "Node.js didn’t run"
    );
    const details = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Details"
    );
    await act(async () => details?.click());
    expect(useProject.getState()).toMatchObject({
      settingsOpen: true,
      settingsSection: "about",
    });
  });
});
