import path from "node:path";
import { assert, layer } from "@effect/vitest";
import { Effect, Fiber, FileSystem, Stream } from "effect";
import { TestEnv, TestServer } from "./testing/harness.ts";

const PAGE = `${JSON.stringify({
  root: { children: [], id: "root", type: "page" },
  version: 1,
})}\n`;

/** The first value of an event stream that arrives after `trigger` has run. */
const nextEvent = <A, E, B, E2, R2>(
  stream: Stream.Stream<A, E>,
  trigger: Effect.Effect<B, E2, R2>
) =>
  Effect.gen(function* () {
    const first = yield* Effect.forkScoped(
      Stream.runHead(stream).pipe(Effect.timeout("20 seconds"))
    );
    // The subscription has to reach the server before the change happens.
    yield* Effect.sleep("150 millis");
    yield* trigger;
    return yield* Fiber.join(first);
  });

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "the server's background work",
  (it) => {
    it.effect(
      "goes on watching the designs after a file that cannot be read",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["settings.set"](settings);
          const designs = path.join(repo, "designs");
          // A canvas.json and a page that are directories: reading either is an I/O error.
          yield* fs.makeDirectory(path.join(designs, "broken/canvas.json"), {
            recursive: true,
          });
          yield* fs.writeFileString(
            path.join(designs, "broken/a.page.json"),
            PAGE
          );
          yield* fs.makeDirectory(path.join(designs, "odd.page.json"));
          // The watchers see all of it.
          yield* Effect.sleep("500 millis");

          const listed = yield* client["pages.list"]();
          assert.include(
            listed.pages.map((p) => p.id),
            "broken/a.page.json"
          );

          const pages = yield* nextEvent(
            client["events.pages"](),
            fs.writeFileString(path.join(designs, "later.page.json"), PAGE)
          );
          assert.include(
            pages._tag === "Some" ? pages.value.pages.map((p) => p.id) : [],
            "later.page.json"
          );

          const document = yield* nextEvent(
            client["events.document"]().pipe(
              Stream.filter((d) => d.doc === "home.page.json")
            ),
            fs.writeFileString(path.join(designs, "home.page.json"), PAGE)
          );
          assert.deepStrictEqual(
            document._tag === "Some" ? document.value.root : null,
            { children: [], id: "root", type: "page" }
          );

          yield* fs.remove(path.join(designs, "broken"), { recursive: true });
          yield* fs.remove(path.join(designs, "odd.page.json"), {
            recursive: true,
          });
        }),
      30_000
    );

    it.effect(
      "works the sync plan out again after a package.json that does not read",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const manifest = path.join(repo, "designs/package.json");
          yield* fs.writeFileString(manifest, '{ "name": "designs", ');
          yield* client["settings.set"]({ ...settings, libraryDirs: [] });
          // The plan that runs on the project opening reads the broken manifest.
          yield* Effect.sleep("1 second");
          const plan = yield* client["sync.plan"]();
          assert.isFalse(plan.facts.app);

          yield* fs.writeFileString(
            manifest,
            '{ "name": "designs", "dependencies": { "react": "19" } }\n'
          );
          const next = yield* nextEvent(
            client["events.syncPlan"](),
            client["settings.set"]({ ...settings, libraryDirs: ["ui"] })
          );
          assert.isTrue(next._tag === "Some" && next.value.facts.app);
        }),
      30_000
    );

    it.effect(
      "lists the Figma imports there are when one of them does not read",
      () =>
        Effect.gen(function* () {
          const { client, home, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["settings.set"](settings);
          const dir = path.join(home, "imports", "fig_broken");
          yield* fs.makeDirectory(dir, { recursive: true });
          yield* fs.writeFileString(path.join(dir, "import.json"), "{ nope");

          const listed = yield* client["figma.list"]();
          assert.notInclude(
            listed.map((i) => i.id),
            "fig_broken"
          );
          // Nor does it stop the sync, which reads the newest import.
          yield* client["sync.plan"]();
        }),
      30_000
    );

    it.effect(
      "rebuilds the catalogue when its cache does not read",
      () =>
        Effect.gen(function* () {
          const { client, home, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["settings.set"]({ ...settings, libraryDirs: ["ui"] });
          const built = yield* client["catalogue.get"]({ refresh: true });
          const cacheDir = path.join(home, "catalogue");
          for (const name of yield* fs.readDirectory(cacheDir)) {
            yield* fs.writeFileString(path.join(cacheDir, name), "{ broken");
          }
          // A project opened again keeps nothing in memory: the cache is all there is.
          yield* client["settings.set"]({
            ...settings,
            libraryDirs: ["ui"],
            theme: "dark",
          });
          const rebuilt = yield* client["catalogue.get"]({ refresh: false });
          assert.notStrictEqual(rebuilt.builtAt, built.builtAt);
          assert.include(
            rebuilt.components.map((c) => c.name),
            "Button"
          );
        }),
      30_000
    );
  }
);
