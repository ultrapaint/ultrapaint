import path from "node:path";
import { assert, describe, layer } from "@effect/vitest";
import type { CanvasLayout } from "@ultrapaint/contracts/pages";
import { allTokens } from "@ultrapaint/contracts/token-table";
import { renderTemplate } from "@ultrapaint/design-document/factories";
import { Effect, Fiber, FileSystem, Option, Stream } from "effect";
import { EventBus } from "./events.ts";
import { ProjectManager } from "./project.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { HostManager } from "./services/host.ts";
import { EditorTools } from "./services/mcp/tools.ts";
import { PagesService } from "./services/pages.ts";
import { callTool, ProjectFixture, ProjectTest } from "./testing/project.ts";

const THEME = `@theme {
  --color-ink: #111827;
}
`;

/** A canvas whose Home page has a frame at the origin and a phone's view beside it. */
const HOME_WITH_A_VIEW: CanvasLayout = {
  frames: {
    "home.page.json": {
      height: 900,
      preset: "desktop",
      views: [{ height: 844, id: "w390", width: 390, x: 1520, y: 0 }],
      width: 1440,
      x: 0,
      y: 0,
    },
  },
  version: 1,
};

const pages = <A, E>(
  f: (service: PagesService["Service"]) => Effect.Effect<A, E>
) =>
  Effect.flatMap(ProjectManager, (project) =>
    project.use(Effect.flatMap(PagesService, f))
  );

const designSystem = <A, E>(
  f: (service: DesignSystemService["Service"]) => Effect.Effect<A, E>
) =>
  Effect.flatMap(ProjectManager, (project) =>
    project.use(Effect.flatMap(DesignSystemService, f))
  );

describe("a project in-process", () => {
  layer(ProjectTest(), { excludeTestServices: true })((it) => {
    it.effect(
      "opens with a preview that was asked to start and spawned nothing",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const info = yield* project.info;
          assert.isTrue(info.configured);
          assert.deepStrictEqual(info.host, { state: "running" });
          const status = yield* project.use(
            Effect.flatMap(HostManager, (host) => host.status)
          );
          assert.isUndefined(status.pid);
        })
    );

    it.effect("makes, renames and lists pages, and writes their files", () =>
      Effect.gen(function* () {
        const { repo } = yield* ProjectFixture;
        const fs = yield* FileSystem.FileSystem;
        const made = yield* pages((p) =>
          p.create("", { name: "Plans", route: "/plans" }, "blank")
        );
        assert.strictEqual(made.route, "/plans");
        assert.isTrue(
          yield* fs.exists(path.join(repo, "designs/plans.page.json"))
        );
        const renamed = yield* pages((p) => p.rename(made.id, "Pricing"));
        assert.strictEqual(renamed.route, "/plans");
        const listed = yield* pages((p) => p.list);
        assert.deepStrictEqual(
          listed.pages.map((p) => [p.name, p.route]).sort(),
          [
            ["Home", "/home"],
            ["Pricing", "/plans"],
          ]
        );
        assert.isFalse(
          yield* fs.exists(path.join(repo, "designs/plans.page.json"))
        );
      })
    );

    it.effect(
      "calls an MCP tool's handler without a socket, as the thread that calls it",
      () =>
        Effect.gen(function* () {
          const events = yield* EventBus;
          const listed = yield* callTool(EditorTools, "list_pages", {});
          assert.include(
            listed.pages.map((p) => p.file),
            "designs/home.page.json"
          );
          const refused = yield* Effect.flip(
            callTool(EditorTools, "create_page", {
              name: "Fancy",
              template: "fancy",
            })
          );
          assert.include(refused.message, "blank, centered, page");
          // The editor is told which thread focuses where: the calling thread is the tool's.
          // Started at once, the fiber has subscribed by the time the fork returns.
          const focused = yield* Effect.forkScoped(
            Stream.runHead(events.subscribe("agent.focus")),
            { startImmediately: true }
          );
          yield* callTool(EditorTools, "focus", { route: "/home" }, "t-1");
          assert.deepStrictEqual(Option.getOrNull(yield* Fiber.join(focused)), {
            pageId: "home.page.json",
            route: "/home",
            threadId: "t-1",
          });
        })
    );
  });

  layer(
    ProjectTest({
      files: { "styles/app.css": THEME },
      settings: { hostCss: ["../../styles/app.css"] },
    }),
    { excludeTestServices: true }
  )((it) => {
    it.effect(
      "reads the code's tokens into the design system, and sets one",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          yield* designSystem((d) => d.detect);
          const tokenOf = Effect.map(
            designSystem((d) => d.get),
            ({ designSystem: ds }) =>
              ds
                ? allTokens(ds).find((t) => t.name === "color-ink")?.value
                : null
          );
          assert.strictEqual(yield* tokenOf, "#111827");
          yield* designSystem((d) =>
            d.setToken({ name: "color-ink", value: "#333333" })
          );
          assert.strictEqual(yield* tokenOf, "#333333");
          assert.include(
            yield* fs.readFileString(
              path.join(repo, "designs/design.tokens.json")
            ),
            "#333333"
          );
        })
    );
  });

  // Each on a project of its own: the frames one test makes would be in the other's way.
  const withHomeView = () =>
    ProjectTest({
      files: { "designs/canvas.json": JSON.stringify(HOME_WITH_A_VIEW) },
    });
  const framesNow = pages((p) => p.readCanvas("")).pipe(
    Effect.map((layout) => layout.frames)
  );

  layer(withHomeView(), { excludeTestServices: true })((it) => {
    it.effect("places a new page's frame past the other pages' views", () =>
      Effect.gen(function* () {
        yield* pages((p) =>
          p.createWith(
            "",
            { name: "Login" },
            renderTemplate("blank", "Login"),
            { height: 600, width: 400 }
          )
        );
        // Home's view ends at 1520 + 390: the new frame starts a gap past it.
        assert.deepStrictEqual((yield* framesNow)["login.page.json"], {
          height: 600,
          preset: "custom",
          width: 400,
          x: 1520 + 390 + 80,
          y: 0,
        });
      })
    );
  });

  layer(withHomeView(), { excludeTestServices: true })((it) => {
    it.effect(
      "sizes a page with no frame where the editor draws it, its views beside it",
      () =>
        Effect.gen(function* () {
          yield* pages((p) => p.create("", { name: "Plans" }, "blank"));
          const sized = yield* callTool(EditorTools, "set_frame", {
            route: "plans.page.json",
            views: [390],
          });
          assert.deepStrictEqual(sized, {
            file: "designs/plans.page.json",
            height: 900,
            width: 1440,
          });
          const frames = yield* framesNow;
          assert.deepStrictEqual(frames["plans.page.json"], {
            height: 900,
            preset: "desktop",
            views: [{ height: 900, id: "w390", width: 390, x: 1520, y: 0 }],
            width: 1440,
            x: 1520 + 390 + 80,
            y: 0,
          });
          // Home's frame and its view are left as they were.
          assert.deepStrictEqual(
            frames["home.page.json"],
            HOME_WITH_A_VIEW.frames["home.page.json"]
          );
        })
    );
  });

  const DEFAULTS = { fill: "$color-background", theme: "dark" };
  layer(
    ProjectTest({
      files: {
        "designs/canvas.json": JSON.stringify({
          ...HOME_WITH_A_VIEW,
          defaults: DEFAULTS,
        }),
      },
    }),
    { excludeTestServices: true }
  )((it) => {
    it.effect(
      "keeps what the canvas's pages are drawn in when its frames are written",
      () =>
        Effect.gen(function* () {
          yield* callTool(EditorTools, "set_frame", {
            route: "home.page.json",
            width: 1280,
          });
          const layout = yield* pages((p) => p.readCanvas(""));
          assert.strictEqual(layout.frames["home.page.json"]?.width, 1280);
          assert.deepStrictEqual(layout.defaults, DEFAULTS);
        })
    );
  });
});
