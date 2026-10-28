/**
 * The editor's key handler, made from the command list's bindings: a key pressed is matched
 * against the chords of the scopes it reaches, and the command it is runs by its own `run`, the
 * one the palette calls. The window has one listener, for `always`, `editor` and `canvas`; what
 * has the focus and keys of its own (a row of the Layers panel) hosts its scope with
 * `scopeKeyDown`, whose keys go first and stop there. A key a command declines (⌘D with nothing
 * selected) is left to the browser.
 */
import { type KeyboardEvent as ReactKeyboardEvent, useEffect } from "react";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import {
  commandList,
  type FocusScope,
  type FocusTargets,
  focusBindings,
  type WindowScope,
} from "./commands.ts";
import {
  chordText,
  isMac,
  isTyping,
  type KeyPress,
  type Keys,
  matchesChord,
  overlayOpen,
  parseChord,
} from "./keys.ts";
import { useClipboardEvents } from "./shortcuts.ts";

interface Chorded {
  also?: readonly Keys[];
  keys?: readonly Keys[];
  scope?: string;
}

/** Every chord of a binding, shown or not, as this platform presses them. */
export const chordsOf = (binding: Chorded, mac = isMac) =>
  [...(binding.keys ?? []), ...(binding.also ?? [])].map((k) =>
    parseChord(chordText(k, mac))
  );

/** The scope a window's binding works in: the editor's when it says none. */
export const scopeOf = (binding: Chorded) => binding.scope ?? "editor";

/** The binding a key pressed is, among those of the scopes it reaches. */
export const bindingFor = <B extends Chorded>(
  e: KeyPress,
  bindings: readonly B[],
  scopes: readonly string[],
  mac = isMac
): B | undefined =>
  bindings.find(
    (b) =>
      scopes.includes(scopeOf(b)) &&
      chordsOf(b, mac).some((c) => matchesChord(c, e))
  );

/**
 * The window's scopes a key reaches now: none while a dialog, a menu or the settings page is
 * open (the settings page replaces the editor: nothing on it is there to be acted on); in a text
 * field, only what nothing is typed with; else the editor's, and the canvas's on the canvas.
 */
export const windowScopes = (e: Event): readonly WindowScope[] => {
  if (overlayOpen() || useProject.getState().settingsOpen) {
    return [];
  }
  if (isTyping(e)) {
    return ["always"];
  }
  return useEditor.getState().workspace === "prototype"
    ? ["always", "editor"]
    : ["always", "editor", "canvas"];
};

/** Runs the command a key pressed in the window is; true when it ran, the key's default then prevented. */
export const pressWindowKey = (e: KeyboardEvent): boolean => {
  const binding = bindingFor(e, commandList(), windowScopes(e));
  // A clipboard chord is left to the browser, whose clipboard event the editor takes.
  if (!binding?.run || binding.run(e.key) === false) {
    return false;
  }
  e.preventDefault();
  return true;
};

/**
 * The keydown handler of what hosts a focus scope: `targetOf` says what the key was pressed on,
 * or null when it is nothing of the scope's (a field inside it). A key of the scope goes no
 * further: the window's keys are not told of it.
 */
export const scopeKeyDown =
  <S extends FocusScope>(
    scope: S,
    targetOf: (e: ReactKeyboardEvent) => FocusTargets[S] | null
  ) =>
  (e: ReactKeyboardEvent) => {
    const target = targetOf(e);
    if (target === null) {
      return;
    }
    const binding = bindingFor(e.nativeEvent, focusBindings[scope], [scope]);
    if (binding && binding.run(target, e.key) !== false) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

/** The window's keys, and the clipboard's events its copy, cut and paste chords become. */
export const useKeymap = () => {
  useClipboardEvents();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      pressWindowKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
};
