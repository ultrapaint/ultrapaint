/**
 * The design-system setup (ADR 0023) through its service, each test on a project of its own:
 * the code read, a step's agent finishing it, a step redone, the mapping, a batch migrated,
 * reverted and verified. A step's agent is a thread id here and its tools are called as its
 * calls reach them (`callTool`); the step runner and the tasks are tested on their own
 * (`setup-steps.test.ts`, `tasks.test.ts`), the step's rules in `design-system-setup-rules.test.ts`.
 */
import path from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { SetupStepId } from "@ultrapaint/contracts/design-system-setup";
import { Effect, FileSystem } from "effect";
import { runCommand } from "./process.ts";
import { DesignSystemSetupService } from "./services/design-system-setup.ts";
import { SetupTools } from "./services/mcp/setup-tools.ts";
import { Storage } from "./services/storage.ts";
import { callTool, ProjectFixture, withProject } from "./testing/project.ts";

const APP = `export const App = () => (
  <div className="bg-[#ff0000] p-4 text-gray-500">
    <button type="button">Save</button>
  </div>
);
`;

const setup = Effect.map(DesignSystemSetupService, (service) => service);

const statuses = (s: { readonly steps: readonly { status: string }[] }) =>
  s.steps.map((step) => step.status);

/** The steps before `id` started and gone on past, as the user does. */
const pastUpTo = (id: SetupStepId) =>
  Effect.gen(function* () {
    const service = yield* setup;
    const order: readonly SetupStepId[] = ["inventory", "define", "map"];
    for (const step of order.slice(0, order.indexOf(id))) {
      yield* service.start(step, { threadId: `thread-${step}` });
      yield* service.complete(step);
    }
  });

describe("the design-system setup", () => {
  it.effect("reads the code in the inventory, which comes first", () =>
    withProject({ files: { "src/app.tsx": APP } })(
      Effect.gen(function* () {
        const service = yield* setup;
        assert.deepStrictEqual(statuses(yield* service.get), [
          "todo",
          "todo",
          "todo",
          "todo",
          "todo",
        ]);
        const early = yield* Effect.flip(
          service.start("define", { threadId: "t" })
        );
        assert.include(early.message, "Inventory comes first");

        const started = yield* service.start("inventory", {});
        assert.strictEqual(started.steps[0]?.status, "review");
        assert.include(started.steps[0]?.summary ?? "", "file");
        const inventory = yield* service.inventory;
        assert.includeMembers(
          (inventory?.values ?? []).map(
            (v) => `${v.kind} ${v.status} ${v.value}`
          ),
          [
            "color raw #ff0000",
            "color default color-gray-500",
            "spacing system spacing 4",
          ]
        );
        // No theme at all: a design system is to be proposed.
        assert.strictEqual(inventory?.recommendation.mode, "propose");
        assert.strictEqual(inventory?.against, "theme");
        const done = yield* service.complete("inventory");
        assert.deepStrictEqual(statuses(done).slice(0, 2), ["done", "todo"]);
      })
    )
  );

  it.effect(
    "lets a step's agent say it is finished, for the user to review",
    () =>
      withProject()(
        Effect.gen(function* () {
          const service = yield* setup;
          yield* pastUpTo("define");
          const started = yield* service.start("define", {
            mode: "propose",
            threadId: "define-thread",
          });
          assert.strictEqual(started.steps[1]?.status, "active");
          assert.strictEqual(started.steps[1]?.mode, "propose");
          const finished = yield* callTool(
            SetupTools,
            "finish_setup_step",
            { summary: "Proposed a palette of four colours." },
            "define-thread"
          );
          assert.deepStrictEqual(finished, {
            status: "review",
            step: "define",
          });
          const after = yield* service.get;
          assert.strictEqual(after.steps[1]?.status, "review");
          assert.strictEqual(
            after.steps[1]?.summary,
            "Proposed a palette of four colours."
          );
        })
      )
  );

  it.effect(
    "redoes a step: what it changed is put back, the rest of the work is left alone",
    () =>
      withProject({ files: { "src/app.tsx": APP }, git: true })(
        Effect.gen(function* () {
          const service = yield* setup;
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          const file = (rel: string) => path.join(repo, rel);
          yield* pastUpTo("define");
          yield* service.start("define", { threadId: "define-thread" });
          // The step's work: a file changed, one added, one deleted.
          yield* fs.writeFileString(
            file("src/app.tsx"),
            APP.replace("bg-[#ff0000]", "bg-primary")
          );
          yield* fs.writeFileString(
            file("src/theme.css"),
            "@theme { --color-primary: #ff0000; }\n"
          );
          yield* fs.remove(file("ui/button.tsx"));
          const stopped = yield* service.stop("define");
          assert.strictEqual(stopped.steps[1]?.status, "stopped");
          // Written after the step stopped: not the step's to put back.
          yield* fs.writeFileString(file("notes.md"), "mine\n");

          const preview = yield* service.redoPreview("define");
          assert.deepStrictEqual(
            [...preview].sort((a, b) => a.path.localeCompare(b.path)),
            [
              { action: "restore", path: "src/app.tsx" },
              { action: "delete", path: "src/theme.css" },
              { action: "restore", path: "ui/button.tsx" },
            ]
          );
          const redone = yield* service.redo("define");
          assert.deepStrictEqual(statuses(redone).slice(0, 2), [
            "done",
            "todo",
          ]);
          assert.strictEqual(
            yield* fs.readFileString(file("src/app.tsx")),
            APP
          );
          assert.isFalse(yield* fs.exists(file("src/theme.css")));
          assert.isTrue(yield* fs.exists(file("ui/button.tsx")));
          assert.strictEqual(
            yield* fs.readFileString(file("notes.md")),
            "mine\n"
          );
          // The user's index and branch are not touched by any of it.
          const staged = yield* runCommand("git", ["diff", "--cached"], {
            cwd: repo,
          });
          assert.strictEqual(staged.stdout, "");
        })
      )
  );

  it.effect(
    "redoes the inventory, which takes every later step back with it",
    () =>
      withProject()(
        Effect.gen(function* () {
          const service = yield* setup;
          yield* pastUpTo("define");
          yield* service.start("define", {
            mode: "adopt",
            threadId: "define-thread",
          });
          const redone = yield* service.redo("inventory");
          assert.deepStrictEqual(statuses(redone), [
            "todo",
            "todo",
            "todo",
            "todo",
            "todo",
          ]);
          assert.isNull(yield* service.inventory);
        })
      )
  );

  it.effect(
    "reads an inventory and a mapping an older version kept, without the plain elements it listed",
    () =>
      withProject()(
        Effect.gen(function* () {
          const service = yield* setup;
          const fs = yield* FileSystem.FileSystem;
          // Where the setup keeps its files: written as an older version left them.
          const dir = path.join(
            yield* (yield* Storage).stateDir,
            "design-system-setup"
          );
          yield* service.start("inventory", {});
          const [kept] = yield* fs.readDirectory(dir);
          const at = path.join(dir, kept ?? "", "inventory.json");
          const inventory = JSON.parse(yield* fs.readFileString(at));
          const element = {
            count: 1,
            examples: ["<button>"],
            files: 1,
            kind: "element",
            locations: [],
            status: "raw",
            token: "Button",
            value: "button",
          };
          yield* fs.writeFileString(
            at,
            JSON.stringify({
              ...inventory,
              totals: [
                ...inventory.totals,
                { default: 0, kind: "element", raw: 1, system: 0 },
              ],
              values: [...inventory.values, element],
            })
          );
          const read = yield* service.inventory;
          assert.isNotNull(read);
          assert.notInclude(
            (read?.values ?? []).map((v) => v.kind as string),
            "element"
          );
        })
      )
  );
});

/** A design system Define would have saved: two colours, the spacing base, nothing else. */
const DESIGN_SYSTEM = {
  colors: [
    {
      name: "Semantic",
      tokens: [
        { name: "color-primary", value: "#ff0000" },
        { name: "color-muted-foreground", value: "#777777" },
      ],
    },
  ],
  radius: [],
  shadows: [],
  spacing: { base: "0.25rem" },
  typography: { fonts: [], sizes: [], styles: [], weights: [] },
  version: 1,
};

const SCREEN = `export const Screen = () => (
  <div className="bg-[#ff0000] p-[16px] text-gray-500 m-[13px]">
    <button type="button">Save</button>
  </div>
);
`;

describe("the design-system setup, from the mapping to the code", () => {
  it.effect(
    "maps the values off the system, migrates a batch, reverts it and verifies",
    () =>
      withProject({ files: { "src/screen.tsx": SCREEN } })(
        Effect.gen(function* () {
          const service = yield* setup;
          const { repo } = yield* ProjectFixture;
          const fs = yield* FileSystem.FileSystem;
          const screen = path.join(repo, "src/screen.tsx");
          yield* pastUpTo("map");
          const early = yield* Effect.flip(
            service.start("map", { threadId: "map-thread" })
          );
          assert.include(early.message, "no design system saved");
          // What Define's agent would have written.
          yield* fs.writeFileString(
            path.join(repo, "designs/design-system.json"),
            JSON.stringify(DESIGN_SYSTEM)
          );

          yield* service.start("map", { threadId: "map-thread" });
          const mapping = yield* service.mapping;
          assert.includeMembers(
            (mapping?.entries ?? []).map(
              (e) =>
                `${e.kind} ${e.value} → ${e.target ?? "?"}${e.by ? ` (${e.by})` : ""}`
            ),
            [
              "color #ff0000 → color-primary (rule)",
              "spacing 16px → spacing-4 (rule)",
              "spacing 13px → ?",
              "color color-gray-500 → ?",
            ]
          );

          // The user decides one, and is told what cannot be.
          const mine = yield* service.setMapping(
            [
              {
                kind: "color",
                target: "color-muted-foreground",
                value: "color-gray-500",
              },
              { kind: "spacing", target: "padding-big", value: "13px" },
            ],
            "user"
          );
          assert.lengthOf(mine.problems, 1);
          assert.include(mine.problems[0] ?? "", "spacing-<n>");
          // The agent decides the rest.
          const saved = yield* callTool(
            SetupTools,
            "map_values",
            {
              entries: [
                { kind: "spacing", target: "spacing-3", value: "13px" },
              ],
            },
            "map-thread"
          );
          assert.deepStrictEqual(saved, {
            problems: [],
            saved: 1,
            undecided: 0,
          });
          yield* service.complete("map");

          const migrating = yield* service.start("migrate", {
            threadId: "migrate-thread",
          });
          const batches = migrating.steps.find(
            (s) => s.id === "migrate"
          )?.batches;
          assert.deepStrictEqual(
            batches?.map((b) => [b.dir, b.files]),
            [["src", ["src/screen.tsx"]]]
          );
          const next = (done?: string) =>
            callTool(
              SetupTools,
              "next_batch",
              done === undefined ? {} : { done },
              "migrate-thread"
            );
          const first = yield* next();
          assert.strictEqual(first.remaining, 0);
          assert.deepStrictEqual(first.files, [
            { changes: 4, file: "src/screen.tsx", left: [] },
          ]);
          const migrated = yield* fs.readFileString(screen);
          assert.include(
            migrated,
            'className="bg-primary p-4 text-muted-foreground m-3"'
          );
          // A plain element is the repository's own business.
          assert.include(migrated, '<button type="button">');
          // Done, and there is no other batch to take.
          assert.isNull((yield* next("Rewrote the screen.")).batch);

          const batchId = batches?.[0]?.id ?? "";
          assert.deepStrictEqual(yield* service.batchPreview(batchId), [
            { action: "restore", path: "src/screen.tsx" },
          ]);
          const reverted = yield* service.revertBatch(batchId);
          assert.strictEqual(
            reverted.steps.find((s) => s.id === "migrate")?.batches?.[0]
              ?.status,
            "todo"
          );
          assert.strictEqual(yield* fs.readFileString(screen), SCREEN);
          // Taken again, it is rewritten again.
          yield* next();
          assert.include(yield* fs.readFileString(screen), "bg-primary");
          assert.isNull((yield* next("Again.")).batch);
          yield* service.complete("migrate");

          const verified = yield* service.start("verify", {});
          const verify = verified.steps.find((s) => s.id === "verify");
          assert.strictEqual(verify?.status, "review");
          // Nothing is left off the system: the plain button is not the design system's.
          assert.include(
            verify?.summary ?? "",
            "4 uses when the mapping was made, 0 now"
          );
          const audit = yield* service.audit;
          assert.deepStrictEqual(
            (audit?.values ?? []).filter((v) => v.status !== "system"),
            []
          );
        })
      )
  );
});
