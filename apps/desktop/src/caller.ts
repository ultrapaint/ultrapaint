/**
 * Which page a call of the shell bridge comes from (ADR 0107): a project's page, answered for its
 * own project, or the tab strip and Home, which belong to none. The main process gives it to each
 * call from the page that made it.
 */
import { Context, Layer } from "effect";

export class Caller extends Context.Service<
  Caller,
  {
    /** The id of the open project whose page called; null for the tab strip and Home. */
    readonly project: string | null;
  }
>()("ultrapaint/desktop/Caller") {
  /** A call from `project`'s page, or from a page of no project with `null`. */
  static readonly layer = (project: string | null) =>
    Layer.succeed(Caller, Caller.of({ project }));
}
