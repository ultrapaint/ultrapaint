/**
 * What the app's logic asks of Electron: the window's pages and tabs, and the native dialogs. The
 * main process implements it; tests put a fake in its place.
 *
 * The window holds a page per open project (ADR 0107), at most a few of them loaded, the Home page
 * (the start page) and the tab strip over them; one of Home and the projects' pages is on screen.
 */
import type { Opening } from "@ultrapaint/contracts/opening";
import type { ShellStatus, ShellTab } from "@ultrapaint/contracts/shell-bridge";
import { Context, type Effect, type Option } from "effect";

/**
 * What a project's page shows: its editor, or the app's own page under the splash of the project
 * opening (ADR 0099), while there is no editor to draw it over.
 */
export type View =
  | {
      readonly _tag: "Editor";
      /**
       * The same project's editor again, after its server restarted: the page goes on where it
       * was (the settings section open, say), at the new server's address.
       */
      readonly keepLocation?: boolean;
      /**
       * The server the editor talks to when `url` is the app's own editor (ADR 0100): the page
       * reads it from the bridge (`editorServer`). Absent, `url` is the server's, and serves it.
       */
      readonly server?: string | undefined;
      readonly url: string;
    }
  | {
      /** The splash alone, drawn from the project's `opening`. */
      readonly _tag: "Opening";
    };

export class Shell extends Context.Service<
  Shell,
  {
    /** Asks a yes-or-no question; true for the action named, false when the user declines. */
    readonly confirm: (question: {
      readonly action: string;
      /** What declining is called: "Cancel" when not given. */
      readonly cancel?: string | undefined;
      readonly detail: string;
      readonly message: string;
    }) => Effect.Effect<boolean>;
    /** Lets go of a project's page, which loads again when it is next shown; nothing without. */
    readonly drop: (project: string) => Effect.Effect<void>;
    /** Loads a view in a project's page, making the page when it has none. */
    readonly load: (project: string, view: View) => Effect.Effect<void>;
    /**
     * Shows a folder in the system's file manager (Finder, say); why not, when it couldn't:
     * the system's own words.
     */
    readonly openPath: (path: string) => Effect.Effect<Option.Option<string>>;
    /** The native file picker, for an executable; nothing when it is cancelled. */
    readonly pickFile: (title: string) => Effect.Effect<Option.Option<string>>;
    /** The native folder picker, at `defaultPath` when given; nothing when it is cancelled. */
    readonly pickFolder: (options: {
      readonly defaultPath?: string | undefined;
      readonly title: string;
    }) => Effect.Effect<Option.Option<string>>;
    /**
     * Tells a project's page the project opening, as it goes (`opening`, which the page reads as
     * it loads too); `null` once none is. The page draws its splash over itself.
     */
    readonly opening: (
      project: string,
      opening: Opening | null
    ) => Effect.Effect<void>;
    /** Puts a project's page on screen, its page loaded already; Home with `null`. */
    readonly show: (project: string | null) => Effect.Effect<void>;
    /**
     * Tells a project's page what the app is doing for it (`shellStatus`, which the page reads as
     * it loads too); `null` when nothing. A remote project's reconnection, say: shown over the
     * canvas until it is cleared.
     */
    readonly status: (
      project: string,
      status: ShellStatus | null
    ) => Effect.Effect<void>;
    /** Tells the tab strip the open projects as they are now (`tabs`). */
    readonly tabs: (tabs: readonly ShellTab[]) => Effect.Effect<void>;
  }
>()("ultrapaint/desktop/Shell") {}
