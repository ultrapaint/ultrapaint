/**
 * `setup-host`: a host's design system imported the way a user would import it, by Ultrapaint's
 * own `/init`, run once in the host's own designs directory. What it writes is committed with the
 * host, and every run of a round starts from it.
 */
import path from "node:path";
import { Effect } from "effect";
import { traceOf } from "./generate.ts";
import { WORK, writeText } from "./layout.ts";
import { launch, runPrompt } from "./session.ts";

export const setupHost = Effect.fn("setupHost")(function* (
  host: string,
  options: {
    readonly agent: string;
    readonly minutes: number;
    readonly model: string | undefined;
  }
) {
  const turn = yield* Effect.scoped(
    Effect.gen(function* () {
      const session = yield* launch(host, "own");
      return yield* Effect.scoped(
        runPrompt(session, {
          agent: options.agent,
          minutes: options.minutes,
          model: options.model,
          text: "/init",
        })
      );
    })
  );
  const said = turn.items
    .filter((i) => i.kind === "agent")
    .map((i) => (i.kind === "agent" ? i.text : ""))
    .join("\n\n");
  const file = path.join(WORK, host, "init.md");
  yield* writeText(
    file,
    `# /init in ${host}\n\n${said.trim()}\n\n## Tool calls\n\n${traceOf(turn.items)}\n`
  );
  yield* Effect.log(
    `${host}: /init ${turn.problem ?? "done"} in ${Math.round(turn.seconds)}s; the transcript is in ${file}. Review the host's designs directory, then commit it.`
  );
});
