import { assert, describe, layer } from "@effect/vitest";
import { specTarget } from "@ultrapaint/contracts/implementation";
import { makeFixture as makeFigFile } from "@ultrapaint/figma-import/testing/fixture";
import { Effect, Fiber, Option, Stream } from "effect";
import { EventBus } from "./events.ts";
import { runCommand } from "./process.ts";
import { ProjectManager } from "./project.ts";
import { CommentsService } from "./services/comments.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { GitService } from "./services/git.ts";
import { ImplementationService } from "./services/implementation.ts";
import { PagesService } from "./services/pages.ts";
import { SpecService } from "./services/specs.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

const THEME = `@theme {
  --color-brand: #2563eb;
  --color-ink: #111827;
}
`;

const BUTTON = `declare namespace JSX { interface Element {} }
declare const cva: (base: string, config?: unknown) => (props?: unknown) => JSX.Element;
const buttonVariants = cva("inline-flex h-9 px-4 bg-brand text-ink hover:bg-ink");
export const Button = (props: { variant?: string }): JSX.Element => buttonVariants(props);
`;

/** A project whose catalogue has a cva Button in `designs/ui`, over a stylesheet's tokens. */
const withButton = () =>
  ProjectTest({
    files: { "designs/ui/button.tsx": BUTTON, "styles/app.css": THEME },
    settings: {
      hostCss: ["../../styles/app.css"],
      libraryDirs: ["designs/ui"],
    },
  });

/** The status of a spec's link to its code, and the files it is linked to. */
const linkOf = (component: string) =>
  Effect.flatMap(ProjectManager, (project) =>
    project.service(ImplementationService)((s) => s.item(specTarget(component)))
  ).pipe(Effect.map((item) => ({ files: item.files, status: item.status })));

/** The next event of a kind, subscribed to before `effect` runs. */
const nextEvent = <A, E, R>(name: "git", effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const events = yield* EventBus;
    // Started at once, the fiber has subscribed by the time the fork returns.
    const heard = yield* Effect.forkScoped(
      Stream.runHead(events.subscribe(name)),
      { startImmediately: true }
    );
    yield* effect;
    return Option.getOrNull(yield* Fiber.join(heard));
  });

describe("flows in the services", () => {
  layer(withButton(), { excludeTestServices: true })((it) => {
    it.effect(
      "links a spec read from the code alone to its component's file, unless it keeps behaviour notes",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const spec = project.service(SpecService);
          const read = yield* spec((s) => s.fromCode("Button", undefined));
          assert.strictEqual(read.spec?.look, "code");
          assert.deepStrictEqual(yield* linkOf("Button"), {
            files: ["designs/ui/button.tsx"],
            status: "implemented",
          });
          // A note is what the code must still be told to do: read again, the spec keeps it and
          // is not taken as implemented by the code.
          yield* spec((s) => s.addNote("Button", "Submits its form"));
          yield* spec((s) => s.fromCode("Button", undefined, "design"));
          assert.strictEqual((yield* linkOf("Button")).status, "changed");
        })
    );
  });

  layer(withButton(), { excludeTestServices: true })((it) => {
    it.effect("reads every spec from the code, each linked to its file", () =>
      Effect.gen(function* () {
        const project = yield* ProjectManager;
        const spec = project.service(SpecService);
        assert.deepStrictEqual(yield* spec((s) => s.fromCodeAll()), {
          linked: 1,
          read: 1,
        });
        assert.deepStrictEqual(yield* linkOf("Button"), {
          files: ["designs/ui/button.tsx"],
          status: "implemented",
        });
        assert.deepStrictEqual(yield* spec((s) => s.fromCodeAll()), {
          linked: 0,
          read: 0,
        });
      })
    );
  });

  layer(ProjectTest(), { excludeTestServices: true })((it) => {
    it.effect(
      "deletes a page with its variants, and says which pages went",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const pages = project.service(PagesService);
          const pricing = yield* pages((p) =>
            p.create("", { name: "Pricing", route: "/pricing" }, "blank")
          );
          yield* pages((p) => p.createVariant(pricing.id, "bold"));
          const gone = yield* pages((p) => p.delete(pricing.id));
          assert.deepStrictEqual(
            gone.map((p) => p.file),
            ["designs/pricing.page.json", "designs/pricing@bold.page.json"]
          );
        })
    );

    it.effect(
      "gives the newest Figma import's default theme, and none without an import",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const figma = project.service(FigmaImportService);
          assert.deepStrictEqual(yield* figma((f) => f.theme), {});
          const file = makeFigFile();
          const set = file.add(file.internal, {
            guid: { localID: 1, sessionID: 9 },
            name: "Tokens",
            type: "VARIABLE_SET",
            variableSetModes: [
              {
                id: { localID: 2, sessionID: 9 },
                name: "Light",
                sortPosition: "a",
              },
            ],
          } as never);
          file.add(file.internal, {
            guid: { localID: 10, sessionID: 9 },
            name: "Radius/Card",
            type: "VARIABLE",
            variableDataValues: {
              entries: [
                {
                  modeID: { localID: 2, sessionID: 9 },
                  variableData: {
                    dataType: "FLOAT",
                    resolvedDataType: "FLOAT",
                    value: { floatValue: 12 },
                  },
                },
              ],
            },
            variableResolvedType: "FLOAT",
            variableSetID: { guid: set },
          } as never);
          yield* figma((i) => i.create("Brand.fig", file.build()));
          const theme = yield* figma((i) => i.theme);
          assert.deepStrictEqual(Object.keys(theme), ["radius-card"]);
        })
    );
  });

  layer(ProjectTest({ git: true, settings: { git: "on" } }), {
    excludeTestServices: true,
  })((it) => {
    it.effect("tells the editor git's status after a commit it makes", () =>
      Effect.gen(function* () {
        const project = yield* ProjectManager;
        const git = project.service(GitService);
        const status = yield* nextEvent(
          "git",
          git((g) =>
            Effect.flatMap(
              project.service(PagesService)((p) =>
                p.create("", { name: "Plans" }, "blank")
              ),
              () => g.commit("Add plans", ["designs/plans.page.json"])
            )
          )
        );
        assert.isNotNull(status);
        assert.notInclude(
          status?.files.map((f) => f.path) ?? [],
          "designs/plans.page.json"
        );
      })
    );

    it.effect(
      "signs a comment with git's user name as it is when it is made",
      () =>
        Effect.gen(function* () {
          const { repo } = yield* ProjectFixture;
          const project = yield* ProjectManager;
          const comments = project.service(CommentsService);
          const comment = {
            canvas: "",
            element: null,
            nodeId: null,
            page: "home.page.json",
            x: 0,
            y: 0,
          };
          const first = yield* comments((c) =>
            c.create({ ...comment, text: "Tighter" })
          );
          assert.strictEqual(first.author, "Test");
          yield* runCommand("git", ["config", "user.name", "Ada"], {
            cwd: repo,
          });
          const second = yield* comments((c) =>
            c.create({ ...comment, text: "Looser" })
          );
          assert.strictEqual(second.author, "Ada");
        })
    );
  });
});
