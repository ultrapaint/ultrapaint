import path from "node:path";
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { runCommand } from "./process.ts";
import { TestEnv, TestServer, waitForThread } from "./testing/harness.ts";
import { callMcp } from "./testing/mcp.ts";
import { said, turnEnded } from "./testing/turns.ts";

const APP = `export const App = () => (
  <div className="bg-[#ff0000] p-4 text-gray-500">
    <button type="button">Save</button>
  </div>
);
`;

const statuses = (setup: { readonly steps: readonly { status: string }[] }) =>
  setup.steps.map((s) => s.status);

layer(TestServer, { excludeTestServices: true, timeout: "60 seconds" })(
  "the design-system setup",
  (it) => {
    it.effect(
      "takes the steps in order, the inventory first, and reads the code",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* fs.makeDirectory(path.join(repo, "src"));
          yield* fs.writeFileString(path.join(repo, "src/app.tsx"), APP);
          yield* client["settings.set"]({ ...settings, libraryDirs: ["ui"] });

          const fresh = yield* client["dsSetup.get"]();
          assert.deepStrictEqual(statuses(fresh), [
            "todo",
            "todo",
            "todo",
            "todo",
            "todo",
          ]);
          const early = yield* Effect.flip(
            client["dsSetup.start"]({ step: "define" })
          );
          assert.strictEqual(early._tag, "BadRequest");
          assert.include(early.message, "Inventory comes first");
          const later = yield* Effect.flip(
            client["dsSetup.start"]({ step: "map" })
          );
          assert.include(later.message, "Inventory comes first");

          const { setup, threadId } = yield* client["dsSetup.start"]({
            step: "inventory",
          });
          assert.isNull(threadId);
          assert.strictEqual(setup.steps[0]?.status, "review");
          assert.include(setup.steps[0]?.summary ?? "", "file");
          const inventory = yield* client["dsSetup.inventory"]();
          const values = (inventory?.values ?? []).map(
            (v) => `${v.kind} ${v.status} ${v.value}`
          );
          assert.includeMembers(values, [
            "color raw #ff0000",
            "color default color-gray-500",
            "spacing system spacing 4",
          ]);
          // No theme at all: a design system is to be proposed.
          assert.strictEqual(inventory?.recommendation.mode, "propose");
          assert.strictEqual(inventory?.against, "theme");

          const done = yield* client["dsSetup.complete"]({ step: "inventory" });
          assert.deepStrictEqual(statuses(done).slice(0, 2), ["done", "todo"]);
        }),
      30_000
    );

    it.effect(
      "gives the Define step a thread whose command expands into the step's task",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          // The step's thread goes to the chat's default agent.
          yield* client["chat.setDefaults"]({ agentId: "fake" });
          const commands = (yield* client["commands.list"]()).map(
            (c) => c.name
          );
          assert.include(commands, "design-system");
          const { setup, task, threadId } = yield* client["dsSetup.start"]({
            step: "define",
          });
          assert.isString(threadId);
          // The thread's first prompt is the step's task, which the editor writes in its composer.
          assert.deepStrictEqual(task, { _tag: "SetupStep", step: "define" });
          const [, define] = setup.steps;
          assert.strictEqual(define?.status, "active");
          assert.strictEqual(define?.mode, "propose");
          assert.strictEqual(define?.threadId, threadId);
          const again = yield* Effect.flip(
            client["dsSetup.start"]({ step: "define" })
          );
          assert.include(again.message, "has started already");

          yield* client["threads.prompt"]({
            attachments: [],
            text: "/design-system define",
            threadId: threadId ?? "",
          });
          const { items } = yield* waitForThread(threadId ?? "", turnEnded);
          assert.include(
            said(items).join("\n"),
            "task:design-system This is the Define step of the design-system setup, proposing a design system"
          );
        }),
      30_000
    );

    it.effect(
      "lets the step's agent say the step is finished, for the user to review",
      () =>
        Effect.gen(function* () {
          const { client, port } = yield* TestEnv;
          const { steps } = yield* client["dsSetup.get"]();
          const threadId = steps[1]?.threadId ?? "";
          // The fake agent reports the MCP server it was handed, token and all.
          yield* client["threads.prompt"]({
            attachments: [],
            text: "mcp",
            threadId,
          });
          const { items } = yield* waitForThread(threadId, turnEnded);
          const reported = said(items).find((t) => t.startsWith("mcp:")) ?? "";
          const [, token] = reported.slice("mcp:".length).split("|");
          const call = (name: string, args: Record<string, unknown>) =>
            callMcp(port, token, {
              method: "tools/call",
              params: { arguments: args, name },
            }).pipe(
              Effect.flatMap((response) =>
                Effect.promise(
                  () =>
                    response.json() as Promise<{
                      result: {
                        content: { text: string }[];
                        isError?: boolean;
                      };
                    }>
                )
              ),
              Effect.map(({ result }) => ({
                error: result.isError === true,
                text: result.content[0]?.text ?? "",
              }))
            );
          const finished = yield* call("finish_setup_step", {
            summary: "Proposed a palette of four colours.",
          });
          assert.isFalse(finished.error, finished.text);
          assert.include(finished.text, "review");
          const after = yield* client["dsSetup.get"]();
          assert.strictEqual(after.steps[1]?.status, "review");
          assert.strictEqual(
            after.steps[1]?.summary,
            "Proposed a palette of four colours."
          );
        }),
      30_000
    );

    it.effect(
      "redoes a step: what it changed is put back, the rest of the work is left alone",
      () =>
        Effect.gen(function* () {
          const { client, repo } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const file = (rel: string) => path.join(repo, rel);
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
          const stopped = yield* client["dsSetup.stop"]({ step: "define" });
          assert.strictEqual(stopped.steps[1]?.status, "stopped");
          // Written after the step stopped: not the step's to put back.
          yield* fs.writeFileString(file("notes.md"), "mine\n");

          const preview = yield* client["dsSetup.redoPreview"]({
            step: "define",
          });
          assert.deepStrictEqual(
            [...preview].sort((a, b) => a.path.localeCompare(b.path)),
            [
              { action: "restore", path: "src/app.tsx" },
              { action: "delete", path: "src/theme.css" },
              { action: "restore", path: "ui/button.tsx" },
            ]
          );

          const redone = yield* client["dsSetup.redo"]({ step: "define" });
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
        }),
      30_000
    );

    it.effect(
      "redoes the inventory, which takes every later step back with it",
      () =>
        Effect.gen(function* () {
          const { client } = yield* TestEnv;
          const { threadId } = yield* client["dsSetup.start"]({
            mode: "adopt",
            step: "define",
          });
          const setup = yield* client["dsSetup.get"]();
          assert.strictEqual(setup.steps[1]?.mode, "adopt");
          assert.notStrictEqual(threadId, null);
          const redone = yield* client["dsSetup.redo"]({ step: "inventory" });
          assert.deepStrictEqual(statuses(redone), [
            "todo",
            "todo",
            "todo",
            "todo",
            "todo",
          ]);
          assert.isNull(yield* client["dsSetup.inventory"]());
          const refs = yield* runCommand(
            "git",
            ["for-each-ref", "refs/ultrapaint/setup/"],
            { cwd: (yield* TestEnv).repo }
          );
          assert.strictEqual(refs.stdout.trim(), "");
        }),
      30_000
    );
  }
);

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

/** The MCP token a step's thread was handed, which the fake agent says when asked. */
const tokenOf = (threadId: string) =>
  Effect.gen(function* () {
    const { client } = yield* TestEnv;
    yield* client["threads.prompt"]({ attachments: [], text: "mcp", threadId });
    const { items } = yield* waitForThread(threadId, turnEnded);
    const reported = said(items).find((t) => t.startsWith("mcp:")) ?? "";
    return reported.slice("mcp:".length).split("|")[1] ?? "";
  });

/** A tool of the editor's MCP server, called as the thread's agent. */
const tool = (token: string, name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const { port } = yield* TestEnv;
    const response = yield* callMcp(port, token, {
      method: "tools/call",
      params: { arguments: args, name },
    });
    const body = (yield* Effect.promise(() => response.json())) as {
      result: {
        content: { text: string }[];
        isError?: boolean;
        structuredContent?: unknown;
      };
    };
    assert.isNotTrue(body.result.isError, body.result.content[0]?.text);
    return body.result.structuredContent as Record<string, unknown>;
  });

layer(TestServer, { excludeTestServices: true, timeout: "120 seconds" })(
  "the design-system setup, from the mapping to the code",
  (it) => {
    it.effect(
      "maps the values off the system, migrates a batch, reverts it and verifies",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const screen = path.join(repo, "src/screen.tsx");
          yield* fs.makeDirectory(path.join(repo, "src"));
          yield* fs.writeFileString(screen, SCREEN);
          yield* client["settings.set"]({ ...settings, libraryDirs: ["ui"] });
          yield* client["chat.setDefaults"]({ agentId: "fake" });

          yield* client["dsSetup.start"]({ step: "inventory" });
          yield* client["dsSetup.complete"]({ step: "inventory" });
          yield* client["dsSetup.start"]({ step: "define" });
          const early = yield* Effect.flip(
            Effect.andThen(
              client["dsSetup.complete"]({ step: "define" }),
              client["dsSetup.start"]({ step: "map" })
            )
          );
          assert.include(early.message, "no design system saved");
          // What Define's agent would have written.
          yield* fs.writeFileString(
            path.join(repo, "designs/design-system.json"),
            JSON.stringify(DESIGN_SYSTEM)
          );

          const { threadId: mapThread } = yield* client["dsSetup.start"]({
            step: "map",
          });
          const mapping = yield* client["dsSetup.mapping"]();
          const decided = (mapping?.entries ?? []).map(
            (e) =>
              `${e.kind} ${e.value} → ${e.target ?? "?"}${e.by ? ` (${e.by})` : ""}`
          );
          assert.includeMembers(decided, [
            "color #ff0000 → color-primary (rule)",
            "spacing 16px → spacing-4 (rule)",
            "spacing 13px → ?",
            "color color-gray-500 → ?",
          ]);

          // The user decides one, and is told what cannot be.
          const mine = yield* client["dsSetup.setMapping"]({
            changes: [
              {
                kind: "color",
                target: "color-muted-foreground",
                value: "color-gray-500",
              },
              { kind: "spacing", target: "padding-big", value: "13px" },
            ],
          });
          assert.lengthOf(mine.problems, 1);
          assert.include(mine.problems[0] ?? "", "spacing-<n>");
          // The agent decides the rest.
          const token = yield* tokenOf(mapThread ?? "");
          const saved = yield* tool(token, "map_values", {
            entries: [{ kind: "spacing", target: "spacing-3", value: "13px" }],
          });
          assert.deepStrictEqual(saved, {
            problems: [],
            saved: 1,
            undecided: 0,
          });
          yield* client["dsSetup.complete"]({ step: "map" });

          const { setup, threadId: migrateThread } = yield* client[
            "dsSetup.start"
          ]({ step: "migrate" });
          const batches = setup.steps.find((s) => s.id === "migrate")?.batches;
          assert.deepStrictEqual(
            batches?.map((b) => [b.dir, b.files]),
            [["src", ["src/screen.tsx"]]]
          );
          const agent = yield* tokenOf(migrateThread ?? "");
          const first = yield* tool(agent, "next_batch", {});
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
          const after = yield* tool(agent, "next_batch", {
            done: "Rewrote the screen.",
          });
          assert.isNull(after.batch);

          const batchId = batches?.[0]?.id ?? "";
          const preview = yield* client["dsSetup.batchPreview"]({ batchId });
          assert.deepStrictEqual(preview, [
            { action: "restore", path: "src/screen.tsx" },
          ]);
          const reverted = yield* client["dsSetup.revertBatch"]({ batchId });
          assert.strictEqual(
            reverted.steps.find((s) => s.id === "migrate")?.batches?.[0]
              ?.status,
            "todo"
          );
          assert.strictEqual(yield* fs.readFileString(screen), SCREEN);
          // Taken again, it is rewritten again.
          yield* tool(agent, "next_batch", {});
          assert.include(yield* fs.readFileString(screen), "bg-primary");
          const none = yield* tool(agent, "next_batch", { done: "Again." });
          assert.isNull(none.batch);
          yield* client["dsSetup.complete"]({ step: "migrate" });

          const verified = yield* client["dsSetup.start"]({ step: "verify" });
          const verify = verified.setup.steps.find((s) => s.id === "verify");
          assert.strictEqual(verify?.status, "review");
          // Nothing is left off the system: the plain button is not the design system's.
          assert.include(
            verify?.summary ?? "",
            "4 uses when the mapping was made, 0 now"
          );
          const audit = yield* client["dsSetup.audit"]();
          assert.deepStrictEqual(
            (audit?.values ?? []).filter((v) => v.status !== "system"),
            []
          );
        }),
      90_000
    );
  }
);
