import path from "node:path";
import { assert, describe, it as test } from "@effect/vitest";
import {
  APP_FROM,
  type AppComponentFile,
} from "@ultrapaint/contracts/components";
import { commandOf, type TaskRequest } from "@ultrapaint/contracts/tasks";
import type { ThreadPurpose } from "@ultrapaint/contracts/threads";
import { DETAILED_ROLES } from "@ultrapaint/contracts/token-presets";
import {
  LOOK_PRESETS,
  lookSystem,
} from "@ultrapaint/design-document/look-dials";
import { makeFixture as makeFigma } from "@ultrapaint/figma-import/testing/fixture";
import { SYSTEM_ROLES } from "@ultrapaint/system-components/default-look";
import { Effect, FileSystem } from "effect";
import { OpenProject, ProjectManager } from "./project.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { DesignSystemSetupService } from "./services/design-system-setup.ts";
import { DocumentService } from "./services/documents.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { ImplementationService } from "./services/implementation.ts";
import { AskUser } from "./services/mcp/ask-user.ts";
import { EditorTools, MCP_INSTRUCTIONS } from "./services/mcp/route.ts";
import { GetScreenshot } from "./services/mcp/screenshot.ts";
import { PagesService } from "./services/pages.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { ProjectBriefing } from "./services/threads/briefing.ts";
import { SlashCommands } from "./services/threads/commands.ts";
import { AgentTasks } from "./services/threads/tasks.ts";
import { writeComponentFile } from "./testing/components.ts";
import { eachTest } from "./testing/each-test.ts";
import {
  callTool,
  heardOf,
  ProjectFixture,
  ProjectTest,
} from "./testing/project.ts";

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
  const project = yield* OpenProject;
  yield* project.use(Effect.flatMap(DesignSystemService, (d) => d.detect));
});

/** A DESIGN.md of the same token, beside the design system. */
const DESIGN_MD = `---
name: Fixture
colors:
  ink: "#111827"
---

## Overview

A fixture.
`;

/** A component the code does not have yet, drawn in the design. */
const PRICING_CARD: AppComponentFile = {
  name: "PricingCard",
  origin: "app",
  properties: [],
  slots: [],
  tree: { children: [], id: "card", type: "group" },
  version: 1,
};

/** The design's value of a token changed, so that it waits for the code. */
const designChanges = Effect.gen(function* () {
  const project = yield* OpenProject;
  yield* project.use(
    Effect.flatMap(DesignSystemService, (d) =>
      d.edit([{ name: "color-ink", op: "setValue", value: "#333333" }])
    )
  );
});

describe("tasks, with the editor's MCP server", () => {
  eachTest(ProjectTest({ mcp: true }))((it) => {
    it.effect(
      "has the stack settled first in a project of designs only, and not where there is code",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const { repo } = yield* ProjectFixture;
          const implementHome = textOf({ _tag: "Implement", target: "/home" });
          assert.notInclude(yield* implementHome, "designs only");
          for (const name of yield* fs.readDirectory(repo)) {
            if (name !== "designs" && !name.startsWith(".")) {
              yield* fs.remove(path.join(repo, name), { recursive: true });
            }
          }
          const text = yield* implementHome;
          assert.include(text, "This project is designs only");
          assert.include(text, "Implement the page Home");
        })
    );
  });

  eachTest(ProjectTest({ mcp: true }))((it) => {
    it.effect("gives each request its task and its thread's purpose", () =>
      Effect.gen(function* () {
        const init = yield* task({ _tag: "Init" });
        assert.strictEqual(init.purpose, "design");
        assert.include(init.text, '<ultrapaint-task command="init">');
        assert.include(init.text, "1. Call scan_design_system.");

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
          assert.strictEqual(
            (yield* failureOf({ _tag: "Implement", target: "component:Nope" }))
              .message,
            "no component is component:Nope; there are no components with a file"
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

  eachTest(ProjectTest({ mcp: true }))(
    "with pages of several canvases",
    (it) => {
      it.effect(
        "names a URL that pages of several canvases serve by its canvas",
        () =>
          Effect.gen(function* () {
            const project = yield* OpenProject;
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

  eachTest(ProjectTest({ mcp: true }))("with a design system", (it) => {
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
  });
});

/**
 * A stylesheet that declares color-panel, a design system read from it, and the design's value
 * of color-panel changed since, so that it waits for the code.
 */
const panelChanges = (stylesheet: string) =>
  Effect.gen(function* () {
    const { reopen, repo } = yield* ProjectFixture;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path.join(repo, "styles"), { recursive: true });
    yield* fs.writeFileString(path.join(repo, "styles/app.css"), stylesheet);
    yield* reopen({ hostCss: ["../../styles/app.css"] });
    const project = yield* OpenProject;
    yield* project.use(
      Effect.gen(function* () {
        const ds = yield* DesignSystemService;
        yield* ds.detect;
        yield* ds.edit([
          { name: "color-panel", op: "setValue", value: "#eeeeee" },
        ]);
      })
    );
  });

/** Define's word on DESIGN.md, in the step that writes it, before the looks' step. */
const DEFINE_DESIGN_MD_RE =
  /5\. Save it with write_design_system[\s\S]*Do's and Don'ts what the code does off the system[\s\S]*6\. /;

describe("/init's roles and looks of the system components (UP-226)", () => {
  /** Import's steps, in /init and in Define when it adopts the theme. */
  const importing = Effect.all([
    textOf({ _tag: "Init" }),
    textOf({ _tag: "SetupStep", mode: "adopt", step: "define" }),
  ]);

  eachTest(ProjectTest({ mcp: true }))((it) => {
    it.effect(
      "has each role the system components draw with mapped to the product's token, as a var() of it",
      () =>
        Effect.gen(function* () {
          for (const text of yield* importing) {
            // Every role, by the system components' own list.
            for (const role of SYSTEM_ROLES) {
              assert.include(text, role.name);
            }
            assert.include(text, "color-primary (the main action)");
            // A role named as the components read it is mapped already.
            assert.include(
              text,
              "(--color-primary, --radius-md) is mapped already"
            );
            assert.include(text, "color-primary: var(--color-brand-ink)");
            assert.include(
              text,
              "what it is for and which of the product's tokens it stands for"
            );
            assert.include(text, "Write no stylesheet");
            assert.notInclude(text, "detailed token");
          }
        })
    );

    it.effect(
      "has the roles the code leaves open asked in one call, a question each, the agent's pick first",
      () =>
        Effect.gen(function* () {
          for (const text of yield* importing) {
            assert.include(
              text,
              "with ask_user, in one call, one question per role"
            );
            assert.include(text, "your pick its first option");
          }
        })
    );

    it.effect(
      "has the looks read from the product's components and set through the tools",
      () =>
        Effect.gen(function* () {
          for (const text of yield* importing) {
            assert.include(text, "its own Button, Input, Select and Badge");
            assert.include(
              text,
              'handoff with action "change", target component:<Name>'
            );
            assert.include(text, '{op:"setStyle"');
            assert.include(text, "get_component");
          }
        })
    );

    it.effect(
      "has the summary name what was left at the default, and why",
      () =>
        Effect.gen(function* () {
          for (const text of yield* importing) {
            assert.include(
              text,
              "which roles and looks you set, and which you left at the default and why"
            );
          }
        })
    );

    it.effect(
      "ends on the seventh step, Define's word on DESIGN.md in the step that writes it",
      () =>
        Effect.gen(function* () {
          const [init, define] = yield* importing;
          assert.include(init, "7. End with a short summary");
          assert.include(define, "7. End by calling finish_setup_step");
          assert.match(define, DEFINE_DESIGN_MD_RE);
        })
    );
  });

  eachTest(ProjectTest({ mcp: true }))((it) => {
    it.effect(
      "keeps the roles and looks set before once imported, and not before",
      () =>
        Effect.gen(function* () {
          for (const text of yield* importing) {
            assert.notInclude(text, "set before");
          }
          yield* withDesignSystem;
          for (const text of yield* importing) {
            assert.include(text, "Keep a role set before");
            assert.include(text, "Keep a look set before");
          }
        })
    );
  });

  eachTest(ProjectTest({ mcp: true }))("with the detailed preset", (it) => {
    it.effect(
      "names the detailed tokens its colour roles are, and asks only about one it lacks",
      () =>
        Effect.gen(function* () {
          const [calm] = LOOK_PRESETS;
          if (!calm) {
            return assert.fail("no look preset");
          }
          const project = yield* OpenProject;
          yield* project.use(
            Effect.flatMap(DesignSystemService, (d) =>
              d.write(lookSystem({ ...calm.dials, tokens: "detailed" }))
            )
          );
          for (const text of yield* importing) {
            assert.include(
              text,
              "each colour role is one of its detailed tokens"
            );
            for (const token of new Set(Object.values(DETAILED_ROLES))) {
              assert.include(text, token);
            }
            assert.notInclude(text, "color-primary (the main action)");
            // The radii are mapped as in any system.
            assert.include(text, "radius-md");
          }
        })
    );
  });

  eachTest(ProjectTest({ mcp: false }))("without the tools", (it) => {
    it.effect(
      "has the looks written in the components' files, their parts listed",
      () =>
        Effect.gen(function* () {
          const [init, define] = yield* importing;
          for (const text of [init, define]) {
            assert.include(
              text,
              "in its file, designs/components/<Name>.component.json"
            );
            assert.include(text, "Button: root, button-spinner");
            assert.include(text, "Input: root, field-label?");
            assert.notInclude(text, "setStyle");
            assert.include(
              text,
              "in your reply, ending your turn for the answers"
            );
          }
        })
    );
  });
});

describe("a token the code declares outside @theme (ADR 0152)", () => {
  eachTest(ProjectTest({ mcp: true }))((it) => {
    it.effect(
      "gives the code's :root value, and says it has no utility class, where the tasks list it",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          const home = path.join(repo, "designs/home.page.json");
          yield* fs.writeFileString(
            home,
            (yield* fs.readFileString(home)).replace(
              '"id": "heading",',
              '"id": "heading",\n          "color": "$color-panel",'
            )
          );
          yield* heardOf("designs/home.page.json");
          yield* panelChanges(":root {\n  --color-panel: #f5f5f5;\n}\n");
          const implement = yield* textOf({
            _tag: "Implement",
            target: "/home",
          });
          assert.include(
            implement,
            "- color-panel: design #eeeeee, code #f5f5f5, declared outside @theme, so it has no utility class (moving it into @theme is the developer's call)"
          );
          assert.include(implement, "never bg-panel");
          assert.include(
            yield* textOf({ _tag: "Sync", source: "code" }),
            "- color-panel: code #f5f5f5, declared outside @theme, so it has no utility class (moving it into @theme is the developer's call), design #eeeeee"
          );
        })
    );

    it.effect(
      "exports a token @theme declares too where the app draws it, and says it found two",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          const css = path.join(repo, "styles/app.css");
          yield* panelChanges(
            "@theme {\n  --color-panel: #ffffff;\n}\n:root {\n  --color-panel: #f5f5f5;\n}\n"
          );
          const { text } = yield* callTool(EditorTools, "handoff", {
            action: "export",
          });
          assert.include(text, "1 token value brought to the code");
          assert.include(
            text,
            "color-panel is declared both in @theme (styles/app.css) and in a plain :root block (styles/app.css)"
          );
          assert.strictEqual(
            yield* fs.readFileString(css),
            "@theme {\n  --color-panel: #ffffff;\n}\n:root {\n  --color-panel: #eeeeee;\n}\n"
          );
        })
    );
  });
});

/**
 * Home, whose heading leads to About, linked to src/home.tsx, which someone changed since; About
 * linked to src/about.tsx, which nobody did; Pricing not linked to its code.
 */
const behindItsCode = Effect.gen(function* () {
  const { repo } = yield* ProjectFixture;
  const fs = yield* FileSystem.FileSystem;
  const home = path.join(repo, "designs/home.page.json");
  yield* fs.writeFileString(
    home,
    (yield* fs.readFileString(home)).replace(
      '"id": "heading",',
      '"id": "heading",\n          "link": "about.page.json",'
    )
  );
  yield* heardOf("designs/home.page.json");
  const project = yield* OpenProject;
  yield* project.use(
    Effect.gen(function* () {
      const pages = yield* PagesService;
      yield* pages.create("", { name: "About", route: "/about" });
      yield* pages.create("", { name: "Pricing", route: "/pricing" });
      const implementation = yield* ImplementationService;
      yield* implementation.mark("home.page.json", ["src/home.tsx"]);
      yield* implementation.mark("about.page.json", ["src/about.tsx"]);
    })
  );
  yield* fs.writeFileString(
    path.join(repo, "src/home.tsx"),
    "export const Home = () => <h1>Hi</h1>;\n"
  );
});

const CODE = {
  "src/about.tsx": "export const About = () => null;\n",
  "src/home.tsx": "export const Home = () => null;\n",
};

describe("bringing pages up to date from their code (ADR 0115)", () => {
  eachTest(ProjectTest({ files: CODE, mcp: true }))((it) => {
    it.effect(
      "gives a linked page whose code changed its changed files, the design as implemented, and the mark",
      () =>
        Effect.gen(function* () {
          yield* behindItsCode;
          const update = yield* task({
            _tag: "UpdateFromCode",
            targets: ["home.page.json"],
          });
          // It writes the designs only.
          assert.strictEqual(update.purpose, "design");
          assert.include(
            update.text,
            '<ultrapaint-task command="update-from-code">'
          );
          assert.include(update.text, "- home.page.json: Home, /home");
          assert.include(
            update.text,
            "in src/home.tsx. These files changed since: src/home.tsx."
          );
          assert.include(
            update.text,
            "designs/_implemented/home.implemented.json"
          );
          // It reads what changed first, and keeps what still holds.
          assert.include(update.text, "starting with the files that changed");
          assert.include(update.text, "in place");
          assert.include(
            update.text,
            "its states, its links to other pages and its behaviour notes"
          );
          // What it keeps, and the widths it looks at the screen at.
          assert.include(
            update.text,
            "Its links: Hello (heading) → about.page.json."
          );
          assert.include(update.text, "It is drawn at 1440 px wide.");
          // The running screen where it can see it, the code alone where it cannot.
          assert.include(update.text, "a view at a width");
          assert.include(update.text, "a browser");
          assert.include(update.text, "could not see the running screen");
          // What no code draws stays as it is.
          assert.include(update.text, "leave it as it is");
          assert.include(update.text, "history");
          assert.include(
            update.text,
            `mark it implemented: handoff with action "mark", target the page's id`
          );
          assert.notInclude(update.text, "Pricing");
          assert.notInclude(update.text, "About");
        })
    );

    it.effect(
      "has the agent reconcile the design's changes with the code's, asking where it can't tell, when the design changed too",
      () =>
        Effect.gen(function* () {
          yield* behindItsCode;
          const before = yield* textOf({
            _tag: "UpdateFromCode",
            targets: ["home.page.json"],
          });
          assert.notInclude(before, "never take one side whole");
          // The page's heading changed in the design, past the editor.
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          const file = path.join(repo, "designs/home.page.json");
          yield* fs.writeFileString(
            file,
            (yield* fs.readFileString(file)).replace("Hello", "Welcome")
          );
          yield* heardOf("designs/home.page.json");
          const after = yield* textOf({
            _tag: "UpdateFromCode",
            targets: ["home.page.json"],
          });
          assert.include(
            after,
            "The design changed since it was implemented too"
          );
          assert.include(after, "never take one side whole");
          assert.include(after, "Where you cannot tell, ask the user");
          assert.include(after, "put back the design's changes you kept");
        })
    );

    it.effect("has an unlinked page's files found first", () =>
      Effect.gen(function* () {
        yield* behindItsCode;
        const text = yield* textOf({
          _tag: "UpdateFromCode",
          targets: ["pricing.page.json"],
        });
        assert.include(text, "- pricing.page.json: Pricing, /pricing");
        assert.include(text, "It is not linked to its code yet.");
        assert.include(
          text,
          "1. For each page not linked yet, find the code that draws it"
        );
      })
    );

    it.effect(
      "covers a canvas's pages whose code changed or that are not linked, and skips those implemented",
      () =>
        Effect.gen(function* () {
          yield* behindItsCode;
          const text = yield* textOf({ _tag: "UpdateFromCode", targets: [""] });
          assert.include(text, "- home.page.json: Home, /home");
          assert.include(text, "- pricing.page.json: Pricing, /pricing");
          assert.notInclude(text, "- about.page.json");
        })
    );

    it.effect(
      "lists a state's page on its own when it is behind its code too, its base naming it",
      () =>
        Effect.gen(function* () {
          yield* behindItsCode;
          const project = yield* OpenProject;
          yield* project.use(
            Effect.flatMap(PagesService, (pages) =>
              pages.createState("home.page.json", "Empty")
            )
          );
          const text = yield* textOf({ _tag: "UpdateFromCode", targets: [""] });
          assert.include(
            text,
            "Its states, drawn as pages of their own and listed here on their own where they are behind too: empty (home@empty.page.json)."
          );
          // The state's page is not linked yet, so it is behind too, and listed as itself.
          assert.include(text, "- home@empty.page.json");
        })
    );

    it.effect(
      "takes a named base page's states that are behind their code with it",
      () =>
        Effect.gen(function* () {
          yield* behindItsCode;
          const project = yield* OpenProject;
          yield* project.use(
            Effect.flatMap(PagesService, (pages) =>
              pages.createState("home.page.json", "Empty")
            )
          );
          const text = yield* textOf({
            _tag: "UpdateFromCode",
            targets: ["home.page.json"],
          });
          assert.include(text, "- home@empty.page.json");
        })
    );

    it.effect(
      "names no sibling states for a state's page named on its own",
      () =>
        Effect.gen(function* () {
          yield* behindItsCode;
          const project = yield* OpenProject;
          yield* project.use(
            Effect.flatMap(PagesService, (pages) =>
              Effect.andThen(
                pages.createState("home.page.json", "Empty"),
                pages.createState("home.page.json", "Loading")
              )
            )
          );
          const text = yield* textOf({
            _tag: "UpdateFromCode",
            targets: ["home@empty.page.json"],
          });
          assert.include(text, "- home@empty.page.json");
          assert.notInclude(text, "home@loading.page.json");
        })
    );

    it.effect(
      "takes, named by nothing, the pages whose code changed and none not linked yet",
      () =>
        Effect.gen(function* () {
          yield* behindItsCode;
          const text = yield* textOf({ _tag: "UpdateFromCode", targets: [] });
          assert.include(text, "- home.page.json");
          assert.notInclude(text, "- pricing.page.json");
          assert.notInclude(text, "- about.page.json");
        })
    );

    it.effect(
      "refuses, named by nothing, when no linked page's code changed, saying how to take one not linked yet",
      () =>
        Effect.gen(function* () {
          assert.deepStrictEqual(
            yield* failureOf({ _tag: "UpdateFromCode", targets: [] }),
            {
              command: "update-from-code",
              message:
                "every page and component linked to its code is up to date with it; a page not linked yet is taken only when it or its canvas is named",
              next: "Say so, and stop.",
            }
          );
        })
    );

    it.effect("refuses when every page named is up to date with its code", () =>
      Effect.gen(function* () {
        yield* behindItsCode;
        assert.deepStrictEqual(
          yield* failureOf({
            _tag: "UpdateFromCode",
            targets: ["about.page.json", "nowhere"],
          }),
          {
            command: "update-from-code",
            message:
              "there is no canvas or page nowhere, and every page named is up to date with its code",
            next: "Say so, and stop.",
          }
        );
      })
    );
  });

  eachTest(ProjectTest({ files: CODE, mcp: false }))((it) => {
    it.effect(
      "says how to link a page by hand without the editor's tools",
      () =>
        Effect.gen(function* () {
          yield* behindItsCode;
          const text = yield* textOf({
            _tag: "UpdateFromCode",
            targets: ["home.page.json"],
          });
          assert.include(
            text,
            "note its files: without the editor's MCP server"
          );
          assert.include(text, "Edit the files above directly");
        })
    );
  });
});

/** An app component with a choice, placed on Home and drawn by src/plan.tsx. */
const PLAN: AppComponentFile = {
  name: "Plan",
  origin: "app",
  properties: [
    {
      default: "plain",
      kind: "choice",
      members: ["plain", "loud"],
      name: "tone",
    },
  ],
  slots: [],
  tree: {
    children: [{ id: "t", role: "heading", text: "Pro", type: "text" }],
    id: "root",
    type: "column",
  },
  version: 1,
};

/** Plan placed on Home and implemented by src/plan.tsx, whose code changed since. */
const componentBehind = Effect.gen(function* () {
  const { repo } = yield* ProjectFixture;
  const fs = yield* FileSystem.FileSystem;
  yield* writeComponentFile(path.join(repo, "designs"), PLAN);
  yield* heardOf("designs/components/Plan.component.json");
  const project = yield* OpenProject;
  yield* project.use(
    Effect.gen(function* () {
      yield* (yield* DocumentService).apply({
        edits: [
          {
            doc: "home.page.json",
            ops: [
              {
                node: {
                  component: "Plan",
                  from: APP_FROM,
                  id: "plan",
                  props: { tone: "loud" },
                  type: "instance",
                },
                op: "insert",
                parent: null,
              },
            ],
          },
        ],
      });
      yield* (yield* ImplementationService).mark("component:Plan", [
        "src/plan.tsx",
      ]);
    })
  );
  yield* fs.writeFileString(
    path.join(repo, "src/plan.tsx"),
    "export const Plan = () => <section />;\n"
  );
});

const COMPONENT_CODE = {
  ...CODE,
  "src/plan.tsx": "export const Plan = () => null;\n",
};

describe("bringing components up to date from their code (ADR 0122)", () => {
  eachTest(ProjectTest({ files: COMPONENT_CODE, mcp: true }))((it) => {
    it.effect(
      "gives a component whose code changed its changed files, the component as implemented, the pages placing it, and the mark",
      () =>
        Effect.gen(function* () {
          yield* componentBehind;
          const update = yield* task({
            _tag: "UpdateFromCode",
            targets: ["component:Plan"],
          });
          assert.strictEqual(update.purpose, "design");
          assert.include(
            update.text,
            "- component:Plan: Plan, an app component (designs/components/Plan.component.json)"
          );
          assert.include(
            update.text,
            "in src/plan.tsx. These files changed since: src/plan.tsx."
          );
          assert.include(
            update.text,
            "designs/_implemented/components/Plan.implemented.json"
          );
          // Every page that places it follows through its instances, and is named at the end.
          assert.include(
            update.text,
            "The pages that place it, which follow it through their instances: home.page.json."
          );
          assert.include(
            update.text,
            "the files that draw it and the pages that place it, which now draw it as it is"
          );
          // Where the agent can see the app, it looks at the component on a screen that uses it.
          assert.include(update.text, "the component on a screen that uses it");
          // Its props, members and slots change so every instance follows a rename.
          assert.include(
            update.text,
            'handoff with action "change", target the component as listed'
          );
          assert.include(update.text, '{op:"renameProperty", name, to}');
          assert.include(
            update.text,
            "version from before stays in the designs' history, where the user can restore it"
          );
          assert.include(
            update.text,
            'mark it implemented: handoff with action "mark", target the component as listed'
          );
          // A component alone: nothing of a page's update.
          assert.notInclude(update.text, "The pages, by id");
          assert.notInclude(update.text, "- home.page.json: Home");
        })
    );

    it.effect(
      "has the agent reconcile the component's own changes with the code's when its design changed too",
      () =>
        Effect.gen(function* () {
          yield* componentBehind;
          const { repo } = yield* ProjectFixture;
          yield* writeComponentFile(path.join(repo, "designs"), {
            ...PLAN,
            tree: {
              children: [
                { id: "t", role: "heading", text: "Max", type: "text" },
              ],
              id: "root",
              type: "column",
            },
          });
          yield* heardOf("designs/components/Plan.component.json");
          const text = yield* textOf({
            _tag: "UpdateFromCode",
            targets: ["component:Plan"],
          });
          assert.include(
            text,
            "The design changed since it was implemented too"
          );
          assert.include(text, "never take one side whole");
          assert.include(text, "Where you cannot tell, ask the user");
          assert.include(text, "put back the design's changes you kept");
        })
    );

    it.effect(
      "takes, named by nothing, the components whose code changed along with the pages",
      () =>
        Effect.gen(function* () {
          yield* behindItsCode;
          yield* componentBehind;
          const text = yield* textOf({ _tag: "UpdateFromCode", targets: [] });
          assert.include(text, "- home.page.json: Home, /home");
          assert.include(text, "- component:Plan: Plan");
        })
    );

    it.effect("takes a component and a page named together", () =>
      Effect.gen(function* () {
        yield* behindItsCode;
        yield* componentBehind;
        const text = yield* textOf({
          _tag: "UpdateFromCode",
          targets: ["component:Plan", "home.page.json"],
        });
        assert.include(text, "- home.page.json: Home, /home");
        assert.include(text, "- component:Plan: Plan");
        assert.include(text, "These pages and components of the design");
      })
    );

    it.effect(
      "points a named page up to date with its code to its changed components' own update when another page is taken",
      () =>
        Effect.gen(function* () {
          yield* componentBehind;
          const project = yield* OpenProject;
          yield* project.use(
            Effect.gen(function* () {
              yield* (yield* ImplementationService).mark("home.page.json", [
                "src/home.tsx",
              ]);
              yield* (yield* PagesService).create("", {
                name: "Pricing",
                route: "/pricing",
              });
            })
          );
          const text = yield* textOf({
            _tag: "UpdateFromCode",
            targets: ["home.page.json", "pricing.page.json"],
          });
          assert.include(text, "- pricing.page.json");
          assert.notInclude(text, "- home.page.json");
          assert.include(text, "/update-from-code component:Plan");
        })
    );

    it.effect(
      "points a page up to date with its code, whose components' code changed, to their own update",
      () =>
        Effect.gen(function* () {
          yield* componentBehind;
          const project = yield* OpenProject;
          yield* project.use(
            Effect.flatMap(ImplementationService, (i) =>
              i.mark("home.page.json", ["src/home.tsx"])
            )
          );
          assert.deepStrictEqual(
            yield* failureOf({
              _tag: "UpdateFromCode",
              targets: ["home.page.json"],
            }),
            {
              command: "update-from-code",
              message:
                "every page named is up to date with its code; the components it places whose code changed are brought up to date on their own, through their instances: /update-from-code component:Plan",
              next: "Say so, and stop.",
            }
          );
        })
    );

    it.effect(
      "leaves out a component up to date with its code, or not implemented",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          yield* writeComponentFile(path.join(repo, "designs"), PLAN);
          yield* heardOf("designs/components/Plan.component.json");
          assert.deepStrictEqual(
            yield* failureOf({
              _tag: "UpdateFromCode",
              targets: ["component:Plan", "component:Nope"],
            }),
            {
              command: "update-from-code",
              message:
                "there is no component Nope, and every component named is up to date with its code or was never implemented",
              next: "Say so, and stop.",
            }
          );
        })
    );

    it.effect("reads Implemented once handoff marks it", () =>
      Effect.gen(function* () {
        yield* componentBehind;
        const changed = yield* Effect.flatMap(OpenProject, (p) =>
          p.use(
            Effect.flatMap(ImplementationService, (i) =>
              i.item("component:Plan")
            )
          )
        );
        assert.isTrue(changed.codeChanged);
        const { text } = yield* callTool(EditorTools, "handoff", {
          action: "mark",
          files: ["src/plan.tsx"],
          target: "component:Plan",
        });
        assert.include(
          text,
          "- component:Plan (Plan): implemented → src/plan.tsx"
        );
        const marked = yield* Effect.flatMap(OpenProject, (p) =>
          p.use(
            Effect.flatMap(ImplementationService, (i) =>
              i.item("component:Plan")
            )
          )
        );
        assert.strictEqual(marked.status, "implemented");
        assert.isFalse(marked.codeChanged);
      })
    );
  });

  eachTest(ProjectTest({ files: COMPONENT_CODE, mcp: false }))((it) => {
    it.effect(
      "has a rename followed into every instance by hand without the editor's tools",
      () =>
        Effect.gen(function* () {
          yield* componentBehind;
          const text = yield* textOf({
            _tag: "UpdateFromCode",
            targets: ["component:Plan"],
          });
          assert.include(
            text,
            "on the pages that place it and in the\n   trees of app components that place it"
          );
        })
    );
  });
});

describe("tasks, without the editor's MCP server", () => {
  eachTest(ProjectTest({ mcp: false }))((it) => {
    it.effect("says how to do each thing by hand", () =>
      Effect.gen(function* () {
        const init = yield* textOf({ _tag: "Init" });
        assert.include(
          init,
          "1. Read the stylesheets the code's tokens are in"
        );
        assert.include(init, "valid against this JSON Schema");

        const implement = yield* task({ _tag: "Implement", target: "/home" });
        assert.strictEqual(implement.purpose, "implement");
        assert.include(
          implement.text,
          "Once it is done, tell the user which files implement it, so they can mark it implemented in the editor."
        );

        const adopt = yield* textOf({ _tag: "Adopt", targets: [] });
        assert.include(
          adopt,
          "note its files: without the editor's MCP server"
        );
        assert.include(adopt, "4. End with a table");

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

  eachTest(ProjectTest({ mcp: false }))("with a design system", (it) => {
    it.effect("has the user bring the code up to the design", () =>
      Effect.gen(function* () {
        yield* withDesignSystem;
        yield* designChanges;
        const sync = yield* textOf({ _tag: "Sync", source: "code" });
        assert.include(
          sync,
          "Export what waits for the code: write the design's value of each into the stylesheet"
        );
      })
    );
  });
});

const WHITESPACE_RE = /\s+/g;
/** Where a clause ends: a stop, a semicolon, a colon or a comma before a space, a bracket or a dash. */
const CLAUSE_END_RE = /[.;:,](?:\s|$)|[()]|\s—\s/;
/** A verb that writes a file. */
const WRITE_VERB_RE =
  /\b(?:write|writes|wrote|written|writing|rewrite|rewrites|rewriting|edit|edits|editing|modify|modifying|update|updating|save|saving)\b/i;
/** A design file, by its kind or as the texts call one, or the way it is written around the tools. */
const DESIGN_FILE_RE =
  /\.(?:page|component|variations)\.json|canvas\.json|\bthe JSON\b|\b(?:a|its|the|each|component's) file\b|\bby hand\b|\bwith a script\b/i;
/** A change made in a file: "change a look in its file". */
const IN_FILE_RE = /\b(?:in|into) (?:its|the|a|each)(?: \S+)? file\b/i;
/** A clause that says never, rather than telling to. */
const NEGATED_RE = /\b(?:never|not|rather than|don't)\b/i;
/** The rule an agent with the tools reads, naming the three kinds of design file (UP-232). */
const NEVER_WRITE_RE =
  /never write a \*\.page\.json, \*\.component\.json or\s+canvas\.json\s+yourself/i;
const SAY_SO_RE =
  /no\s+tool can do what was asked, say so in your reply, naming what, and leave the files as they are/;
const READ_ONE_RE = /read one when a tool's answer is\s+not enough/;
/**
 * A state's page by its file, `orders@empty.page.json` or `<name>@<state>.page.json`: only the
 * editor's New state makes one (ADR 0030), and one an agent writes is a variation the tools
 * refuse (ADR 0098), so no text an agent reads names one (UP-233).
 */
const STATE_FILE_RE = /[^\s`'"(]*@[^\s.`'"]+\.page\.json/g;
/** What the design briefing says a state is: a page of its own beside its screen, named for it. */
const STATE_PAGE_RE =
  /an empty, loading or error state is a page of its own\s+beside the loaded one,\s+named for its state\s+\(Orders, empty\)/i;

/**
 * The clauses of a text that tell an agent to write a design file or to change one in its file,
 * but for those that say never, not or rather than: what an agent with the tools must read none
 * of (UP-232).
 */
const writesDesignFiles = (text: string) =>
  text
    .replaceAll(WHITESPACE_RE, " ")
    .split(CLAUSE_END_RE)
    .filter(
      (clause) =>
        !NEGATED_RE.test(clause) &&
        (IN_FILE_RE.test(clause) ||
          (WRITE_VERB_RE.test(clause) && DESIGN_FILE_RE.test(clause)))
    );

describe("the editor's tools in what an agent is told", () => {
  /** Requests of every kind: one left out does not compile. */
  const requests: {
    readonly [T in TaskRequest["_tag"]]: readonly Extract<
      TaskRequest,
      { _tag: T }
    >[];
  } = {
    Adopt: [{ _tag: "Adopt", targets: [] }],
    Implement: [
      { _tag: "Implement", target: "/home" },
      { _tag: "Implement", target: "component:PricingCard" },
    ],
    ImportFigma: [{ _tag: "ImportFigma" }],
    Init: [{ _tag: "Init" }],
    Redraw: [{ _tag: "Redraw", canvas: "" }],
    Setup: [{ _tag: "Setup" }],
    SetupStep: [
      { _tag: "SetupStep", mode: "adopt", step: "define" },
      { _tag: "SetupStep", mode: "propose", step: "define" },
      { _tag: "SetupStep", step: "inventory" },
      { _tag: "SetupStep", step: "map" },
      { _tag: "SetupStep", step: "migrate" },
    ],
    Sync: [
      { _tag: "Sync" },
      { _tag: "Sync", source: "describe" },
      { _tag: "Sync", source: "figma" },
      { _tag: "Sync", source: "design" },
      { _tag: "Sync", source: "code" },
    ],
    // The root canvas named: its pages are not linked yet, which a bare update leaves out.
    UpdateFromCode: [{ _tag: "UpdateFromCode", targets: [""] }],
    Variations: [
      { _tag: "Variations", count: 2, target: "home.page.json#heading" },
    ],
  };

  /** The tools the editor's MCP server offers, by the names their definitions give them. */
  const offered = new Set<string>([
    ...Object.keys(EditorTools.tools),
    AskUser.name,
    GetScreenshot.name,
  ]);

  /**
   * The tools a text names: every word written the way the tools are named (`ask_user`), and
   * `handoff`. `focus` is a tool and a state of a component's look too, so it is not counted.
   */
  const toolsNamed = (text: string) => [
    ...new Set([
      ...(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []),
      ...(text.match(/\bhandoff\b/g) ?? []),
    ]),
  ];

  interface Read {
    /** The request, or the briefing. */
    readonly of: string;
    /** Whether it is a task, rather than why the request is none. */
    readonly task: boolean;
    readonly text: string;
  }

  /** What an agent reads of every request, and of the briefing for each purpose. */
  const everything = Effect.gen(function* () {
    const tasks = yield* AgentTasks;
    const read: Read[] = [];
    for (const request of Object.values(requests).flat()) {
      read.push(
        // In a chat, where a round of variations belongs.
        yield* tasks.task(request, { thread: "thread_told" }).pipe(
          Effect.map(({ text }) => ({ task: true, text })),
          Effect.catchTag("TaskFailure", (f) =>
            Effect.succeed({ task: false, text: `${f.message}. ${f.next}` })
          ),
          Effect.map((r) => ({ of: commandOf(request), ...r }))
        )
      );
    }
    const briefing = yield* ProjectBriefing;
    for (const purpose of ["design", "implement"] as const) {
      const text = (yield* briefing.text(purpose)) ?? "";
      read.push({ of: `the ${purpose} briefing`, task: true, text });
    }
    return read;
  });

  /** A Figma file of one frame. */
  const figmaFile = () => {
    const f = makeFigma();
    f.add(f.page, { name: "Login", size: { x: 400, y: 600 }, type: "FRAME" });
    return f.build();
  };

  /**
   * Everything a task tells of: a design system read from the code with DESIGN.md beside it, a
   * token changed on each side, a Figma file, an app component, and Map under way. Answers the
   * Figma import's id, which a task names and which is no tool's name however it is made.
   */
  const everythingThere = Effect.gen(function* () {
    yield* withDesignSystem;
    const { repo } = yield* ProjectFixture;
    const fs = yield* FileSystem.FileSystem;
    yield* designChanges;
    yield* fs.writeFileString(
      path.join(repo, "styles/app.css"),
      THEME.replace("#111827", "#222222")
    );
    yield* fs.writeFileString(path.join(repo, "DESIGN.md"), DESIGN_MD);
    const imported = yield* Effect.flatMap(OpenProject, (opened) =>
      opened.use(
        Effect.gen(function* () {
          yield* (yield* DesignSystemService).refresh;
          const figma = yield* (yield* FigmaImportService).create(
            "login.fig",
            figmaFile()
          );
          return { designsDir: (yield* RepoPaths).designsDir, id: figma.id };
        })
      )
    );
    yield* writeComponentFile(imported.designsDir, PRICING_CARD);
    const setup = yield* DesignSystemSetupService;
    yield* setup.start("inventory", {});
    yield* setup.complete("inventory");
    yield* setup.start("define", { threadId: "define" });
    yield* setup.complete("define");
    yield* setup.start("map", { threadId: "map" });
    return imported.id;
  });

  /** What the server refuses, by request, once everything is there. */
  const refused = (read: readonly Read[]) =>
    read.filter((r) => !r.task).map((r) => r.of);

  /** A project on either server, its briefing with the design skill. */
  const project = (mcp: boolean) => ProjectTest({ git: true, mcp });

  /** What the briefing says of the design skill's terms, by a line with the tools and without. */
  const skillLines = {
    // A decision for the designer goes on a card, never into the closing message (ADR 0151).
    asking: [
      "A decision you leave for the user goes to ask_user before your turn ends",
      "A decision you leave for the user goes to your own question tool before your turn ends",
    ],
    components: [
      "A component's documentation is get_component: its props, variants and example",
      "A component's documentation is its line among the components listed below: its props and variants.",
    ],
    tokens: [
      "The design system's store is read_design_system: DESIGN.md and the tokens, each value in every theme",
      "every token's value in every theme is in designs/design.tokens.json",
    ],
  } as const;

  /**
   * What the editor no longer has or never was, said anywhere an agent reads: the rail has no
   * Pages panel, the stylesheets are where the code's tokens are (Sync's, not the preview's), and
   * a system component has no code in the repository.
   */
  const stale = (read: readonly Read[]) =>
    read.flatMap((r) =>
      ["Pages panel", "the preview imports", "read its code"]
        .filter((phrase) => r.text.includes(phrase))
        .map((phrase) => `${r.of} says ${phrase}`)
    );

  /** The briefing for one purpose. */
  const briefingOf = (read: readonly Read[], purpose: ThreadPurpose) =>
    read.find((r) => r.of === `the ${purpose} briefing`)?.text ?? "";

  /** Every state's file a text names, by what names it (UP-233). */
  const stateFilesIn = (read: readonly Pick<Read, "of" | "text">[]) =>
    read.flatMap((r) =>
      (r.text.match(STATE_FILE_RE) ?? []).map((f) => `${r.of}: ${f}`)
    );

  /** The briefings' text, where the design skills are told. */
  const briefings = (read: readonly Read[]) =>
    read
      .filter((r) => r.of.endsWith("briefing"))
      .map((r) => r.text)
      .join("\n");

  eachTest(project(true))((it) => {
    it.effect("names only the tools the server offers, by their names", () =>
      Effect.gen(function* () {
        const before = yield* everything;
        const imported = yield* everythingThere;
        const after = yield* everything;
        assert.deepStrictEqual(refused(after), ["/design-system inventory"]);
        // What an agent outside the editor is told when it connects.
        const instructions = {
          of: "the MCP server's instructions",
          task: true,
          text: MCP_INSTRUCTIONS,
        };
        // An id the server made (`fig_mvtovaeg_jzlna`) reads as a tool's name when it has no digit.
        const named = [...before, ...after, instructions].flatMap((r) =>
          toolsNamed(r.text.replaceAll(imported, "")).map((tool) => ({
            of: r.of,
            tool,
          }))
        );
        assert.deepStrictEqual(
          named
            .filter(({ tool }) => !offered.has(tool))
            .map(({ of, tool }) => `${of} names ${tool}`),
          []
        );
        assert.includeMembers(
          named.map(({ tool }) => tool),
          [
            "ask_user",
            "handoff",
            "map_values",
            "next_batch",
            "write_figma_frame",
          ]
        );
        assert.deepStrictEqual(stale([...before, ...after, instructions]), []);
        // What the design skill's words are in the editor, with its tools.
        for (const [withTools] of Object.values(skillLines)) {
          assert.include(briefings(after), withTools);
        }
      })
    );

    it.effect(
      "tells an agent to write no design file, in any task, briefing or the MCP server's instructions (UP-232)",
      () =>
        Effect.gen(function* () {
          const before = yield* everything;
          yield* everythingThere;
          const after = yield* everything;
          const instructions = {
            of: "the MCP server's instructions",
            text: MCP_INSTRUCTIONS,
          };
          assert.deepStrictEqual(
            [...before, ...after, instructions].flatMap((r) =>
              writesDesignFiles(r.text).map((s) => `${r.of}: ${s}`)
            ),
            []
          );
          // What agents with the tools were told before, each caught.
          for (const told of [
            "change designs with its tools, rather than by editing the JSON (a file you write must stay valid).",
            "A component's file in components/ is written as a file.",
            "An app component's tree is written in its file.",
            "Change a look in its file, not on each instance.",
            "in the same undo step; written into the file by hand, it would leave them behind.",
            "Update the Button.component.json to match.",
            "Fix it by rewriting canvas.json with a script.",
          ]) {
            assert.isNotEmpty(writesDesignFiles(told), told);
          }
        })
    );

    it.effect(
      "names no state's file in any task, briefing or the MCP server's instructions (UP-233)",
      () =>
        Effect.gen(function* () {
          const before = yield* everything;
          yield* everythingThere;
          const after = yield* everything;
          const instructions = {
            of: "the MCP server's instructions",
            text: MCP_INSTRUCTIONS,
          };
          assert.deepStrictEqual(
            stateFilesIn([...before, ...after, instructions]),
            []
          );
          // What agents were told before, each caught.
          for (const told of [
            "a page of its own, orders@empty.page.json",
            "orders@empty.page.json is the orders page in its empty state",
          ]) {
            assert.isNotNull(told.match(STATE_FILE_RE), told);
          }
        })
    );

    it.effect(
      "tells an agent to draw a state as a page of its own, made with duplicate_page and rename_page (UP-233)",
      () =>
        Effect.gen(function* () {
          const design = briefingOf(yield* everything, "design");
          assert.match(design, STATE_PAGE_RE);
          for (const text of [design, MCP_INSTRUCTIONS]) {
            assert.include(text, "duplicate_page copies the page beside it");
            assert.include(text, "rename_page names it for its state");
          }
        })
    );
  });

  eachTest(project(false))((it) => {
    it.effect("names no tool when the server offers none", () =>
      Effect.gen(function* () {
        const before = yield* everything;
        const imported = yield* everythingThere;
        const after = yield* everything;
        // What only the tools can do is refused, and said so.
        assert.deepStrictEqual(refused(after), [
          "/import-figma",
          "/setup",
          "/design-system inventory",
          "/design-system map",
          "/design-system migrate",
          "/sync figma",
          "/sync design",
          "/variations home.page.json#heading 2",
        ]);
        assert.deepStrictEqual(
          [...before, ...after].flatMap((r) =>
            toolsNamed(r.text.replaceAll(imported, "")).map(
              (tool) => `${r.of} names ${tool}`
            )
          ),
          []
        );
        assert.deepStrictEqual(stale([...before, ...after]), []);
        for (const [, withoutTools] of Object.values(skillLines)) {
          assert.include(briefings(after), withoutTools);
        }
      })
    );

    it.effect(
      "tells an agent without the tools to write the design files (UP-232)",
      () =>
        Effect.gen(function* () {
          yield* everythingThere;
          const read = yield* everything;
          // The briefings tell it to edit the page files directly, and keep them valid.
          assert.include(
            briefings(read),
            "Edit the .page.json files directly and keep them valid"
          );
          assert.isNotEmpty(writesDesignFiles(briefings(read)));
          assert.notInclude(briefings(read), "never write a *.page.json");
        })
    );

    it.effect(
      "names no state's file to an agent without the tools (UP-233)",
      () =>
        Effect.gen(function* () {
          const before = yield* everything;
          yield* everythingThere;
          const after = yield* everything;
          assert.deepStrictEqual(stateFilesIn([...before, ...after]), []);
        })
    );

    it.effect(
      "tells an agent without the tools to draw a state as a page file of its own (UP-233)",
      () =>
        Effect.gen(function* () {
          const design = briefingOf(yield* everything, "design");
          assert.match(design, STATE_PAGE_RE);
          assert.include(design, "orders-empty.page.json in its folder");
        })
    );
  });
});

/** The design skill's line in a briefing that tells summaries: where its core is read. */
const DESIGN_SKILL_LINE_RE = /^- Ultrapaint \(([^)]+)\): \S/m;

describe("the briefing", () => {
  test.effect(
    "tells a design thread how to change a system component's look, with the tools or in its file (UP-227)",
    () =>
      Effect.gen(function* () {
        const briefing = yield* ProjectBriefing;
        const tools = (yield* briefing.text("design")) ?? "";
        assert.include(
          tools,
          'handoff with action "change", target component:<Name>'
        );
        for (const op of ["setStyle", "setHidden", "setContent", "setItem"]) {
          assert.include(tools, `{op:"${op}"`);
        }
        // The ops of an app component's settings are a task's, not the briefing's.
        assert.notInclude(tools, "renameProperty");
        assert.include(tools, "starts its file from the default look");
        // The parts are get_component's to answer: not listed for an agent that can ask.
        assert.notInclude(tools, "Card: root, card-header");

        const untooled =
          (yield* briefing.text("design", { tools: false })) ?? "";
        assert.notInclude(untooled, "setStyle");
        assert.include(
          untooled,
          'origin "system": the look of a system component'
        );
        assert.include(
          untooled,
          "Card: root, card-header, card-title?, card-description?, card-content, card-footer"
        );
        assert.include(
          untooled,
          "Button: root, button-spinner; states hover, focus, active, disabled, open"
        );
      }).pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

  test.effect(
    "tells an agent to change an app component's tree with the tools, only when asked for every instance, and in its file without them (UP-230)",
    () =>
      Effect.gen(function* () {
        const briefing = yield* ProjectBriefing;
        const tools = (yield* briefing.text("design")) ?? "";
        assert.include(tools, "route component:<Name> (a node of it");
        assert.include(
          tools,
          "change it only when the user asked for the change everywhere, else the layers of the\ninstance they mean"
        );
        assert.include(tools, "build it on a page that uses it");
        assert.include(tools, '{op:"makeComponent", ids, name}');
        // An agent outside the editor reads the same, when it connects.
        assert.include(MCP_INSTRUCTIONS, "route component:<Name>");
        assert.include(MCP_INSTRUCTIONS, "makeComponent");
        for (const text of [tools, MCP_INSTRUCTIONS]) {
          assert.notInclude(text, "is written in its file");
          assert.notInclude(text, "is\nwritten as a file");
        }

        // Without the tools, the tree is written in its file, in the format it is told.
        const untooled =
          (yield* briefing.text("design", { tools: false })) ?? "";
        assert.include(untooled, `origin "app": the project's own component`);
        assert.notInclude(untooled, "component:<Name> (a node of it");
        assert.notInclude(untooled, "makeComponent");
      }).pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

  test.effect(
    "tells an agent with the tools, in the briefing and the MCP server's instructions, to change designs only through them and say what none can do (UP-232)",
    () =>
      Effect.gen(function* () {
        const briefing = yield* ProjectBriefing;
        const design = (yield* briefing.text("design")) ?? "";
        const implement = (yield* briefing.text("implement")) ?? "";
        for (const text of [design, implement, MCP_INSTRUCTIONS]) {
          // The rule, naming the three kinds of design file, even to fix one.
          assert.match(text, NEVER_WRITE_RE);
          assert.include(text, "not even to fix one");
          // Reading one stays allowed.
          assert.match(text, READ_ONE_RE);
          // A gap is said, not scripted.
          assert.match(text, SAY_SO_RE);
          // How to do what agents scripted: frames, a tree, a look.
          assert.include(text, "set_frame");
          assert.include(text, "apply_operations");
          assert.include(text, 'handoff with action "change"');
        }
      }).pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

  test.effect(
    "points a design thread asked for more takes at the round the user starts, with Make more… (UP-232)",
    () =>
      Effect.gen(function* () {
        const briefing = yield* ProjectBriefing;
        const design = (yield* briefing.text("design")) ?? "";
        assert.include(design, "Make more… in the ⋯ of its Variations section");
        assert.include(design, "Make variations… in its right-click menu");
        assert.include(design, "only the user starts");
        // A thread that implements is asked for no takes; one without the tools makes no round.
        assert.notInclude(
          (yield* briefing.text("implement")) ?? "",
          "Make more…"
        );
        assert.notInclude(
          (yield* briefing.text("design", { tools: false })) ?? "",
          "Make more…"
        );
      }).pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

  test.effect(
    "tells the design skills to a thread that draws designs, and to no other",
    () =>
      Effect.gen(function* () {
        const briefing = yield* ProjectBriefing;
        const skilled = (text: string | undefined) =>
          (text ?? "").includes("How to design well");
        assert.isTrue(skilled(yield* briefing.text("design")));
        assert.isFalse(skilled(yield* briefing.text("implement")));
        // Map, Migrate or a token match: a design thread that draws nothing.
        assert.isFalse(
          skilled(yield* briefing.text("design", { designs: false }))
        );
      }).pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

  test.effect(
    "tells a design thread the editor reviews its work, unless no review will run for it",
    () =>
      Effect.gen(function* () {
        const briefing = yield* ProjectBriefing;
        const review = "the editor has the user's review models look";
        const told = (yield* briefing.text("design")) ?? "";
        assert.include(told, review);
        const untold =
          (yield* briefing.text("design", { reviewed: false })) ?? "";
        assert.notInclude(untold, review);
        assert.notInclude(untold, "Declined:");
        // The skill's "a reviewer that sends you findings" is the loop only where it runs (ADR 0110).
        const reviewer = `the design skill's "a reviewer that sends you findings"`;
        assert.include(told, reviewer);
        assert.notInclude(untold, reviewer);
        // The rest of how it works in the chat is said either way.
        assert.include(untold, "Your last message asks nothing.");
      }).pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

  /** The project's own skills: one with a heading, and one without. */
  const ownSkills = {
    ".claude/skills/color/SKILL.md":
      "Blue is the brand; never use it for status.\n",
    ".claude/skills/voice/SKILL.md":
      "# Voice\n\nShort words, said plainly.\n\nNo exclamation marks.\n",
  };

  /** Where a briefing that tells summaries says the design skill's core is read. */
  const coreReadAt = (text: string) => {
    // Typed by hand: the linter otherwise takes the match for non-null.
    const found: RegExpExecArray | null = DESIGN_SKILL_LINE_RE.exec(text);
    return found?.[1] ?? "";
  };

  test.effect(
    "tells the skills by their titles and summaries, each read whole from its resource, when the settings say so",
    () =>
      Effect.gen(function* () {
        const text = (yield* (yield* ProjectBriefing).text("design")) ?? "";
        assert.strictEqual(coreReadAt(text), "skill://ultrapaint/SKILL.md");
        assert.include(
          text,
          "- Voice (skill://ultrapaint/voice): Short words, said plainly."
        );
        // A file without a heading is named by its name, its first line the summary.
        assert.include(
          text,
          "- color (skill://ultrapaint/color): Blue is the brand; never use it for status."
        );
        assert.notInclude(text, "\n# Ultrapaint\n");
        assert.notInclude(text, "No exclamation marks.");
      }).pipe(
        Effect.provide(
          ProjectTest({
            files: ownSkills,
            mcp: true,
            settings: {
              skills: {
                briefing: "summaries",
                enabled: [
                  ".claude/skills/color/SKILL.md",
                  ".claude/skills/voice/SKILL.md",
                ],
              },
            },
          })
        ),
        Effect.scoped
      )
  );

  test.effect(
    "without the tools, tells each skill's summary with the file it is read whole from",
    () =>
      Effect.gen(function* () {
        const text =
          (yield* (yield* ProjectBriefing).text("design", { tools: false })) ??
          "";
        assert.notInclude(text, "skill://");
        const core = coreReadAt(text);
        const fs = yield* FileSystem.FileSystem;
        assert.include(yield* fs.readFileString(core), "# Ultrapaint");
        assert.include(
          text,
          "- Voice (.claude/skills/voice/SKILL.md): Short words, said plainly."
        );
        assert.notInclude(text, "No exclamation marks.");
      }).pipe(
        Effect.provide(
          ProjectTest({
            files: ownSkills,
            settings: {
              skills: {
                briefing: "summaries",
                enabled: [
                  ".claude/skills/color/SKILL.md",
                  ".claude/skills/voice/SKILL.md",
                ],
              },
            },
          })
        ),
        Effect.scoped
      )
  );
});

describe("slash commands", () => {
  const expand = (text: string) =>
    Effect.flatMap(SlashCommands, (commands) => commands.expand(text));

  eachTest(ProjectTest({ mcp: true }))((it) => {
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

  eachTest(ProjectTest({ mcp: true }))("with no project open", (it) => {
    it.effect("sends what was typed when no task can be prepared", () =>
      Effect.gen(function* () {
        yield* Effect.flatMap(ProjectManager, (project) => project.close);
        assert.deepStrictEqual(yield* expand("/init"), {
          purpose: "design",
          text: "/init",
        });
      })
    );
  });
});
