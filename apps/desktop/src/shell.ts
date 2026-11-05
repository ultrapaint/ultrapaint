/**
 * What the app's logic asks of Electron: what the window shows, and the native dialogs. The main
 * process implements it; tests put a fake in its place.
 */
import type { ShellStatus } from "@ultrapaint/contracts/shell-bridge";
import { Context, type Effect, type Option } from "effect";

/**
 * What the window shows: a project's editor; the page that asks for a project, or says why one
 * could not be opened; or that page saying a project is opening, until its editor loads.
 */
export type View =
  | {
      readonly _tag: "Editor";
      /**
       * The same project's editor again, after its server restarted: the page goes on where it
       * was (the settings section open, say), at the new server's address.
       */
      readonly keepLocation?: boolean;
      readonly url: string;
    }
  | {
      readonly _tag: "Opening";
      /** Where the project is: its folder, or its host and folder. */
      readonly detail: string;
      readonly name: string;
    }
  | {
      readonly _tag: "Welcome";
      /** The project left open behind the start screen, to go back to (ADR 0062). */
      readonly back?: string | undefined;
      readonly problem?: string | undefined;
    };

export class Shell extends Context.Service<
  Shell,
  {
    /** Asks a yes-or-no question; true for the action named, false when the user declines. */
    readonly confirm: (question: {
      readonly action: string;
      readonly detail: string;
      readonly message: string;
    }) => Effect.Effect<boolean>;
    /** The native file picker, for an executable; nothing when it is cancelled. */
    readonly pickFile: (title: string) => Effect.Effect<Option.Option<string>>;
    /** The native folder picker, at `defaultPath` when given; nothing when it is cancelled. */
    readonly pickFolder: (options: {
      readonly defaultPath?: string | undefined;
      readonly title: string;
    }) => Effect.Effect<Option.Option<string>>;
    readonly show: (view: View) => Effect.Effect<void>;
    /**
     * Tells the window what the app is doing for the open project (`shellStatus`, which the page
     * reads as it loads too); `null` when nothing. A remote project's reconnection, say: shown
     * over the canvas until it is cleared.
     */
    readonly status: (status: ShellStatus | null) => Effect.Effect<void>;
  }
>()("ultrapaint/desktop/Shell") {}
