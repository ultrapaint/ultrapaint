/**
 * Where a server's start tells the open under way how it goes (ADR 0099): the lines it printed,
 * and, over SSH, the step it reached. `OpenProjects` gives one for the length of a launch; a start
 * outside one (a restart, a reconnection) tells nobody.
 */
import type { OpeningStepId } from "@ultrapaint/contracts/opening";
import { Context, Effect } from "effect";

export interface OpeningReport {
  /** A line the start printed: ssh's, the server's. */
  readonly line: (text: string) => Effect.Effect<void>;
  /** The start reached a step: the ones before it are done. */
  readonly reached: (step: OpeningStepId) => Effect.Effect<void>;
}

export const OpeningReport = Context.Reference<OpeningReport>(
  "ultrapaint/desktop/OpeningReport",
  {
    defaultValue: () => ({
      line: () => Effect.void,
      reached: () => Effect.void,
    }),
  }
);
