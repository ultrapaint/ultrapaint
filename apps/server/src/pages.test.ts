import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { ProjectManager } from "./project.ts";
import { PagesService } from "./services/pages.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

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

/** An app component whose button leads to the Pricing page by its file. */
const BANNER = `${JSON.stringify(
  {
    name: "Banner",
    origin: "app",
    properties: [],
    slots: [],
    tree: {
      children: [
        {
          id: "go",
          link: "pricing.page.json",
          role: "paragraph",
          text: "See the plans",
          type: "text",
        },
      ],
      id: "root",
      type: "row",
    },
    version: 1,
  },
  null,
  2
)}\n`;

describe("a page renamed", () => {
  it.effect("takes the links of an app component's tree along", () =>
    Effect.gen(function* () {
      const { repo } = yield* ProjectFixture;
      const fs = yield* FileSystem.FileSystem;
      const pricing = yield* pages((p) =>
        p.create("", { name: "Pricing", route: "/pricing" })
      );
      const renamed = yield* pages((p) => p.rename(pricing.id, "Plans"));
      const banner = JSON.parse(
        yield* fs.readFileString(
          path.join(repo, "designs/components/Banner.component.json")
        )
      );
      assert.strictEqual(banner.tree.children[0].link, renamed.path);
    }).pipe(
      Effect.provide(
        ProjectTest({
          files: { "designs/components/Banner.component.json": BANNER },
        })
      ),
      Effect.scoped
    )
  );
});
