import { BadRequest } from "@ultrapaint/contracts/errors";
import { Context, Effect, Layer, Ref } from "effect";
import launchEditor from "launch-editor";
import guessEditor from "launch-editor/guess.js";

/** A file opened, as the test adapter keeps it. */
export interface Opened {
  readonly file: string;
  readonly line: number | undefined;
}

/**
 * Editors that run in a terminal. The server has none to give them, and `launch-editor` kills
 * the one it started last to start another, which loses what was not saved: never started.
 */
const TERMINAL_EDITORS = new Set([
  "emacs",
  "helix",
  "hx",
  "joe",
  "kak",
  "micro",
  "nano",
  "ne",
  "nvim",
  "vi",
  "vim",
]);

const PATH_PART = /[/\\]/;

/** Whether a command (`/usr/bin/vim`, `nvim -p`) starts an editor that runs in a terminal. */
export const isTerminalEditor = (command: string) => {
  // The executable's own name: after its directories, which may hold spaces, and before any
  // arguments written after it (`nvim -p`).
  const name = command.trim().split(PATH_PART).pop() ?? "";
  return TERMINAL_EDITORS.has(name.split(" ")[0] ?? "");
};

/**
 * A guess written back as the command `launch-editor` reads (`shell-quote`): each part quoted, so
 * a path with spaces stays one.
 */
export const commandOf = (parts: readonly string[]) =>
  parts.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" ");

const NO_EDITOR =
  "No code editor was found. Open the project in one (VS Code, Cursor, Zed…), or set LAUNCH_EDITOR to its command.";

/**
 * The person's code editor (ADR 0106): a file of the repository opened in it, at a line. Which
 * editor is guessed by `launch-editor` from the ones running (VS Code, Cursor, Zed, a JetBrains
 * IDE…), else `LAUNCH_EDITOR`, `VISUAL` or `EDITOR`, which the library reads itself. The editor
 * is the person's and outlives the request: nothing here waits for it or stops it. It is guessed
 * once and that guess is what starts: none found, or one that runs in a terminal, is the
 * request's error; one that fails once started is the library's to print.
 */
export class CodeEditor extends Context.Service<
  CodeEditor,
  {
    readonly open: (
      file: string,
      line?: number
    ) => Effect.Effect<void, BadRequest>;
    /** What the test adapter opened, in order; always empty for the real one. */
    readonly opened: Effect.Effect<readonly Opened[]>;
  }
>()("ultrapaint/server/CodeEditor") {
  static readonly layer = Layer.succeed(
    CodeEditor,
    CodeEditor.of({
      open: Effect.fn("CodeEditor.open")(function* (file, line) {
        // Guessed once, checked, and that one started: a second guess could find another.
        const [editor, ...args] = yield* Effect.sync(() => guessEditor());
        if (!editor) {
          return yield* new BadRequest({ message: NO_EDITOR });
        }
        if (isTerminalEditor(editor)) {
          return yield* new BadRequest({
            message: `${editor} runs in a terminal, which Ultrapaint can't open it in. Set LAUNCH_EDITOR to a windowed editor's command (code, cursor, zed…).`,
          });
        }
        yield* Effect.sync(() =>
          launchEditor(
            line === undefined ? file : `${file}:${line}`,
            commandOf([editor, ...args]),
            // Anything that goes wrong once it is started comes after the answer: the library
            // prints it.
            () => undefined
          )
        );
      }),
      opened: Effect.succeed([]),
    })
  );

  /** Keeps what is opened, for a test to read; opens nothing. */
  static readonly layerTest = Layer.effect(
    CodeEditor,
    Effect.gen(function* () {
      const opened = yield* Ref.make<readonly Opened[]>([]);
      return CodeEditor.of({
        open: (file, line) =>
          Ref.update(opened, (all) => [...all, { file, line }]),
        opened: Ref.get(opened),
      });
    })
  );
}
