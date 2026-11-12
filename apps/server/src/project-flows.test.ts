import { assert, describe } from "@effect/vitest";
import { componentTarget } from "@ultrapaint/contracts/implementation";
import { makeFixture as makeFigFile } from "@ultrapaint/figma-import/testing/fixture";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { Effect, Fiber, Option, Stream } from "effect";
import { EventBus } from "./events.ts";
import { runCommand } from "./process.ts";
import { OpenProject } from "./project.ts";
import { CommentsService } from "./services/comments.ts";
import { ComponentService } from "./services/components.ts";
import { DocumentService } from "./services/documents.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { GitService } from "./services/git.ts";
import { ImplementationService } from "./services/implementation.ts";
import { PagesService } from "./services/pages.ts";
import { RepoPaths } from "./services/repo-paths.ts";
import { writeComponentFile } from "./testing/components.ts";
import { eachTest } from "./testing/each-test.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

/** The status of a component's link to its code, and the files it is linked to. */
const linkOf = (component: string) =>
  Effect.flatMap(OpenProject, (project) =>
    project.service(ImplementationService)((s) =>
      s.item(componentTarget(component))
    )
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

/** A page from before ADR 0041: an instance of a component of the repository's, deep in a column. */
const LEGACY_PAGE = `${JSON.stringify({
  root: {
    children: [
      {
        children: [
          {
            component: "Button",
            from: "@/components/ui/button",
            id: "new-order",
            type: "instance",
          },
        ],
        id: "c",
        type: "column",
      },
    ],
    id: "orders",
    type: "page",
  },
  version: 1,
})}\n`;

describe("flows in the services", () => {
  eachTest(ProjectTest())((it) => {
    it.effect(
      "starts a system component's file from its default look, linked to no file until it is implemented",
      () =>
        Effect.gen(function* () {
          const project = yield* OpenProject;
          const components = project.service(ComponentService);
          const read = yield* components((c) => c.fromDefault("Button"));
          assert.strictEqual(read.file, "components/Button.component.json");
          assert.strictEqual(read.component?.origin, "system");
          assert.deepStrictEqual(
            read.component?.origin === "system" && read.component.base,
            defaultLookOf("Button")?.base
          );
          assert.deepStrictEqual((yield* linkOf("Button")).files, []);
          assert.notStrictEqual(
            (yield* linkOf("Button")).status,
            "implemented"
          );
          // Only a system component has a default look to start from.
          const missing = yield* Effect.flip(
            components((c) => c.fromDefault("PricingCard"))
          );
          assert.strictEqual(missing._tag, "NotFound");
        })
    );
  });

  eachTest(ProjectTest())((it) => {
    it.effect(
      "changes one thing of a look on the file as it is, what was set since kept (review D6)",
      () =>
        Effect.gen(function* () {
          const project = yield* OpenProject;
          const components = project.service(ComponentService);
          yield* components((c) => c.fromDefault("Card"));
          // Set by someone else after the editor read the file.
          yield* components((c) =>
            c.change("Card", {
              op: "setStyle",
              place: { state: null, variant: null },
              slot: "root",
              style: { fill: "$color-brand" },
            })
          );
          const noted = yield* components((c) =>
            c.change("Card", { op: "addNote", text: "Opens its page" })
          );
          const left = yield* components((c) =>
            c.change("Card", {
              hidden: true,
              op: "setHidden",
              part: "card-description",
            })
          );
          const card = left.component;
          assert(card?.origin === "system");
          assert.deepStrictEqual(card.hidden, ["card-description"]);
          assert.deepStrictEqual(card.base.root, { fill: "$color-brand" });
          // The note's id is the server's, the one the file keeps.
          assert.deepStrictEqual(card.notes, noted.component?.notes);
          assert.strictEqual(card.notes?.[0]?.text, "Opens its page");
        })
    );
  });

  eachTest(ProjectTest())((it) => {
    it.effect(
      "deletes a page with its variants, and says which pages went",
      () =>
        Effect.gen(function* () {
          const project = yield* OpenProject;
          const pages = project.service(PagesService);
          const pricing = yield* pages((p) =>
            p.create("", { name: "Pricing", route: "/pricing" }, "blank")
          );
          yield* pages((p) => p.createVariant(pricing.id, "bold"));
          const gone = yield* pages((p) => p.delete([pricing.id]));
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
          const project = yield* OpenProject;
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

  eachTest(ProjectTest({ git: true }))((it) => {
    it.effect("tells the editor git's status after a commit it makes", () =>
      Effect.gen(function* () {
        const project = yield* OpenProject;
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
          const project = yield* OpenProject;
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

  eachTest(ProjectTest({ files: { "designs/orders.page.json": LEGACY_PAGE } }))(
    (it) => {
      it.effect(
        "reads a page from before ADR 0041 as a problem that says where its instance is and that nothing migrates it",
        () =>
          Effect.gen(function* () {
            const project = yield* OpenProject;
            const documents = project.service(DocumentService);
            const orders = yield* documents((d) => d.get("orders.page.json"));
            assert.isNull(orders.root);
            assert.include(
              orders.problem,
              'at ["root"]["children"][0]["children"][0]["from"]'
            );
            assert.include(orders.problem, "no longer migrated");
          })
      );
    }
  );

  eachTest(ProjectTest())((it) => {
    it.effect(
      "edits an app component's tree as a document, its properties following what its nodes show",
      () =>
        Effect.gen(function* () {
          const project = yield* OpenProject;
          const components = project.service(ComponentService);
          const documents = project.service(DocumentService);
          const designsDir = yield* project.service(RepoPaths)((p) =>
            Effect.succeed(p.designsDir)
          );
          yield* writeComponentFile(designsDir, {
            name: "Promo",
            origin: "app",
            properties: [
              {
                default: "Sale",
                kind: "text",
                name: "title",
                targets: [{ node: "t" }],
              },
            ],
            slots: [{ name: "extra", node: "x" }],
            tree: {
              children: [
                { id: "t", role: "heading", text: "Sale", type: "text" },
                { children: [], id: "x", type: "row" },
              ],
              id: "r",
              type: "column",
            },
            version: 1,
          });
          const doc = yield* documents((d) => d.get("component:Promo"));
          assert.strictEqual(doc.root?.id, "r");
          yield* documents((d) =>
            d.apply({
              edits: [
                {
                  doc: "component:Promo",
                  ops: [
                    { id: "t", op: "update", set: { text: "Spring sale" } },
                    { id: "x", op: "remove" },
                  ],
                },
              ],
            })
          );
          const [promo] = yield* components((c) => c.components);
          assert.strictEqual(promo?.origin, "app");
          if (promo?.origin !== "app") {
            return;
          }
          // The text edited in place is the property's; the slot whose node went is gone.
          assert.strictEqual(promo.properties[0]?.default, "Spring sale");
          assert.deepStrictEqual(promo.slots, []);
          assert.strictEqual(
            promo.tree.type === "column" && promo.tree.children.length,
            1
          );
        })
    );
  });
});
