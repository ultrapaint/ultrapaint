import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Stream } from "effect";
import { EventBus } from "./events.ts";
import { OpenProject, type ProjectServices } from "./project.ts";
import { ImplementationService } from "./services/implementation.ts";
import { ProjectFixture, withProject } from "./testing/project.ts";

const HOME = "home.page.json";
const ABOUT = "about.page.json";

/** A page with one heading saying `text`. */
const pageSaying = (text: string) =>
  `${JSON.stringify({
    root: {
      children: [
        { id: "heading", level: 1, role: "heading", text, type: "text" },
      ],
      id: "root",
      padding: 16,
      type: "page",
    },
    version: 1,
  })}\n`;

const inProject = <A, E>(effect: Effect.Effect<A, E, ProjectServices>) =>
  Effect.flatMap(OpenProject, (project) => project.use(effect));

const implementation = <A, E>(
  use: (service: ImplementationService["Service"]) => Effect.Effect<A, E>
) => inProject(Effect.flatMap(ImplementationService, use));

/** A file system that notes each file read whole, for a test to look at. */
const noting = () => {
  const read: string[] = [];
  return {
    fileSystem: (fs: FileSystem.FileSystem): FileSystem.FileSystem => ({
      ...fs,
      readFileString: (file, encoding) =>
        Effect.suspend(() => {
          read.push(file);
          return fs.readFileString(file, encoding);
        }),
    }),
    /** Those of `names` in the designs directory read since this was last asked, a name per read. */
    since: (...names: string[]) =>
      read
        .splice(0)
        .flatMap((file) =>
          names.filter((name) =>
            file.endsWith(`${path.sep}designs${path.sep}${name}`)
          )
        ),
  };
};

describe("the implementation list", () => {
  it.effect(
    "reads a canvas's comments once, however many pages the canvas has",
    () => {
      const files = noting();
      return withProject({
        fileSystem: files.fileSystem,
        files: {
          [`designs/${ABOUT}`]: pageSaying("About"),
          "designs/comments.json": '{ "comments": [], "version": 1 }\n',
        },
      })(
        Effect.gen(function* () {
          files.since();
          const { items } = yield* implementation((s) => s.list);
          assert.sameMembers(
            items.map((item) => item.target),
            [ABOUT, HOME]
          );
          assert.deepStrictEqual(files.since("comments.json"), [
            "comments.json",
          ]);
        })
      );
    }
  );

  it.effect("reads a page again only when its file was written since", () => {
    const files = noting();
    const pagesRead = () => files.since(HOME, ABOUT);
    return withProject({
      fileSystem: files.fileSystem,
      files: { [`designs/${ABOUT}`]: pageSaying("About") },
    })(
      Effect.gen(function* () {
        const { repo } = yield* ProjectFixture;
        const fs = yield* FileSystem.FileSystem;
        yield* implementation((s) => s.mark(ABOUT, ["ui/button.tsx"]));
        const statusOf = Effect.map(
          implementation((s) => s.list),
          ({ items }) => items.find((item) => item.target === ABOUT)?.status
        );
        assert.strictEqual(yield* statusOf, "implemented");
        files.since();
        assert.strictEqual(yield* statusOf, "implemented");
        assert.deepStrictEqual(pagesRead(), []);

        // Written as an agent writes it: on disk, past the editor.
        yield* fs.writeFileString(
          path.join(repo, "designs", ABOUT),
          pageSaying("About us")
        );
        files.since();
        assert.strictEqual(yield* statusOf, "changed");
        const read = pagesRead();
        assert.include(read, ABOUT);
        assert.notInclude(read, HOME);
      })
    );
  });

  it.effect("is told to the editors only when it changed", () =>
    withProject()(
      Effect.gen(function* () {
        const events = yield* EventBus;
        // Started at once, the fiber has subscribed by the time the fork returns.
        const heard = yield* Effect.forkScoped(
          events.subscribe("implementation").pipe(
            Stream.map(
              ({ items }) => items.find((item) => item.target === HOME)?.status
            ),
            Stream.take(2),
            Stream.runCollect
          ),
          { startImmediately: true }
        );
        yield* implementation((s) => s.setReady(HOME, true));
        // Ready already: the list is the one the editors have.
        yield* implementation((s) => s.setReady(HOME, true));
        yield* implementation((s) => s.setReady(HOME, false));
        assert.deepStrictEqual(
          [...(yield* Fiber.join(heard))],
          ["ready", "draft"]
        );
      })
    )
  );
});
