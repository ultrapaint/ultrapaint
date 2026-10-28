import path from "node:path";
import { assert, describe, layer } from "@effect/vitest";
import { allTokens } from "@ultrapaint/contracts/token-table";
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
});
