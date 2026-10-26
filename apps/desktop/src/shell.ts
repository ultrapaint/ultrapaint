/**
 * What the app's logic asks of Electron: what the window shows, and the native dialogs. The main
 * process implements it; tests put a fake in its place.
 */
import { Context, type Effect, type Option } from "effect";

/** What the window shows: a project's editor, or the page that asks for a first project. */
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
  | { readonly _tag: "Welcome"; readonly problem?: string | undefined };

/**
 * What the app is doing for the open project that the editor cannot see: reconnecting to the
 * machine a remote project is on, say. Shown over the canvas until it is cleared.
 */
export interface ShellStatus {
  /** Why, at more length: the error the last attempt met. */
  readonly detail?: string | undefined;
  readonly message: string;
}

export class Shell extends Context.Service<
  Shell,
  {
    /** Asks a yes-or-no question; true for the action named, false when the user declines. */
    readonly confirm: (question: {
      readonly action: string;
      readonly detail: string;
      readonly message: string;
    }) => Effect.Effect<boolean>;
    /** The native folder picker; nothing when it is cancelled. */
    readonly pickFolder: (
      title: string
    ) => Effect.Effect<Option.Option<string>>;
    readonly show: (view: View) => Effect.Effect<void>;
    /** Tells the window what the app is doing for the open project; `null` when nothing. */
    readonly status: (status: ShellStatus | null) => Effect.Effect<void>;
  }
>()("ultrapaint/desktop/Shell") {}
