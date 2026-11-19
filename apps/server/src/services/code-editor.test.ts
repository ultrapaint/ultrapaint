import { describe, expect, it } from "vitest";
import { isTerminalEditor } from "./code-editor.ts";

describe("the person's code editor (ADR 0106)", () => {
  it("knows an editor that runs in a terminal by its command, wherever it is", () => {
    expect(isTerminalEditor("vim")).toBe(true);
    expect(isTerminalEditor("/usr/bin/nvim -p")).toBe(true);
    expect(isTerminalEditor("code")).toBe(false);
    expect(isTerminalEditor("/Applications/Zed.app/Contents/MacOS/cli")).toBe(
      false
    );
  });
});
