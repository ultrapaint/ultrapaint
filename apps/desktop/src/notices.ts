/**
 * What the app found the editor will miss on this machine, for the banner over the editor
 * (`Platform.notices`): Node.js, and a newer release of the app where it does not update itself.
 * Asked each time the editor loads: a Node installed since is found, on the `PATH` the login
 * shell gave at start; GitHub is asked about releases at most once an hour.
 */

import type { ShellNotice } from "@ultrapaint/contracts/shell-bridge";
import { Context, Effect, Layer, Option } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { LoginShell } from "./login-shell.ts";
import { checkNode, nodeNotice } from "./node-check.ts";
import { latestRelease, updateNotice } from "./updates.ts";

export interface NoticesOptions {
  readonly fetch: typeof fetch;
  /** Whether the app updates itself (an AppImage), so no notice says a release is out. */
  readonly selfUpdating: boolean;
  /** The app's own version. */
  readonly version: string;
}

export class Notices extends Context.Service<
  Notices,
  { readonly list: Effect.Effect<readonly ShellNotice[]> }
>()("ultrapaint/desktop/Notices") {
  static readonly layer = (options: NoticesOptions) =>
    Layer.effect(
      Notices,
      Effect.gen(function* () {
        const { env } = yield* LoginShell;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const latest = yield* Effect.cachedWithTTL(
          latestRelease(options.fetch),
          "1 hour"
        );
        const node = checkNode(env.PATH ?? "").pipe(
          Effect.map((status) => nodeNotice(status, process.platform)),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          )
        );
        const update = options.selfUpdating
          ? Effect.succeed(Option.none<ShellNotice>())
          : latest.pipe(
              Effect.map(
                Option.flatMap((version) =>
                  updateNotice(options.version, version, process.platform)
                )
              )
            );
        return Notices.of({
          list: Effect.all([node, update], { concurrency: 2 }).pipe(
            Effect.map((found) => found.flatMap(Option.toArray))
          ),
        });
      })
    );
}
