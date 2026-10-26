/**
 * What the app's logic asks of Electron: what the window shows, and the native dialogs. The main
 * process implements it; tests put a fake in its place.
 */
import { Context, type Effect, type Option } from "effect";

/** What the window shows: a project's editor, or the page that asks for a first project. */
export type View =
  | { readonly _tag: "Editor"; readonly url: string }
  | { readonly _tag: "Welcome"; readonly problem?: string | undefined };

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
  }
>()("ultrapaint/desktop/Shell") {}
