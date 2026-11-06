/**
 * The findings log (ADR 0060, 0063), opt-in: every finding of a design's review, with what the
 * designer did with it, appended as a line of JSON to `~/.ultrapaint/findings/<project>.jsonl`,
 * outside every repository, for triage to turn recurring ones into gaps (issue #8).
 */
import { LoggedFinding } from "@ultrapaint/contracts/review";
import { Effect, FileSystem, Path, Schema } from "effect";
import { AppLog } from "../../app-log.ts";
import { ServerConfig } from "../../config.ts";

/** Where the log is, in the user's directory. */
export const FINDINGS_DIR = "findings";

const encodeLine = Schema.encodeEffect(Schema.fromJsonString(LoggedFinding));

export const makeFindingsLog = Effect.fnUntraced(function* () {
  const { userDir } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const log = yield* AppLog;

  /** The log's file for a project, by its name. */
  const fileOf = (project: string) =>
    path.join(userDir, FINDINGS_DIR, `${project}.jsonl`);

  /** Appends the findings to the project's log. */
  const append = (project: string, findings: readonly LoggedFinding[]) =>
    Effect.gen(function* () {
      if (findings.length === 0) {
        return;
      }
      const lines = yield* Effect.forEach(findings, (f) => encodeLine(f));
      yield* fs.makeDirectory(path.join(userDir, FINDINGS_DIR), {
        recursive: true,
      });
      yield* fs.writeFileString(fileOf(project), `${lines.join("\n")}\n`, {
        flag: "a",
      });
    }).pipe(
      // The log is for triage later: a write that fails costs the review nothing.
      Effect.catch((error) =>
        log.log("agent", "warn", `findings log not written: ${error.message}`)
      )
    );

  return { append, fileOf };
});
