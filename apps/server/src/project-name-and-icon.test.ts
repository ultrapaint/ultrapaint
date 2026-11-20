import { NodeHttpServer } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { PROJECT_IMAGE_ROUTE } from "@ultrapaint/contracts/project";
import {
  PROJECT_ICON_COLORS,
  type Settings,
} from "@ultrapaint/contracts/settings";
import { Effect, FileSystem, Layer, Path, type Scope } from "effect";
import { HttpRouter } from "effect/http";
import { ProjectImageRoute } from "./asset-route.ts";
import { OpenProject } from "./project.ts";
import { TestEnv } from "./testing/harness.ts";
import {
  inAProject,
  type ProjectRpc,
  type ProjectTestOptions,
} from "./testing/project.ts";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';

/** A test on a project of its own, asked as the editor asks (docs/TESTING.md rules 1 and 3). */
const inProject = <A, E>(
  name: string,
  body: () => Effect.Effect<
    A,
    E,
    Layer.Success<ReturnType<typeof ProjectRpc>> | Scope.Scope
  >,
  options: ProjectTestOptions = {}
) => it.effect(name, () => inAProject(options)(body()));

/** Saves the project's settings with these changed, as the settings dialog does. */
const saveWith = (changes: Partial<Settings>) =>
  Effect.gen(function* () {
    const { client, settings } = yield* TestEnv;
    return yield* client["settings.set"]({ ...settings, ...changes });
  });

const info = Effect.flatMap(TestEnv, ({ client }) =>
  client["project.info"](undefined)
);

/** The project's images served as the editor asks for them: each answer's status and type. */
const served = Effect.gen(function* () {
  const context = yield* Effect.context<OpenProject>();
  const { dispose, handler } = HttpRouter.toWebHandler(
    ProjectImageRoute.pipe(
      Layer.provide(Layer.succeedContext(context)),
      // What a request is answered with (a file's platform) is what the layer gives.
      Layer.provideMerge(NodeHttpServer.layerHttpServices)
    ),
    { disableLogger: true }
  );
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  return (rel: string) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(
          `http://127.0.0.1${PROJECT_IMAGE_ROUTE}?path=${encodeURIComponent(rel)}`
        )
      );
      return {
        status: response.status,
        type: response.headers.get("content-type"),
      };
    });
});

/** The headers an image of the project is answered with. */
const servedHeaders = Effect.gen(function* () {
  const context = yield* Effect.context<OpenProject>();
  const { dispose, handler } = HttpRouter.toWebHandler(
    ProjectImageRoute.pipe(
      Layer.provide(Layer.succeedContext(context)),
      Layer.provideMerge(NodeHttpServer.layerHttpServices)
    ),
    { disableLogger: true }
  );
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  return (rel: string) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(
          `http://127.0.0.1${PROJECT_IMAGE_ROUTE}?path=${encodeURIComponent(rel)}`
        )
      );
      return {
        body: await response.text(),
        policy: response.headers.get("content-security-policy"),
        sniff: response.headers.get("x-content-type-options"),
      };
    });
});

describe("the project's name (ADR 0107)", () => {
  inProject("is the one its settings give, saved with them", () =>
    Effect.gen(function* () {
      const { home } = yield* TestEnv;
      const fs = yield* FileSystem.FileSystem;
      assert.isTrue((yield* saveWith({ name: "Shop admin" })).ok);
      assert.strictEqual((yield* info).name, "Shop admin");
      const file = JSON.parse(
        yield* fs.readFileString(`${home}/settings.json`)
      ) as { name?: string };
      assert.strictEqual(file.name, "Shop admin");
    })
  );

  inProject(
    "is the folder's when none is given, or the one given is blank",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* TestEnv;
        const folder = repo.split("/").at(-1);
        assert.strictEqual((yield* info).name, folder);
        yield* saveWith({ name: "  " });
        assert.strictEqual((yield* info).name, folder);
      })
  );

  inProject(
    "changes with the project left open, its undo history with it",
    () =>
      Effect.gen(function* () {
        const project = yield* OpenProject;
        const before = yield* project.scope;
        yield* saveWith({
          icon: { color: "teal", kind: "icon", name: "boxes" },
          name: "Renamed",
        });
        assert.strictEqual(yield* project.scope, before);
        assert.strictEqual((yield* info).name, "Renamed");
      })
  );
});

describe("the project's icon (ADR 0107)", () => {
  inProject("is the icon of the set it was given, in its colour", () =>
    Effect.gen(function* () {
      const icon = { color: "violet", kind: "icon", name: "boxes" } as const;
      yield* saveWith({ icon });
      assert.deepStrictEqual((yield* info).icon, icon);
      assert.deepStrictEqual((yield* info).settings?.icon, icon);
    })
  );

  inProject(
    "is the image of the project it was given, until that file is removed",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        yield* saveWith({
          icon: { kind: "file", path: "brand/mark.svg" },
          name: "Shop",
        });
        assert.deepStrictEqual((yield* info).icon, {
          kind: "file",
          path: "brand/mark.svg",
        });
        yield* fs.remove(`${repo}/brand/mark.svg`);
        assert.strictEqual((yield* info).icon?.kind, "initial");
      }),
    { files: { "brand/mark.svg": SVG } }
  );

  inProject(
    "is the project's favicon by default",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual((yield* info).icon, {
          kind: "file",
          path: "public/favicon.svg",
        });
      }),
    { files: { "app/icon.png": "png", "public/favicon.svg": SVG } }
  );

  inProject(
    "takes a favicon added since the project opened once the settings are saved again",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        yield* saveWith({ name: "shop" });
        assert.strictEqual((yield* info).icon?.kind, "initial");
        yield* fs.makeDirectory(`${repo}/public`, { recursive: true });
        yield* fs.writeFileString(`${repo}/public/favicon.svg`, SVG);
        yield* saveWith({ name: "Shop" });
        assert.deepStrictEqual((yield* info).icon, {
          kind: "file",
          path: "public/favicon.svg",
        });
      })
  );

  inProject(
    "is the name's first letter in a colour of the set when the project has no favicon",
    () =>
      Effect.gen(function* () {
        yield* saveWith({ name: "_shop" });
        const shown = (yield* info).icon;
        assert.strictEqual(shown?.kind, "initial");
        if (shown?.kind === "initial") {
          assert.strictEqual(shown.initial, "S");
          assert.include(PROJECT_ICON_COLORS, shown.color);
        }
      })
  );
});

describe("the images offered for the icon (ADR 0107)", () => {
  inProject(
    "are the favicons and app icons where they are kept, the favicons first",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        const found = yield* client["project.images"](undefined);
        assert.deepStrictEqual(found, [
          "favicon.svg",
          "public/favicon.ico",
          "app/icon.png",
          "static/apple-touch-icon.png",
        ]);
      }),
    {
      files: {
        "app/icon.png": "png",
        "docs/screenshot.png": "png",
        "favicon.svg": SVG,
        "public/favicon.ico": "ico",
        "src/icon.txt": "not an image",
        "static/apple-touch-icon.png": "png",
      },
    }
  );

  inProject(
    "include the application's own, before the project's",
    () =>
      Effect.gen(function* () {
        const { client } = yield* TestEnv;
        assert.deepStrictEqual(yield* client["project.images"](undefined), [
          "ui/public/favicon.svg",
          "public/favicon.svg",
        ]);
      }),
    {
      files: {
        "public/favicon.svg": SVG,
        "ui/package.json": "{}",
        "ui/public/favicon.svg": SVG,
      },
      settings: { resolveFrom: "ui" },
    }
  );
});

describe("an image of the project, as the editor draws it (ADR 0107)", () => {
  inProject(
    "is served from the project's folder, and nothing outside it or that is not an image",
    () =>
      Effect.gen(function* () {
        const { repo } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        // An image in a folder beside the project's, and a link to it inside the project.
        const outside = path.join(
          yield* fs.realPath(yield* fs.makeTempDirectoryScoped()),
          "outside.svg"
        );
        yield* fs.writeFileString(outside, SVG);
        yield* fs.symlink(outside, path.join(repo, "brand", "linked.svg"));
        const get = yield* served;
        assert.deepStrictEqual(yield* get("brand/mark.svg"), {
          status: 200,
          type: "image/svg+xml",
        });
        assert.strictEqual(
          (yield* get(path.relative(repo, outside))).status,
          404
        );
        assert.strictEqual((yield* get(outside)).status, 404);
        assert.strictEqual((yield* get("brand/linked.svg")).status, 404);
        assert.strictEqual((yield* get("designs/package.json")).status, 404);
        assert.strictEqual((yield* get("brand/missing.svg")).status, 404);
      }),
    { files: { "brand/mark.svg": SVG } }
  );

  inProject(
    "is served so that an SVG opened as a document runs no script on the server's origin",
    () =>
      Effect.gen(function* () {
        const get = yield* servedHeaders;
        const answer = yield* get("brand/mark.svg");
        assert.strictEqual(answer.body, SVG);
        assert.include(answer.policy ?? "", "sandbox");
        assert.include(answer.policy ?? "", "default-src 'none'");
        assert.strictEqual(answer.sniff, "nosniff");
      }),
    { files: { "brand/mark.svg": SVG } }
  );
});
