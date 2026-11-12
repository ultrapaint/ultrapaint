/**
 * The `ultrapaint` command an agent outside the editor starts (`ultrapaint mcp`, ADR 0083),
 * installed by the app: a launcher written into a folder on the PATH that runs the app's own
 * server bundle with Electron's binary as Node, as the app runs a project's server. The app has
 * no command of its own otherwise; a checkout links its `scripts/cli.ts` instead
 * (`pnpm install:cli`).
 *
 * In an AppImage the app's files are in a mount that moves on every run, so the launcher runs the
 * AppImage itself and finds the server under `$APPDIR`, which the AppImage sets.
 */
import type { InstalledCommand } from "@ultrapaint/contracts/shell-bridge";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
} from "effect";
import { ChildProcessSpawner } from "effect/process";
import { runCommand } from "./command.ts";
import { LoginShell } from "./login-shell.ts";

/** Says the launcher is this app's: a second install writes over it, another is left alone. */
const MARK = "# The ultrapaint command of the Ultrapaint app (ADR 0083).";
const NAME = "ultrapaint";

/** Where the app's server is, as the launcher runs it. */
export type CommandApp =
  | {
      readonly _tag: "Bundle";
      /** Electron's binary, run as Node. */
      readonly executable: string;
      readonly serverBin: string;
      readonly webDist: string;
    }
  | {
      readonly _tag: "AppImage";
      readonly appImage: string;
      /** The server's bundle and the editor's build, from the mount's root. */
      readonly serverBin: string;
      readonly webDist: string;
    };

export class CommandInstallError extends Schema.TaggedError<CommandInstallError>()(
  "CommandInstallError",
  { message: Schema.String }
) {}

/** A path inside single quotes for `sh`. */
const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * The launcher: the server's bundle run as Node, the editor's build for it to serve, and the
 * launcher itself as the way `ultrapaint mcp` starts a project's server (`ULTRAPAINT_SERVE`).
 */
export const launcherScript = (app: CommandApp, at: string) => {
  const serve = quoted(JSON.stringify([at]));
  if (app._tag === "Bundle") {
    return `#!/bin/sh
${MARK}
export ELECTRON_RUN_AS_NODE=1
export ULTRAPAINT_WEB_DIST=${quoted(app.webDist)}
export ULTRAPAINT_SERVE=${serve}
exec ${quoted(app.executable)} ${quoted(app.serverBin)} "$@"
`;
  }
  // Node's -e leaves the arguments after the code where a script's would be, from argv[1]: the
  // server's own name goes back in front of them.
  const start = `process.argv.splice(1, 0, ${JSON.stringify(NAME)}); process.env.ULTRAPAINT_WEB_DIST = process.env.APPDIR + ${JSON.stringify(`/${app.webDist}`)}; import(process.env.APPDIR + ${JSON.stringify(`/${app.serverBin}`)});`;
  return `#!/bin/sh
${MARK}
export ELECTRON_RUN_AS_NODE=1
export ULTRAPAINT_SERVE=${serve}
exec ${quoted(app.appImage)} -e ${quoted(start)} "$@"
`;
};

/** The folders on a PATH, in its order. */
const pathFolders = (pathVariable: string) =>
  pathVariable.split(":").filter((folder) => folder !== "");

export class CommandLine extends Context.Service<
  CommandLine,
  {
    readonly install: Effect.Effect<InstalledCommand, CommandInstallError>;
    readonly installed: Effect.Effect<InstalledCommand | null>;
  }
>()("ultrapaint/desktop/CommandLine") {
  static readonly layer = (options: {
    readonly app: CommandApp;
    readonly home: string;
    readonly platform: NodeJS.Platform;
  }) =>
    Layer.effect(
      CommandLine,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const { env } = yield* LoginShell;
        const folders = pathFolders(env.PATH ?? "");
        const exists = (file: string) =>
          Effect.orElseSucceed(fs.exists(file), () => false);
        const writable = (folder: string) =>
          fs.access(folder, { writable: true }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false)
          );
        const ours = (file: string) =>
          fs.readFileString(file).pipe(
            Effect.map((text) => text.includes(MARK)),
            Effect.orElseSucceed(() => false)
          );

        const installed = Effect.gen(function* () {
          for (const folder of folders) {
            const file = path.join(folder, NAME);
            if (yield* exists(file)) {
              return { onPath: true, ours: yield* ours(file), path: file };
            }
          }
          return null;
        });

        /** Writes the launcher where it is, executable. */
        const writeAt = (file: string) =>
          Effect.gen(function* () {
            yield* fs.makeDirectory(path.dirname(file), { recursive: true });
            yield* fs.writeFileString(file, launcherScript(options.app, file));
            yield* fs.chmod(file, 0o755);
          });

        /**
         * On a Mac with no folder on the PATH the user can write, `/usr/local/bin`, with the
         * administrator's password, as other apps install their commands.
         */
        const writeAsAdministrator = (file: string) =>
          Effect.gen(function* () {
            const temporary = yield* fs.makeTempFileScoped();
            yield* fs.writeFileString(
              temporary,
              launcherScript(options.app, file)
            );
            const shell = `mkdir -p ${quoted(path.dirname(file))} && cp ${quoted(temporary)} ${quoted(file)} && chmod 755 ${quoted(file)}`;
            const result = yield* runCommand(
              "osascript",
              [
                "-e",
                `do shell script ${JSON.stringify(shell)} with administrator privileges`,
              ],
              { timeout: "5 minutes" }
            ).pipe(
              Effect.provideService(
                ChildProcessSpawner.ChildProcessSpawner,
                spawner
              )
            );
            if (result.exitCode !== 0) {
              return yield* new CommandInstallError({
                message: result.stderr.includes("User canceled")
                  ? "The command was not installed: the password was not given."
                  : `The command could not be installed in ${path.dirname(file)}: ${result.stderr.trim()}`,
              });
            }
          }).pipe(Effect.scoped);

        const install = Effect.gen(function* () {
          // A folder the user can write that agents find on the PATH.
          const preferred = [
            path.join(options.home, ".local", "bin"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            path.join(options.home, "bin"),
          ];
          for (const folder of preferred) {
            if (folders.includes(folder) && (yield* writable(folder))) {
              const file = path.join(folder, NAME);
              yield* writeAt(file);
              return { onPath: true, ours: true, path: file };
            }
          }
          if (options.platform === "darwin") {
            const file = path.join("/usr/local/bin", NAME);
            yield* writeAsAdministrator(file);
            return {
              onPath: folders.includes("/usr/local/bin"),
              ours: true,
              path: file,
            };
          }
          // Elsewhere the usual folder for a user's own commands, which the person adds to the
          // PATH if their shell does not.
          const file = path.join(options.home, ".local", "bin", NAME);
          yield* writeAt(file);
          return { onPath: false, ours: true, path: file };
        }).pipe(
          Effect.catchTags({
            PlatformError: (error) =>
              Effect.fail(
                new CommandInstallError({
                  message: `The command could not be installed: ${error.message}`,
                })
              ),
            TimeoutError: () =>
              Effect.fail(
                new CommandInstallError({
                  message:
                    "The command was not installed: the password was not given in time.",
                })
              ),
          })
        );

        return CommandLine.of({ install, installed });
      })
    );
}

/** The app as the launcher runs it, from where Electron says it is. */
export const commandApp = (where: {
  readonly appDir: string;
  /** `APPDIR` and `APPIMAGE`, which an AppImage sets. */
  readonly appImage: Option.Option<{
    readonly dir: string;
    readonly file: string;
  }>;
  readonly executable: string;
}): CommandApp => {
  const serverBin = `${where.appDir}/server/bin.mjs`;
  const webDist = `${where.appDir}/web`;
  if (Option.isSome(where.appImage)) {
    const { dir, file } = where.appImage.value;
    const inMount = (full: string) =>
      full.startsWith(`${dir}/`) ? full.slice(dir.length + 1) : full;
    return {
      _tag: "AppImage",
      appImage: file,
      serverBin: inMount(serverBin),
      webDist: inMount(webDist),
    };
  }
  return { _tag: "Bundle", executable: where.executable, serverBin, webDist };
};
