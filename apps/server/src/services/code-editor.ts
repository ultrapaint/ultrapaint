import { BadRequest } from "@ultrapaint/contracts/errors";
import { Context, Effect, Layer, Ref } from "effect";
import launchEditor from "launch-editor";

/** A file opened, as the test adapter keeps it. */
export interface Opened {
  readonly file: string;
  readonly line: number | undefined;
}

const NO_EDITOR =
  "No code editor was found. Open the project in one (VS Code, Cursor, Zed…), or set LAUNCH_EDITOR to its command.";

/**
 * The person's code editor (ADR 0106): a file of the repository opened in it, at a line. Which
 * editor is guessed by `launch-editor` from the ones running (VS Code, Cursor, Zed, a JetBrains
 * IDE…), else `LAUNCH_EDITOR`, `VISUAL` or `EDITOR`, which the library reads itself. The editor
 * is the person's and outlives the request: nothing here waits for it or stops it. None found
 * is the request's error; one that fails once started is the library's to print.
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
        // Said at once when no editor is found; anything later comes after the answer.
        const found = yield* Effect.sync(() => {
          let none = false;
          launchEditor(
            line === undefined ? file : `${file}:${line}`,
            (_name, message) => {
              none = message === null;
            }
          );
          return !none;
        });
        if (!found) {
          return yield* new BadRequest({ message: NO_EDITOR });
        }
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
