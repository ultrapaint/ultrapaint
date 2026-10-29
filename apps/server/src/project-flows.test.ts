import { assert, describe, layer } from "@effect/vitest";
import {
  APP_FROM,
  LEGACY_DRAFT_FROM,
  LEGACY_SYSTEM_FROM,
  SYSTEM_FROM,
} from "@ultrapaint/contracts/component-names";
import { componentTarget } from "@ultrapaint/contracts/implementation";
import { findNode } from "@ultrapaint/design-document/tree";
import { makeFixture as makeFigFile } from "@ultrapaint/figma-import/testing/fixture";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { Effect, Fiber, FileSystem, Option, Path, Stream } from "effect";
import { EventBus } from "./events.ts";
import { runCommand } from "./process.ts";
import { ProjectManager } from "./project.ts";
import { CommentsService } from "./services/comments.ts";
import { ComponentService } from "./services/components.ts";
import { DocumentService } from "./services/documents.ts";
import { EditService } from "./services/edit.ts";
import { FigmaImportService } from "./services/figma-import.ts";
import { GitService } from "./services/git.ts";
import { ImplementationService } from "./services/implementation.ts";
import { PagesService } from "./services/pages.ts";
import { ProjectFixture, ProjectTest } from "./testing/project.ts";

/** The status of a component's link to its code, and the files it is linked to. */
const linkOf = (component: string) =>
  Effect.flatMap(ProjectManager, (project) =>
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

/** A spec's file from before ADR 0041: a look the design owned, a draft, or a mirror of the code. */
const legacySpec = (component: string, fields: Record<string, unknown>) =>
  `${JSON.stringify({
    base: {},
    component,
    defaults: {},
    from: "@ultrapaint/primitives",
    look: "design",
    slots: [{ name: "root" }],
    states: {},
    variants: {},
    version: 1,
    ...fields,
  })}\n`;

const LEGACY_FILES = {
  "designs/_implemented/specs/Button.implemented.json": `${JSON.stringify({
    kind: "spec",
    spec: JSON.parse(
      legacySpec("Button", {
        base: { root: { fill: "$color-brand" } },
        notes: [{ id: "n1", text: "Submits its form" }],
      })
    ),
  })}\n`,
  "designs/specs/Badge.spec.json": legacySpec("Badge", { look: "code" }),
  "designs/specs/Button.spec.json": legacySpec("Button", {
    base: { root: { fill: "$color-brand" } },
    notes: [{ id: "n1", text: "Submits its form" }],
  }),
  "designs/specs/Promo.spec.json": legacySpec("Promo", {
    draft: {
      children: [
        { id: "p-title", role: "heading", text: "Sale", type: "text" },
      ],
      id: "p-root",
      type: "column",
    },
    from: "#draft",
  }),
};

describe("flows in the services", () => {
  layer(ProjectTest(), { excludeTestServices: true })((it) => {
    it.effect(
      "starts a system component's file from its default look, linked to no file until it is implemented",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
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
      "draws the pages' instances of the repository's components as system components, in one step",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const pages = project.service(PagesService);
          const documents = project.service(DocumentService);
          const orders = yield* pages((p) =>
            p.create("", { name: "Orders", route: "/orders" }, "blank")
          );
          const { root } = yield* documents((d) => d.get(orders.id));
          yield* documents((d) =>
            d.apply({
              edits: [
                {
                  doc: orders.id,
                  ops: [
                    {
                      node: {
                        component: "Button",
                        from: "@/components/ui/button",
                        id: "new-order",
                        props: { size: "default", variant: "default" },
                        text: "New order",
                        type: "instance",
                      },
                      op: "insert",
                      parent: root?.id ?? null,
                    },
                    {
                      node: {
                        component: "RevenueChart",
                        from: "@/components/revenue-chart",
                        id: "chart",
                        type: "instance",
                      },
                      op: "insert",
                      parent: root?.id ?? null,
                    },
                  ],
                },
              ],
            })
          );
          assert.deepStrictEqual(yield* documents((d) => d.oldInstances), {
            drawn: 1,
            left: 1,
          });
          assert.deepStrictEqual(
            yield* project.service(ComponentService)((c) => c.migrate),
            { components: 0, documents: 1, drawn: 1 }
          );
          const after = yield* documents((d) => d.get(orders.id));
          const button = after.root && findNode(after.root, "new-order");
          assert.deepStrictEqual(button, {
            component: "Button",
            from: SYSTEM_FROM,
            id: "new-order",
            props: { size: "md", variant: "primary" },
            text: "New order",
            type: "instance",
          });
          assert.deepStrictEqual(yield* documents((d) => d.oldInstances), {
            drawn: 0,
            left: 1,
          });
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

  layer(ProjectTest({ files: LEGACY_FILES }), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "brings the designs from before up to date in one undo step: instances, specs and their implementation",
        () =>
          Effect.gen(function* () {
            const project = yield* ProjectManager;
            const { repo } = yield* ProjectFixture;
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const at = (file: string) => path.join(repo, "designs", file);
            const implementation = project.service(ImplementationService);
            const documents = project.service(DocumentService);
            const components = project.service(ComponentService);
            yield* fs.writeFileString(
              at("implementation.json"),
              `${JSON.stringify({
                items: {
                  "spec:Button": {
                    implemented: {
                      at: 1,
                      code: {},
                      design: "old",
                      files: ["src/button.tsx"],
                    },
                  },
                },
                version: 1,
              })}\n`
            );
            const pages = project.service(PagesService);
            const orders = yield* pages((p) =>
              p.create("", { name: "Orders", route: "/orders" }, "blank")
            );
            const { root } = yield* documents((d) => d.get(orders.id));
            yield* documents((d) =>
              d.apply({
                edits: [
                  {
                    doc: orders.id,
                    ops: [
                      {
                        node: {
                          component: "Button",
                          from: LEGACY_SYSTEM_FROM,
                          id: "go",
                          text: "Go",
                          type: "instance",
                        },
                        op: "insert",
                        parent: root?.id ?? null,
                      },
                      {
                        node: {
                          component: "Promo",
                          from: LEGACY_DRAFT_FROM,
                          id: "promo",
                          text: "Spring sale",
                          type: "instance",
                        },
                        op: "insert",
                        parent: root?.id ?? null,
                      },
                    ],
                  },
                ],
              })
            );
            assert.deepStrictEqual(yield* components((c) => c.legacy), {
              drawn: 2,
              left: 0,
              specs: 3,
            });

            assert.deepStrictEqual(yield* components((c) => c.migrate), {
              components: 2,
              documents: 1,
              drawn: 2,
            });
            const after = yield* documents((d) => d.get(orders.id));
            assert.deepInclude(after.root && findNode(after.root, "go"), {
              from: SYSTEM_FROM,
            });
            assert.deepInclude(after.root && findNode(after.root, "promo"), {
              from: APP_FROM,
              props: { text: "Spring sale" },
            });
            const files = yield* components((c) => c.components);
            const promo = files.find((c) => c.name === "Promo");
            assert.strictEqual(promo?.origin, "app");
            assert.deepStrictEqual(
              promo?.origin === "app" ? promo.properties : null,
              [
                {
                  default: "Sale",
                  kind: "text",
                  name: "text",
                  targets: [{ node: "p-title" }],
                },
              ]
            );
            assert.deepStrictEqual(
              files.find((c) => c.name === "Button")?.notes,
              [{ id: "n1", text: "Submits its form" }]
            );
            // A spec that mirrored the code drew nothing: it is gone, with no file of its own.
            assert.isUndefined(files.find((c) => c.name === "Badge"));
            assert.isFalse(yield* fs.exists(at("specs/Button.spec.json")));
            assert.isTrue(
              yield* fs.exists(
                at("_implemented/components/Button.implemented.json")
              )
            );
            // The link follows: implemented as it was, the design as it was implemented.
            const button = yield* implementation((i) =>
              i.item("component:Button")
            );
            assert.isFalse(button.designChanged);
            assert.deepStrictEqual(button.files, ["src/button.tsx"]);

            // One step back puts everything as it was.
            yield* project.service(EditService)((e) => e.undo);
            assert.isTrue(yield* fs.exists(at("specs/Button.spec.json")));
            assert.isFalse(
              yield* fs.exists(at("components/Button.component.json"))
            );
            assert.include(
              yield* fs.readFileString(at("implementation.json")),
              "spec:Button"
            );
          }),
        60_000
      );
    }
  );

  layer(ProjectTest(), { excludeTestServices: true })((it) => {
    it.effect(
      "edits an app component's tree as a document, its properties following what its nodes show",
      () =>
        Effect.gen(function* () {
          const project = yield* ProjectManager;
          const components = project.service(ComponentService);
          const documents = project.service(DocumentService);
          yield* components((c) =>
            c.write({
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
            })
          );
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
