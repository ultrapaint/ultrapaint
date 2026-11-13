import "../testing/fake-browser.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKeybindings } from "../state/keybindings.ts";
import { keyEventOf } from "../testing/key-events.ts";
import {
  type Binding,
  bindings,
  commandList,
  commands,
  keysOf,
  shortcuts,
} from "./commands.ts";
import { bindingFor, scopeOf } from "./keymap.ts";
import { isMac } from "./keys.ts";
import {
  recordKeys,
  refusalText,
  removeKeys,
  resetKeys,
  searchShortcuts,
  shortcutRows,
  takeKeys,
} from "./rebind.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

afterEach(() => {
  useKeybindings.getState().resetAll();
});

const binding = (id: string): Binding => {
  const found = bindings().find((b) => b.id === id);
  if (!found) {
    throw new Error(`no command ${id}`);
  }
  return found;
};

/** The window's command a chord pressed runs now, on this platform. */
const pressed = (text: string) =>
  bindingFor(keyEventOf(text, isMac), commandList(), [
    "always",
    "editor",
    "canvas",
  ])?.id;

const rowOf = (id: string) => shortcutRows().find((r) => r.binding.id === id);

describe("a command given keys of the person's", () => {
  it("runs by them, and no longer by its own", () => {
    expect(recordKeys(binding("undo"), "mod+u")).toBeNull();
    expect(pressed("mod+u")).toBe("undo");
    expect(pressed("mod+z")).toBeUndefined();
  });

  it("shows them in tooltips, the palette and the shortcut sheet", () => {
    recordKeys(binding("undo"), "mod+u");
    const label = isMac ? "⌘U" : "Ctrl+U";
    expect(keysOf("undo")).toBe(label);
    expect(commands().find((c) => c.id === "undo")?.keys).toBe(label);
    expect(shortcuts().find((s) => s.title === "Undo")?.keys).toBe(label);
  });

  it("is kept in the browser, and read back from it", () => {
    recordKeys(binding("undo"), "mod+u");
    expect(
      JSON.parse(localStorage.getItem("ultrapaint:keybindings") ?? "")
    ).toEqual({ undo: ["mod+u"] });
  });

  it("is given keys of a Layers row, which are reached apart from the window's", () => {
    expect(recordKeys(binding("undo"), "f2")).toBeNull();
    expect(keysOf("layers:rename")).toBe("F2");
  });

  it("works where it says by the keys of a focus scope too", () => {
    recordKeys(binding("layers:rename"), "r");
    const list = bindings().filter((b) => b.scope === "layersRow");
    expect(bindingFor(keyEventOf("r", isMac), list, ["layersRow"])?.id).toBe(
      "layers:rename"
    );
    expect(
      bindingFor(keyEventOf("f2", isMac), list, ["layersRow"])
    ).toBeUndefined();
  });
});

describe("taking a command's keys away", () => {
  it("leaves it none, the unshown ones too", () => {
    removeKeys(binding("delete"));
    expect(keysOf("delete")).toBeUndefined();
    expect(pressed("backspace")).toBeUndefined();
    expect(pressed("delete")).toBeUndefined();
    expect(rowOf("delete")?.changed).toBe(true);
  });
});

describe("reset", () => {
  it("puts the default keys back", () => {
    recordKeys(binding("undo"), "mod+u");
    expect(resetKeys(binding("undo"))).toBeNull();
    expect(pressed("mod+z")).toBe("undo");
    expect(rowOf("undo")?.changed).toBe(false);
  });

  it("keeps nothing for keys recorded the same as the default", () => {
    recordKeys(binding("undo"), "mod+z");
    expect(useKeybindings.getState().overrides).toEqual({});
  });

  it("all of them at once", () => {
    recordKeys(binding("undo"), "mod+u");
    removeKeys(binding("delete"));
    useKeybindings.getState().resetAll();
    expect(pressed("mod+z")).toBe("undo");
    expect(pressed("backspace")).toBe("delete");
    expect(localStorage.getItem("ultrapaint:keybindings")).toBeNull();
  });

  it("is refused while another command has a default key now", () => {
    takeKeys(binding("undo"), "mod+d");
    const refusal = resetKeys(binding("duplicate"));
    expect(refusal).toMatchObject({ by: { id: "undo" }, kind: "taken" });
    expect(keysOf("duplicate")).toBeUndefined();
  });
});

describe("a chord another command has", () => {
  it("is refused, naming the command, and nothing changes", () => {
    const refusal = recordKeys(binding("undo"), "mod+d");
    expect(refusal).toMatchObject({ by: { id: "duplicate" }, kind: "taken" });
    expect(refusal && refusalText(refusal, true)).toBe(
      "⌘D is Duplicate’s shortcut."
    );
    expect(pressed("mod+d")).toBe("duplicate");
    expect(useKeybindings.getState().overrides).toEqual({});
  });

  it("is refused when it is one the command has unshown: Delete beside ⌫", () => {
    expect(recordKeys(binding("undo"), "delete")).toMatchObject({
      by: { id: "delete" },
      kind: "taken",
    });
  });

  it("is taken from that command by Use it here", () => {
    takeKeys(binding("undo"), "mod+d");
    expect(pressed("mod+d")).toBe("undo");
    expect(keysOf("duplicate")).toBeUndefined();
    expect(rowOf("duplicate")?.changed).toBe(true);
  });

  it("taken from what has it unshown, leaves that command its shown keys", () => {
    takeKeys(binding("undo"), "delete");
    expect(pressed("delete")).toBe("undo");
    expect(pressed("backspace")).toBe("delete");
  });
});

describe("chords that are refused whoever has them", () => {
  it("are those the browser or the system keeps", () => {
    for (const chord of [
      "mod+w",
      "mod+q",
      "mod+t",
      "mod+n",
      "mod+l",
      "mod+r",
    ]) {
      expect(recordKeys(binding("undo"), chord)?.kind, chord).toBe("reserved");
    }
    const quit = recordKeys(binding("undo"), "mod+q");
    expect(quit && refusalText(quit, true)).toBe(
      "⌘Q is the system’s shortcut."
    );
    const close = recordKeys(binding("undo"), "mod+w");
    expect(close && refusalText(close, false)).toBe(
      "Ctrl+W is the browser’s shortcut."
    );
    expect(useKeybindings.getState().overrides).toEqual({});
  });

  it("would type, for a command that works in a text field", () => {
    const palette = binding("palette");
    expect(scopeOf(palette)).toBe("always");
    expect(recordKeys(palette, "k")?.kind).toBe("typing");
    expect(recordKeys(palette, "shift+k")?.kind).toBe("typing");
    expect(recordKeys(palette, "f6")).toBeNull();
    expect(recordKeys(palette, "mod+p")).toBeNull();
  });
});

describe("searchShortcuts", () => {
  const titles = (query: string, mac: boolean) =>
    searchShortcuts(shortcutRows(), query, mac).map((r) => r.binding.title);

  it("finds a command by its name", () => {
    expect(titles("redo", true)).toEqual(["Redo"]);
  });

  it("finds a command by its keys as this platform writes them, or as the list does, its own keys first", () => {
    expect(titles("⌘Z", true)).toEqual(["Undo", "Redo"]);
    expect(titles("⇧⌘Z", true)).toEqual(["Redo"]);
    expect(titles("Ctrl+Shift+Z", false)).toEqual(["Redo"]);
    expect(titles("mod+shift+z", true)).toEqual(["Redo"]);
  });

  it("finds keys of the person's", () => {
    recordKeys(binding("undo"), "mod+u");
    expect(titles("⌘U", true)).toEqual(["Undo"]);
  });

  it("finds nothing for what no command is called or pressed by", () => {
    expect(titles("qqq", true)).toEqual([]);
  });
});

describe("the list", () => {
  it("has every command that has keys or may be given some, and keeps fixed what can't change", () => {
    const rows = shortcutRows();
    expect(rows.map((r) => r.binding.id)).toEqual(
      expect.arrayContaining([
        "undo",
        "panel:layers",
        "insert:row",
        "layers:rename",
      ])
    );
    const fixed = rows.filter((r) => r.fixed).map((r) => r.binding.id);
    expect(fixed.sort()).toEqual(
      [
        "copy",
        "cut",
        "layers:fold",
        "layers:walk",
        "paste",
        "selectDepth",
        "selectSibling",
      ].sort()
    );
  });
});
