// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMac, keysLabel } from "../lib/keys.ts";
import { useKeybindings } from "../state/keybindings.ts";
import { keyEventOf } from "../testing/key-events.ts";
import { ShortcutsSection } from "./settings-shortcuts.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  mounted = createRoot(container);
  act(() => {
    mounted.render(<ShortcutsSection />);
  });
});

afterEach(() => {
  act(() => mounted.unmount());
  container.remove();
  useKeybindings.getState().resetAll();
});

const label = (text: string) => keysLabel([text]);

const buttonNamed = (start: string) =>
  [...container.querySelectorAll("button")].find((b) =>
    (b.getAttribute("aria-label") ?? b.textContent ?? "").startsWith(start)
  );

/** The button of a command's keys, which records new ones. */
const keysOf = (title: string) => {
  const button = buttonNamed(`Change the shortcut for ${title}:`);
  if (!button) {
    throw new Error(`no keys for ${title}`);
  }
  return button;
};

const recordingButton = (title: string) =>
  buttonNamed(`Press a shortcut for ${title}`);

const click = (button: HTMLElement | undefined) => {
  act(() => {
    button?.focus();
    button?.click();
  });
};

/** Presses a chord on the button recording; whether it got past the button. */
const press = (title: string, text: string) => {
  const button = recordingButton(title);
  if (!button) {
    throw new Error(`${title} isn't recording`);
  }
  let reachedDocument = false;
  const listen = () => {
    reachedDocument = true;
  };
  document.addEventListener("keydown", listen);
  act(() => {
    button.dispatchEvent(
      new KeyboardEvent("keydown", {
        ...keyEventOf(text, isMac),
        bubbles: true,
        cancelable: true,
      })
    );
  });
  document.removeEventListener("keydown", listen);
  return { reachedDocument };
};

const said = () => container.querySelector("[aria-live]")?.textContent;

const record = (title: string, text: string) => {
  click(keysOf(title));
  return press(title, text);
};

describe("the list", () => {
  it("shows each group of the palette with its commands and their keys", () => {
    const titles = [...container.querySelectorAll("h3")].map(
      (h) => h.textContent
    );
    expect(titles).toEqual(
      expect.arrayContaining(["Selection", "Layers", "Edit", "View", "Tools"])
    );
    expect(keysOf("Undo").textContent).toBe(label("mod+z").replace(/\+/g, ""));
    expect(keysOf("Show Layers").textContent).toBe("Add shortcut");
  });

  it("offers no Reset all while nothing is changed", () => {
    expect(buttonNamed("Reset all")).toBeUndefined();
  });
});

describe("recording a shortcut", () => {
  it("says it is listening, then saves the chord pressed at once", () => {
    click(keysOf("Undo"));
    expect(recordingButton("Undo")?.textContent).toBe("Press a shortcut…");
    expect(said()).toBe(
      "Press a shortcut for Undo. Escape cancels; Backspace removes it."
    );
    press("Undo", "mod+u");
    expect(useKeybindings.getState().overrides).toEqual({ undo: ["mod+u"] });
    expect(keysOf("Undo").getAttribute("aria-label")).toBe(
      `Change the shortcut for Undo: ${label("mod+u")}`
    );
    expect(said()).toBe(`Undo: ${label("mod+u")}.`);
    expect(buttonNamed("Reset Undo to default")).toBeDefined();
    expect(buttonNamed("Reset all")).toBeDefined();
  });

  it("is cancelled by Escape, which goes no further than the row: the dialog stays open", () => {
    const { reachedDocument } = record("Undo", "escape");
    expect(reachedDocument).toBe(false);
    expect(recordingButton("Undo")).toBeUndefined();
    expect(useKeybindings.getState().overrides).toEqual({});
  });

  it("waits for a key while only modifiers are down", () => {
    click(keysOf("Undo"));
    act(() => {
      recordingButton("Undo")?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Shift",
          shiftKey: true,
        })
      );
    });
    expect(recordingButton("Undo")).toBeDefined();
  });

  it("removes the shortcut on Backspace", () => {
    record("Undo", "backspace");
    expect(keysOf("Undo").textContent).toBe("Add shortcut");
    expect(said()).toBe("Undo: no shortcut.");
  });
});

describe("a chord another command has", () => {
  it("is refused under the row, and taken from that command by Use it here", () => {
    record("Undo", "mod+d");
    expect(useKeybindings.getState().overrides).toEqual({});
    const message = `${label("mod+d")} is Duplicate’s shortcut.`;
    expect(container.textContent).toContain(message);
    expect(said()).toBe(message);
    click(buttonNamed("Use it here"));
    expect(keysOf("Undo").getAttribute("aria-label")).toBe(
      `Change the shortcut for Undo: ${label("mod+d")}`
    );
    expect(keysOf("Duplicate").textContent).toBe("Add shortcut");
    expect(container.textContent).not.toContain(message);
  });
});

describe("a chord the browser keeps", () => {
  it("is refused, saying so", () => {
    record("Undo", "mod+w");
    expect(container.textContent).toContain(
      `${label("mod+w")} is the browser’s shortcut.`
    );
    expect(buttonNamed("Use it here")).toBeUndefined();
    expect(useKeybindings.getState().overrides).toEqual({});
  });
});

describe("reset", () => {
  it("puts a command's default keys back", () => {
    record("Undo", "mod+u");
    click(buttonNamed("Reset Undo to default"));
    expect(useKeybindings.getState().overrides).toEqual({});
    expect(buttonNamed("Reset Undo to default")).toBeUndefined();
  });

  it("all puts every command's back", () => {
    record("Undo", "mod+u");
    record("Redo", "backspace");
    click(buttonNamed("Reset all"));
    expect(useKeybindings.getState().overrides).toEqual({});
    expect(buttonNamed("Reset all")).toBeUndefined();
  });
});

describe("the search", () => {
  const search = (value: string) => {
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search shortcuts"]'
    );
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("finds commands by their keys", () => {
    search("mod+shift+z");
    expect(buttonNamed("Change the shortcut for Redo:")).toBeDefined();
    expect(buttonNamed("Change the shortcut for Undo:")).toBeUndefined();
  });

  it("says when nothing matches, with a way out", () => {
    search("qqq");
    expect(container.textContent).toContain("No shortcut matches “qqq”.");
    click(buttonNamed("Clear search"));
    expect(keysOf("Undo")).toBeDefined();
  });
});
