import { BadRequest } from "@ultrapaint/contracts/errors";
import { defaultFramework } from "@ultrapaint/contracts/settings";
import type {
  Framework,
  LocatedFramework,
} from "@ultrapaint/framework-api/node";
import { Context, Effect, Layer } from "effect";
import { AppLog } from "../app-log.ts";
import { RepoPaths } from "./repo-paths.ts";

/** Framework packages that ship with the tool, loaded only when a project asks for them. */
const bundled: Record<string, () => Promise<{ framework: Framework }>> = {
  "react-vite": () => import("@ultrapaint/framework-react-vite/preset"),
};

/**
 * Finds the implementation of a framework id. Today that is always the copy that ships with
 * the tool; this is the one place that changes when a repository can pin its own by
 * installing the framework package, the way a repository pins its Storybook framework.
 */
export const locateFramework = Effect.fn("locateFramework")(function* (
  id: string,
  _anchorDir: string
) {
  const load = bundled[id];
  if (!load) {
    return yield* new BadRequest({ message: `unknown framework: ${id}` });
  }
  const { framework } = yield* Effect.promise(load);
  return { framework, origin: "bundled" } satisfies LocatedFramework;
});

/**
 * The framework of the open project: how its screens are written, edited, catalogued and
 * previewed. Everything in the server that would otherwise know about React, JSX or Vite asks
 * this service instead.
 */
export class ProjectFramework extends Context.Service<
  ProjectFramework,
  Framework
>()("ultrapaint/server/ProjectFramework") {
  static readonly layer = Layer.effect(
    ProjectFramework,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const log = yield* AppLog;
      const id = paths.settings.framework ?? defaultFramework;
      const located = yield* Effect.orDie(locateFramework(id, paths.anchorDir));
      yield* log.log(
        "server",
        "info",
        `framework ${located.framework.id} (${located.origin})`
      );
      return located.framework;
    })
  );
}
