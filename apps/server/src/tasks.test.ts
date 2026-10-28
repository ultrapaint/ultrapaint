import path from "node:path";
import { assert, describe, layer } from "@effect/vitest";
import type { TaskRequest } from "@ultrapaint/contracts/tasks";
import { Effect, FileSystem } from "effect";
import { ProjectManager } from "./project.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { PagesService } from "./services/pages.ts";
import { SlashCommands } from "./services/threads/commands.ts";
import { AgentTasks } from "./services/threads/tasks.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

const task = (request: TaskRequest) =>
  Effect.flatMap(AgentTasks, (tasks) => tasks.task(request));

const textOf = (request: TaskRequest) =>
  Effect.map(task(request), ({ text }) => text);

/** Why a request is not a task, and what the agent is to tell the user. */
const failureOf = (request: TaskRequest) =>
  Effect.map(Effect.flip(task(request)), ({ command, message, next }) => ({
    command,
    message,
    next,
  }));

const THEME = `@theme {
  --color-ink: #111827;
}
`;

/** The fixture with a stylesheet, and a design system read from it. */
const withDesignSystem = Effect.gen(function* () {
  const { reopen, repo } = yield* ProjectFixture;
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(path.join(repo, "styles"), { recursive: true });
  yield* fs.writeFileString(path.join(repo, "styles/app.css"), THEME);
  yield* reopen({ hostCss: ["../../styles/app.css"] });
  const project = yield* ProjectManager;
  yield* project.use(Effect.flatMap(DesignSystemService, (d) => d.detect));
});

/** The design's value of a token changed, so that it waits for the code. */
const designChanges = Effect.gen(function* () {
  const project = yield* ProjectManager;
  yield* project.use(
    Effect.flatMap(DesignSystemService, (d) =>
      d.setToken({ name: "color-ink", value: "#333333" })
    )
  );
});

describe("tasks, with the editor's MCP server", () => {
  layer(ProjectTest({ mcp: true }), { excludeTestServices: true })((it) => {
    it.effect("gives each request its task and its thread's purpose", () =>
      Effect.gen(function* () {
        const init = yield* task({ _tag: "Init" });
        assert.strictEqual(init.purpose, "design");
        assert.include(init.text, '<ultrapaint-task command="init">');
        assert.include(init.text, "1. Call scan_design_system.");
        // No component directory is configured: the configuration is not the agent's to fix.
        assert.include(init.text, "the editor sees no components");

        const implement = yield* task({ _tag: "Implement", target: "/home" });
        assert.strictEqual(implement.purpose, "implement");
        assert.include(
          implement.text,
          "Implement the page Home of the design (designs/home.page.json)"
        );
        assert.include(
          implement.text,
          'call handoff with action "mark", target "home.page.json" and files'
        );

        // Linking pages built already changes no code.
        const adopt = yield* task({ _tag: "Adopt", targets: [""] });
        assert.strictEqual(adopt.purpose, "design");
        assert.include(adopt.text, "- home.page.json: Home, /home");
        assert.include(
          adopt.text,
          `mark it implemented: handoff with action "mark", target the page's id`
        );
        assert.include(adopt.text, "4. If marking is refused");
        assert.include(adopt.text, "5. End with a table");

        const redraw = yield* textOf({
          _tag: "Redraw",
          canvas: "",
          change: "to wireframes",
        });
        assert.include(redraw, 'The canvas "Designs" ("") is a copy');
        assert.include(redraw, "to wireframes");
        assert.include(redraw, 'always passing canvas: "": read_page');

        assert.include(
          yield* textOf({ _tag: "Components", canvas: "" }),
          "Draw a sheet of this repository's design system into the canvas"
        );

        const define = yield* textOf({ _tag: "SetupStep", step: "define" });
        assert.include(define, "This is the Define step");
        assert.include(define, "End by calling finish_setup_step");

        assert.include(
          yield* textOf({ _tag: "Sync" }),
          "The user ran /sync. The sync is the editor's"
        );
      })
    );

    it.effect(
      "says why a request that names what is not there is no task",
      () =>
        Effect.gen(function* () {
          assert.deepStrictEqual(
            yield* failureOf({ _tag: "Implement", target: "/nowhere" }),
            {
              command: "implement",
              message:
                "no page is /nowhere; the pages are:\n- Home, /home: designs/home.page.json",
              next: "Ask which one.",
            }
          );
          assert.include(
            (yield* failureOf({ _tag: "Implement", target: "spec:Nope" }))
              .message,
            "no page is spec:Nope"
          );
          assert.deepStrictEqual(
            yield* failureOf({ _tag: "Redraw", canvas: "nowhere" }),
            {
              command: "redraw",
              message:
                'there is no canvas "nowhere"; the canvases are: Designs ("")',
              next: "Ask which one.",
            }
          );
          assert.strictEqual(
            (yield* failureOf({ _tag: "Adopt", targets: ["nowhere"] })).message,
            "there is no canvas or page nowhere, and every page named is linked already"
          );
          assert.strictEqual(
            (yield* failureOf({ _tag: "ImportFigma" })).message,
            "no Figma file has been uploaded"
          );
          assert.strictEqual(
            (yield* failureOf({ _tag: "SetupStep", step: "map" })).message,
            "Map has not started: there is no mapping yet"
          );
          const inventory = yield* failureOf({
            _tag: "SetupStep",
            step: "inventory",
          });
          assert.strictEqual(
            inventory.message,
            "inventory is not a step an agent runs"
          );
          assert.include(
            inventory.next ?? "",
            "The steps an agent runs are define, map, migrate."
          );
          for (const source of ["code", "describe"] as const) {
            assert.include(
              (yield* failureOf({ _tag: "Sync", source })).message,
              "there is no design system yet"
            );
          }
          assert.strictEqual(
            (yield* failureOf({ _tag: "Sync", source: "figma" })).message,
            "no Figma file has been imported"
          );
        })
    );
  });

  layer(ProjectTest({ mcp: true }), { excludeTestServices: true })(
    "with pages of several canvases",
    (it) => {
      it.effect(
        "names a URL that pages of several canvases serve by its canvas",
        () =>
          Effect.gen(function* () {
            const project = yield* ProjectManager;
            const marketing = yield* project.use(
              Effect.gen(function* () {
                const pages = yield* PagesService;
                const canvas = yield* pages.createCanvas("Marketing");
                yield* pages.create(canvas.id, {
                  name: "Home",
                  route: "/home",
                });
                return canvas.id;
              })
            );
            const ambiguous = yield* failureOf({
              _tag: "Implement",
              target: "/home",
            });
            assert.include(
              ambiguous.message,
              `/home is a page in several canvases ("", "${marketing}")`
            );
            assert.include(
              yield* textOf({
                _tag: "Implement",
                canvas: marketing,
                target: "/home",
              }),
              `Implement the page Home of the design (designs/${marketing}/home.page.json)`
            );
          })
      );
    }
  );

  layer(ProjectTest({ mcp: true }), { excludeTestServices: true })(
    "with a design system",
    (it) => {
      it.effect("brings the code up to the design through handoff", () =>
        Effect.gen(function* () {
          yield* withDesignSystem;
          assert.include(
            yield* textOf({ _tag: "Sync", source: "code" }),
            "The code has every value of the design: say so, and stop."
          );
          yield* designChanges;
          const sync = yield* textOf({ _tag: "Sync", source: "code" });
          assert.include(sync, "Tokens of the design that wait for the code:");
          assert.include(
            sync,
            'Export what waits for the code: call handoff with action "export" and no tokens'
          );
        })
      );
    }
  );
});

describe("tasks, without the editor's MCP server", () => {
  layer(ProjectTest({ mcp: false }), { excludeTestServices: true })((it) => {
    it.effect("says how to do each thing by hand", () =>
      Effect.gen(function* () {
        const init = yield* textOf({ _tag: "Init" });
        assert.include(init, "1. Read the stylesheets the preview imports");
        assert.include(init, "valid against this JSON Schema");
        assert.notInclude(init, "scan_design_system");

        const implement = yield* task({ _tag: "Implement", target: "/home" });
        assert.strictEqual(implement.purpose, "implement");
        assert.include(
          implement.text,
          "Once it is done, tell the user which files implement it, so they can mark it implemented in the editor."
        );
        assert.notInclude(implement.text, "handoff");

        const adopt = yield* textOf({ _tag: "Adopt", targets: [] });
        assert.include(
          adopt,
          "note its files: without the editor's MCP server"
        );
        assert.include(adopt, "4. End with a table");
        assert.notInclude(adopt, "handoff");

        assert.include(
          yield* textOf({ _tag: "Redraw", canvas: "" }),
          "Edit the files above directly"
        );
        assert.include(
          yield* textOf({ _tag: "SetupStep", step: "define" }),
          "The user marks\n   the step done in the Setup view."
        );
      })
    );

    it.effect("refuses what works only through the tools, and says so", () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(
          yield* failureOf({ _tag: "SetupStep", step: "map" }),
          {
            command: "design-system",
            message:
              "the Map step works through the editor's MCP server, and the server was started without it",
            next: "Tell the user to start it with MCP on, and stop.",
          }
        );
        const figma = yield* failureOf({ _tag: "Sync", source: "figma" });
        assert.strictEqual(
          figma.message,
          "matching Figma's tokens works through the editor's MCP server, and the server was started without it"
        );
        assert.include(figma.next ?? "", "Sync view");
      })
    );
  });

  layer(ProjectTest({ mcp: false }), { excludeTestServices: true })(
    "with a design system",
    (it) => {
      it.effect("has the user bring the code up to the design", () =>
        Effect.gen(function* () {
          yield* withDesignSystem;
          yield* designChanges;
          const sync = yield* textOf({ _tag: "Sync", source: "code" });
          assert.include(
            sync,
            "Export what waits for the code: write the design's value of each into the stylesheet"
          );
          assert.notInclude(sync, "handoff");
        })
      );
    }
  );
});

describe("slash commands", () => {
  const expand = (text: string) =>
    Effect.flatMap(SlashCommands, (commands) => commands.expand(text));

  layer(ProjectTest({ mcp: true }), { excludeTestServices: true })((it) => {
    it.effect("gives a command's task, with its thread's purpose", () =>
      Effect.gen(function* () {
        const implement = yield* expand("/implement /home");
        assert.strictEqual(implement?.purpose, "implement");
        assert.include(implement?.text ?? "", "Implement the page Home");
        assert.strictEqual(
          (yield* expand("/implement --adopt"))?.purpose,
          "design"
        );
        assert.isNull(yield* expand("make the header blue"));
        assert.isNull(yield* expand("/review the diff"));
      })
    );

    it.effect("tells the user why what they ran cannot be done", () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* expand("/redraw nowhere to wireframes"), {
          purpose: "design",
          text: `<ultrapaint-task command="redraw">
The user ran /redraw, but there is no canvas "nowhere"; the canvases are: Designs (""). Ask which one.
</ultrapaint-task>`,
        });
        // The thread still implements: the user's answer is what it implements.
        assert.strictEqual(
          (yield* expand("/implement /nowhere"))?.purpose,
          "implement"
        );
        assert.include(
          (yield* expand("/design-system tidy"))?.text ?? "",
          "The user ran /design-system, but tidy is not a step of the setup. The steps an agent runs are define, map, migrate."
        );
      })
    );
  });

  layer(ProjectTest({ mcp: true }), { excludeTestServices: true })(
    "with no project open",
    (it) => {
      it.effect("sends what was typed when no task can be prepared", () =>
        Effect.gen(function* () {
          yield* Effect.flatMap(ProjectManager, (project) => project.close);
          assert.deepStrictEqual(yield* expand("/init"), {
            purpose: "design",
            text: "/init",
          });
        })
      );
    }
  );
});
