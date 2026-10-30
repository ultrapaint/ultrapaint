// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComments } from "../state/comments.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { keyEventOf } from "../testing/key-events.ts";
import {
  type CommandSpec,
  commandList,
  commands,
  type FocusBinding,
  focusBindings,
  type LayerRow,
  shortcuts,
} from "./commands.ts";
import { bindingFor, pressWindowKey, scopeKeyDown, scopeOf } from "./keymap.ts";
import { isMac, type Keys } from "./keys.ts";
import {
  canvasEntries,
  type Entry,
  nodeEntries,
  pageEntries,
} from "./menu-model.ts";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

const WINDOW_SCOPES = ["always", "editor", "canvas"];

/** Every chord a binding is pressed with, as written for the platform. */
const chordTexts = (
  b: { also?: readonly Keys[]; keys?: readonly Keys[] },
  mac: boolean
) =>
  [...(b.keys ?? []), ...(b.also ?? [])].map((k) =>
    typeof k === "string" ? k : k[mac ? "mac" : "other"]
  );

/** A real key event of the chord, pressed on `target` (the page's body when none). */
const pressOn = (text: string, target: Element = document.body) => {
  const e = new KeyboardEvent("keydown", {
    ...keyEventOf(text, isMac),
    bubbles: true,
    cancelable: true,
  });
  let ran = false;
  const listen = (event: Event) => {
    ran = pressWindowKey(event as KeyboardEvent);
  };
  window.addEventListener("keydown", listen);
  target.dispatchEvent(e);
  window.removeEventListener("keydown", listen);
  return { prevented: e.defaultPrevented, ran };
};

const row = (): LayerRow & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    item: {
      children: [],
      frame: "home",
      key: "home#cta",
      node: { id: "cta", type: "text" } as never,
      parent: null,
    },
    rename: () => calls.push("rename"),
    select: (add) => calls.push(add ? "add" : "select"),
    walk: (key) => calls.push(`walk:${key}`),
  };
};

/** The row's tree's keydown, as React hands it over. */
const pressRow = (text: string, target: LayerRow | null) => {
  const init = keyEventOf(text, isMac);
  const native = new KeyboardEvent("keydown", { ...init, cancelable: true });
  const stop = vi.fn();
  const e = {
    key: init.key,
    nativeEvent: native,
    preventDefault: () => native.preventDefault(),
    stopPropagation: stop,
  } as unknown as ReactKeyboardEvent;
  scopeKeyDown("layersRow", () => target)(e);
  return {
    prevented: native.defaultPrevented,
    stopped: stop.mock.calls.length > 0,
  };
};

beforeEach(() => {
  useEditor.setState({
    mode: "select",
    selectedPage: null,
    selection: null,
    workspace: "design",
  });
  useComments.setState({ draft: null, open: null, visible: false });
  useProject.setState({ settingsOpen: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("every key shown has a handler", () => {
  it.each([true, false])(
    "finds each chord of the window's commands as its own (on a Mac: %s)",
    (mac) => {
      for (const c of commandList()) {
        for (const text of chordTexts(c, mac)) {
          expect(
            bindingFor(keyEventOf(text, mac), commandList(), [scopeOf(c)], mac)
              ?.id,
            text
          ).toBe(c.id);
        }
      }
    }
  );

  it.each([true, false])(
    "finds each chord of a Layers row as its own (on a Mac: %s)",
    (mac) => {
      const list = focusBindings.layersRow;
      for (const b of list) {
        for (const text of chordTexts(b, mac)) {
          expect(
            bindingFor(keyEventOf(text, mac), list, ["layersRow"], mac)?.id,
            text
          ).toBe(b.id);
        }
      }
    }
  );

  it("runs the command's own run, pressed in its scope, and keeps the key from the browser", () => {
    for (const c of commandList()) {
      if (!c.run) {
        continue;
      }
      const run = vi
        .spyOn(c as { run: () => boolean }, "run")
        .mockReturnValue(true);
      for (const text of chordTexts(c, isMac)) {
        run.mockClear();
        expect(pressOn(text), text).toEqual({ prevented: true, ran: true });
        expect(run, text).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("leaves copy, cut and paste to the browser, whose clipboard events the editor takes", () => {
    const clipboard = commandList().filter((c) => c.clipboard);
    expect(clipboard.map((c) => c.clipboard)).toEqual(["copy", "cut", "paste"]);
    for (const c of clipboard) {
      expect(pressOn(chordTexts(c, isMac)[0] ?? "")).toEqual({
        prevented: false,
        ran: false,
      });
    }
  });

  it("runs a Layers row's keys on the row, and keeps them from the window", () => {
    const target = row();
    expect(pressRow("f2", target)).toEqual({ prevented: true, stopped: true });
    pressRow("enter", target);
    pressRow("space", target);
    pressRow("shift+enter", target);
    pressRow("arrowdown", target);
    pressRow("home", target);
    expect(target.calls).toEqual([
      "rename",
      "select",
      "select",
      "add",
      "walk:ArrowDown",
      "walk:Home",
    ]);
    const spied = focusBindings.layersRow.map((b) =>
      vi.spyOn(b as FocusBinding<"layersRow">, "run").mockReturnValue(true)
    );
    for (const [i, b] of focusBindings.layersRow.entries()) {
      for (const text of chordTexts(b, isMac)) {
        spied[i]?.mockClear();
        pressRow(text, target);
        expect(spied[i], text).toHaveBeenCalledWith(target, expect.any(String));
      }
    }
  });

  it("lets a key through that the row does not take, or one pressed in a field of the row", () => {
    expect(pressRow("mod+k", row())).toEqual({
      prevented: false,
      stopped: false,
    });
    expect(pressRow("f2", null)).toEqual({ prevented: false, stopped: false });
    // A page's row has nothing of its own to hide: the key goes on to the window.
    const page = {
      ...row(),
      item: { ...row().item, page: { id: "home" } as never },
    };
    expect(pressRow("mod+shift+h", page)).toEqual({
      prevented: false,
      stopped: false,
    });
  });
});

/** The scopes that are reached together: the window's three, or a focus scope alone. */
const overlap = (a: string, b: string) =>
  WINDOW_SCOPES.includes(a) ? WINDOW_SCOPES.includes(b) : a === b;

describe("chords in scopes that overlap", () => {
  it.each([true, false])("are never shared (on a Mac: %s)", (mac) => {
    const lists: readonly (readonly (
      | CommandSpec
      | FocusBinding<"layersRow">
    )[])[] = [commandList(), focusBindings.layersRow];
    for (const list of lists) {
      for (const b of list) {
        for (const text of chordTexts(b, mac)) {
          const e = keyEventOf(text, mac);
          const taking = list.filter(
            (other) =>
              overlap(scopeOf(b), scopeOf(other)) &&
              bindingFor(e, [other], [scopeOf(other)], mac) !== undefined
          );
          expect(
            taking.map((t) => t.id),
            text
          ).toEqual([b.id]);
        }
      }
    }
  });
});

describe("the scopes", () => {
  it("leave a text field the keys nothing is typed with", () => {
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(input, editable);
    const palette = vi
      .spyOn(
        commandList().find((c) => c.id === "palette") as { run: () => void },
        "run"
      )
      .mockReturnValue(undefined);
    const select = vi.spyOn(
      commandList().find((c) => c.id === "tool:select") as { run: () => void },
      "run"
    );
    for (const field of [input, editable]) {
      expect(pressOn("mod+k", field).ran).toBe(true);
      expect(pressOn("v", field).ran).toBe(false);
      expect(pressOn("backspace", field).ran).toBe(false);
    }
    expect(palette).toHaveBeenCalledTimes(2);
    expect(select).not.toHaveBeenCalled();
  });

  it("let no key through while a dialog or the settings are open", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(pressOn("mod+k").ran).toBe(false);
    dialog.remove();
    useProject.setState({ settingsOpen: true });
    expect(pressOn("mod+k").ran).toBe(false);
    expect(pressOn("?").ran).toBe(false);
  });

  it("keep the canvas's keys off the prototype, and give the browser its zoom keys there", () => {
    useEditor.setState({ workspace: "prototype" });
    expect(pressOn("v")).toEqual({ prevented: false, ran: false });
    expect(pressOn("mod+=")).toEqual({ prevented: false, ran: false });
    expect(useEditor.getState().mode).toBe("select");
  });

  it("leave a key to the browser that its command declines: ⌘D with nothing selected", () => {
    expect(pressOn("mod+d")).toEqual({ prevented: false, ran: false });
  });
});

describe("C, through the one path the palette takes too", () => {
  const paletteRun = (id: string) => {
    commands()
      .find((c) => c.id === id)
      ?.run();
  };

  it("picks the comment tool on the canvas and shows the comments", () => {
    pressOn("c");
    expect(useEditor.getState().mode).toBe("comment");
    expect(useComments.getState().visible).toBe(true);
    useEditor.setState({ mode: "select" });
    useComments.setState({ visible: false });
    paletteRun("tool:comment");
    expect(useEditor.getState().mode).toBe("comment");
    expect(useComments.getState().visible).toBe(true);
  });

  it("goes in and out of commenting in the prototype", () => {
    useEditor.setState({ mode: "interact", workspace: "prototype" });
    pressOn("c");
    expect(useEditor.getState().mode).toBe("comment");
    expect(useComments.getState().visible).toBe(true);
    pressOn("c");
    expect(useEditor.getState().mode).toBe("interact");
    paletteRun("tool:comment");
    expect(useEditor.getState().mode).toBe("comment");
    // Escape puts it down: the prototype has no other tool to pick in its place.
    pressOn("escape");
    expect(useEditor.getState().mode).toBe("interact");
  });

  it("is not ⇧C, which shows or hides the comments", () => {
    pressOn("shift+c");
    expect(useEditor.getState().mode).toBe("select");
    expect(useComments.getState().visible).toBe(true);
  });
});

describe("the shortcut sheet", () => {
  it("lists the Layers rows' keys", () => {
    const layers = shortcuts().filter((s) => s.group === "Layers");
    expect(layers.map((s) => s.title)).toEqual([
      "Go to the previous, next, first or last layer",
      "Fold or open a layer, or go to its parent or first child",
      "Select the layer",
      "Add the layer to the selection",
      "Rename the layer",
      "Hide or show the layer",
      "Lock or unlock the layer",
    ]);
    expect(layers.find((s) => s.title === "Rename the layer")?.keys).toBe("F2");
    expect(layers.find((s) => s.title === "Hide or show the layer")?.keys).toBe(
      isMac ? "⇧⌘H" : "Ctrl+Shift+H"
    );
  });

  it("lists every key, whatever the workspace offers, once", () => {
    useEditor.setState({ workspace: "prototype" });
    const rows = shortcuts();
    const keys = rows.map((s) => s.keys);
    expect(keys).toContain("V");
    expect(keys).toContain(isMac ? "⇧1" : "Shift+1");
    // The canvas's arrows and a Layers row's are the same keys, in scopes of their own.
    const listed = rows.map((s) => `${s.group}: ${s.keys}`);
    expect(new Set(listed).size).toBe(listed.length);
  });
});

describe("the menus", () => {
  const named = (entries: readonly Entry[]): string[] =>
    entries.flatMap((e) => {
      if (e.kind === "item") {
        return e.command ? [e.command] : [];
      }
      return e.kind === "submenu" ? named(e.entries) : [];
    });

  it("name commands there are, whose keys they show", () => {
    const node = { id: "cta", text: "Go", type: "text" } as never;
    const all = [
      ...named(
        nodeEntries({
          canPaste: true,
          count: 1,
          frame: { kind: "page", page: "home.page.json" },
          hidden: false,
          index: 1,
          node,
          parentSelectable: true,
          siblings: 3,
          wrappable: true,
        })
      ),
      ...named(
        pageEntries({
          canPaste: true,
          canvases: [],
          count: 1,
          implementation: "draft",
          name: "Home",
          onCanvas: true,
          preset: null,
          statesFree: [],
          variantsFree: [],
        })
      ),
      ...named(
        canvasEntries({
          canPaste: true,
          commentsVisible: true,
          gridVisible: true,
        })
      ),
    ];
    expect(all.length).toBeGreaterThan(10);
    const ids = new Set(commandList().map((c: CommandSpec) => c.id));
    for (const id of all) {
      expect(ids, id).toContain(id);
    }
  });
});
