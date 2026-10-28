/**
 * What the app found the editor will miss on this machine, for the banner over the editor
 * (`Platform.notices`): Node.js, so far. Asked each time the editor loads: a Node installed
 * since is found, on the `PATH` the login shell gave at start.
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
      return Notices.of({
        list: checkNode(env.PATH ?? "").pipe(
          Effect.map((node) =>
            Option.toArray(nodeNotice(node, process.platform))
          ),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            spawner
          )
        ),
      });
    })
  );
}
