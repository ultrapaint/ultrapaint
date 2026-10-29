import { BadRequest } from "@ultrapaint/contracts/errors";
import type { Framework } from "@ultrapaint/framework-api/node";
import { Effect } from "effect";

/** Framework packages that ship with the tool, loaded only when a project asks for them. */
const bundled: Record<string, () => Promise<{ framework: Framework }>> = {
  "react-vite": () => import("@ultrapaint/framework-react-vite/preset"),
};

/**
 * The implementation of a framework id: where a repository's application is, and how a new one
 * is written (the setup's detection and scaffold, ADR 0042). Nothing draws with it.
 */
export const locateFramework = Effect.fn("locateFramework")(function* (
  id: string
) {
  const load = bundled[id];
  if (!load) {
    return yield* new BadRequest({ message: `unknown framework: ${id}` });
  }
  const { framework } = yield* Effect.promise(load);
  return framework;
});
