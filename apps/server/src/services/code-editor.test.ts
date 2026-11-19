import guessEditor from "launch-editor/guess.js";
import { describe, expect, it } from "vitest";
import { commandOf, isTerminalEditor } from "./code-editor.ts";

describe("the person's code editor (ADR 0106)", () => {
  it("knows an editor that runs in a terminal by its command, wherever it is", () => {
    expect(isTerminalEditor("vim")).toBe(true);
    expect(isTerminalEditor("/usr/bin/nvim -p")).toBe(true);
    expect(isTerminalEditor("/tmp/editor tools/vim")).toBe(true);
    expect(isTerminalEditor("code")).toBe(false);
    expect(isTerminalEditor("/Applications/Zed.app/Contents/MacOS/cli")).toBe(
      false
    );
  });

  it("writes the editor it checked back as the command the library reads, a path with spaces kept whole", () => {
    const parts = ["/Applications/Visual Studio Code.app/bin/code", "-r"];
    // Read back as the library reads a command it is given.
    expect(guessEditor(commandOf(parts))).toEqual(parts);
    expect(guessEditor(commandOf(["it's"]))).toEqual(["it's"]);
  });
});
