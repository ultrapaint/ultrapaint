/**
 * A design from nothing (PLAN-desktop D11): the New design dialog's name, folder, template, code
 * location and git setting, written by the server's own `ultrapaint new`, the command's code
 * path, run as the project's server is (Electron's binary as Node, the login shell's PATH, so the
 * user's Node and pnpm or npm install it). Each line it prints is a step for the dialog; once it
 * is written, the folder joins the project list and opens in place of the open project.
 */
import { NewDesignProgressLine } from "@ultrapaint/contracts/new-design";
import type {
  NewDesignInput,
  NewDesignOutcome,
  NewDesignStepId,
  NewDesignUpdate,
} from "@ultrapaint/contracts/shell-bridge";
import {
  Context,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { LoginShell } from "./login-shell.ts";
import { OpenProject } from "./open-project.ts";
import { type ServerLaunch, serverEnv } from "./project-server.ts";

/** What the editor is opened with to know the design is new (`apps/web/src/lib/new-design.ts`). */
export const NEW_DESIGN_PARAM = "new-design";

/** Where new designs go unless the user picks another folder: `~/Ultrapaint`. */
export const DESIGNS_HOME = "Ultrapaint";

const decodeLine = Schema.decodeUnknownOption(NewDesignProgressLine);

/** What a folder's name cannot hold, and the dots that would hide it. */
const UNSAFE_RE = /[/\\:\0]/g;
const LEADING_DOTS_RE = /^\.+/;

/** A name as a folder can be called: no separators, no leading dots; `Untitled` for none. */
export const folderNameOf = (name: string) =>
  name.replace(UNSAFE_RE, "-").replace(LEADING_DOTS_RE, "").trim() ||
  "Untitled";

/** The last lines the command wrote on stderr, which say why it stopped when no step did. */
const tail = (lines: readonly string[]) => lines.slice(-8).join("\n");

export class NewDesigns extends Context.Service<
  NewDesigns,
  {
    /**
     * Writes the design, telling `report` how each step goes, then adds it to the list and
     * opens it. The step that failed, when one did; what the steps before it did stays.
     */
    readonly create: (
      request: NewDesignInput,
      report: (update: NewDesignUpdate) => Effect.Effect<void>
    ) => Effect.Effect<NewDesignOutcome>;
    /**
     * Where a design of that name goes unless another folder is picked: `~/Ultrapaint/<name>`,
     * or `<name> 2`, `<name> 3`… when that is there already.
     */
    readonly folderFor: (name: string) => Effect.Effect<string>;
    /** Adds a design whose writing stopped to the list, and opens it as it is. */
    readonly open: (
      folder: string,
      name: string,
      template: NewDesignInput["template"]
    ) => Effect.Effect<NewDesignOutcome>;
  }
>()("ultrapaint/desktop/NewDesigns") {
  /** `home` is the user's home directory; `launch` starts the server, as for a project. */
  static readonly layer = (options: {
    readonly home: string;
    readonly launch: ServerLaunch;
  }) =>
    Layer.effect(
      NewDesigns,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const { env } = yield* LoginShell;
        const projects = yield* OpenProject;

        const folderFor = Effect.fn("NewDesigns.folderFor")(function* (
          name: string
        ) {
          const base = path.join(
            options.home,
            DESIGNS_HOME,
            folderNameOf(name)
          );
          for (let n = 1; ; n += 1) {
            const candidate = n === 1 ? base : `${base} ${n}`;
            // One that cannot be looked at is as good as taken.
            if (
              !(yield* fs
                .exists(candidate)
                .pipe(Effect.orElseSucceed(() => true)))
            ) {
              return candidate;
            }
          }
        });

        /** `ultrapaint new`, its steps reported as it prints them. */
        const write = Effect.fn("NewDesigns.write")(function* (
          request: NewDesignInput,
          report: (update: NewDesignUpdate) => Effect.Effect<void>
        ): Effect.fn.Return<NewDesignOutcome> {
          // What the lines said so far: the step it is on, and the one that failed.
          const seen: {
            failed?: NewDesignOutcome["failed"];
            last: NewDesignStepId;
          } = { last: "folder" };
          const said: string[] = [];
          const exitCode = yield* Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(
                ChildProcess.make(
                  options.launch.command,
                  [
                    ...options.launch.args,
                    "new",
                    request.folder,
                    // Joined, so that a name starting with a dash is not read as a flag.
                    `--name=${request.name}`,
                    `--template=${request.template}`,
                    `--code=${request.code}`,
                    ...(request.git ? ["--git"] : []),
                    "--progress-json",
                  ],
                  {
                    cwd: options.home,
                    env: serverEnv(process.env, env),
                    extendEnv: false,
                    forceKillAfter: "3 seconds",
                    stdin: "ignore",
                  }
                )
              );
              const stderr = yield* handle.stderr.pipe(
                Stream.decodeText(),
                Stream.splitLines,
                Stream.runForEach((line) =>
                  Effect.sync(() => {
                    said.push(line);
                    process.stderr.write(`[new design] ${line}\n`);
                  })
                ),
                Effect.ignore,
                Effect.forkScoped
              );
              yield* handle.stdout.pipe(
                Stream.decodeText(),
                Stream.splitLines,
                Stream.runForEach((line) =>
                  Option.match(decodeLine(line), {
                    onNone: () => Effect.void,
                    onSome: (progress) => {
                      seen.last = progress.step;
                      if (progress.state === "failed") {
                        seen.failed = {
                          message: progress.detail ?? "it failed",
                          step: progress.step,
                        };
                      }
                      return report(progress);
                    },
                  })
                ),
                Effect.ignore
              );
              yield* Fiber.join(stderr);
              return yield* handle.exitCode;
            })
          ).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                said.push(`the server could not be started: ${error.message}`);
                return -1;
              })
            )
          );
          if (Number(exitCode) === 0) {
            return {} satisfies NewDesignOutcome;
          }
          const outcome = {
            failed: seen.failed ?? {
              message: tail(said) || `it stopped (${exitCode})`,
              step: seen.last,
            },
          } satisfies NewDesignOutcome;
          if (!seen.failed) {
            yield* report({
              detail: outcome.failed.message,
              state: "failed",
              step: outcome.failed.step,
            });
          }
          return outcome;
        });

        /**
         * Adds it to the list and opens it, reporting the app's own last step. The editor is
         * told it is a new design, and opens on Sync's define step (ADR 0025's scratch case).
         */
        const open = Effect.fn("NewDesigns.open")(function* (
          folder: string,
          name: string,
          template: NewDesignInput["template"],
          report: (update: NewDesignUpdate) => Effect.Effect<void>
        ) {
          yield* report({ state: "active", step: "open" });
          return yield* projects
            .openFolder(folder, name, { [NEW_DESIGN_PARAM]: template })
            .pipe(
              Effect.flatMap(({ opened }) =>
                Effect.as(
                  report(
                    opened
                      ? { state: "done", step: "open" }
                      : {
                          detail:
                            "The open project stays open, for its agent to finish. The design is in the list.",
                          state: "skipped",
                          step: "open",
                        }
                  ),
                  {} satisfies NewDesignOutcome
                )
              ),
              Effect.catch((error) =>
                Effect.as(
                  report({
                    detail: error.message,
                    state: "failed",
                    step: "open",
                  }),
                  {
                    failed: { message: error.message, step: "open" },
                  } satisfies NewDesignOutcome
                )
              )
            );
        });

        return NewDesigns.of({
          create: (request, report) =>
            Effect.gen(function* () {
              if (!path.isAbsolute(request.folder)) {
                const message = `${request.folder} is not a folder's full path`;
                yield* report({
                  detail: message,
                  state: "failed",
                  step: "folder",
                });
                return {
                  failed: { message, step: "folder" },
                } satisfies NewDesignOutcome;
              }
              const written = yield* write(request, report);
              return written.failed
                ? written
                : yield* open(
                    request.folder,
                    request.name,
                    request.template,
                    report
                  );
            }),
          folderFor,
          open: (folder, name, template) =>
            open(folder, name, template, () => Effect.void),
        });
      })
    );
}
