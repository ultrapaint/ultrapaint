import { BadRequest } from "@ultrapaint/contracts/errors";
import {
  defaultStyleSystem,
  type StyleSystemId,
} from "@ultrapaint/contracts/tokens";
import type { StyleSystem } from "@ultrapaint/framework-api/node";
import { Context, Effect, Layer } from "effect";
import { AppLog } from "../app-log.ts";
import { RepoPaths } from "./repo-paths.ts";

/** Style systems that ship with the tool, loaded only when a project asks for them. */
const bundled: Record<
  StyleSystemId,
  () => Promise<{ styleSystem: StyleSystem }>
> = {
  "tailwind-v4": () => import("@ultrapaint/style-tailwind-v4/preset"),
};

/**
 * Finds the implementation of a style system id (ADR 0024). Today that is always the copy that
 * ships with the tool, as for frameworks.
 */
export const locateStyleSystem = Effect.fn("locateStyleSystem")(function* (
  id: string
) {
  const load = bundled[id as StyleSystemId];
  if (!load) {
    return yield* new BadRequest({ message: `unknown style system: ${id}` });
  }
  const { styleSystem } = yield* Effect.promise(load);
  return styleSystem;
});

/**
 * The style system of the open project: where its tokens are declared and how its code writes
 * them. Everything in the server that would otherwise know about Tailwind asks this service.
 */
export class ProjectStyleSystem extends Context.Service<
  ProjectStyleSystem,
  StyleSystem
>()("ultrapaint/server/ProjectStyleSystem") {
  static readonly layer = Layer.effect(
    ProjectStyleSystem,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const log = yield* AppLog;
      const id = paths.settings.styleSystem ?? defaultStyleSystem;
      const styleSystem = yield* Effect.orDie(locateStyleSystem(id));
      yield* log.log("server", "info", `style system ${styleSystem.id}`);
      return styleSystem;
    })
  );
}
