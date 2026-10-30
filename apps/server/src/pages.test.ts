import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ProjectManager } from "./project.ts";
import { PagesService } from "./services/pages.ts";
import { ProjectTest } from "./testing/project.ts";

/** The open project's pages, in a project of the test's own. */
const pages = <A, E>(
  f: (pages: PagesService["Service"]) => Effect.Effect<A, E>
) =>
  Effect.flatMap(ProjectManager, (project) =>
    project.use(Effect.flatMap(PagesService, f))
  );

const inAProject = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(ProjectTest()), Effect.scoped);

describe("a canvas's home", () => {
  it.effect("is a URL one of its pages serves, and follows that page", () =>
    inAProject(
      Effect.gen(function* () {
        const homeOf = Effect.map(
          pages((p) => p.list),
          (list) => list.canvases.find((c) => c.id === "")?.home
        );
        yield* pages((p) =>
          p.create("", { name: "Pricing", route: "/pricing" })
        );
        const nowhere = yield* Effect.flip(
          pages((p) => p.setHome("", "/nowhere"))
        );
        assert.strictEqual(nowhere._tag, "BadRequest");
        const set = yield* pages((p) => p.setHome("", "pricing"));
        assert.strictEqual(set.home, "/pricing");
        assert.strictEqual(
          (yield* pages((p) => p.readCanvas(""))).home,
          "/pricing"
        );
        // The page serves another URL: the canvas follows it there.
        yield* pages((p) => p.setRoute("pricing.page.json", "/plans"));
        assert.strictEqual(yield* homeOf, "/plans");
        // The page goes: the canvas opens on the first URL another page serves.
        yield* pages((p) => p.delete("pricing.page.json"));
        assert.strictEqual(yield* homeOf, "/home");
        assert.strictEqual(
          (yield* pages((p) => p.readCanvas(""))).home,
          "/home"
        );
      })
    )
  );
});
