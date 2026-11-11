/**
 * What the app found the editor will miss on this machine, for the banner over the editor
 * (`Platform.notices`): Node.js. Asked each time the editor loads: a Node installed since is
 * found, on the `PATH` the login shell gave at start. A newer release of the app is the
 * updater's, not a notice (ADR 0078).
 */

import type { ShellNotice } from "@ultrapaint/contracts/shell-bridge";
import { Context, Effect, Layer, Option } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { LoginShell } from "./login-shell.ts";
import { checkNode, nodeNotice } from "./node-check.ts";

export class Notices extends Context.Service<
  Notices,
  { readonly list: Effect.Effect<readonly ShellNotice[]> }
>()("ultrapaint/desktop/Notices") {
  static readonly layer = Layer.effect(
    Notices,
    Effect.gen(function* () {
      const { env } = yield* LoginShell;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const node = checkNode(env.PATH ?? "").pipe(
        Effect.map((status) => nodeNotice(status, process.platform)),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
      );
      return Notices.of({
        list: Effect.map(node, Option.toArray),
      });
    })
  );
}
