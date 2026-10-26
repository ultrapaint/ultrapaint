import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem } from "effect";
import { makeTestServer, TestEnv } from "./testing/harness.ts";

/** A plain folder, never `git init`ed, with its settings and state in a home directory. */
const PlainFolder = makeTestServer(
  ({ home }) => Effect.succeed({ home, mode: "managed" }),
  { git: false }
);

const waitForTurn = (threadId: string) =>
  Effect.gen(function* () {
    const { client } = yield* TestEnv;
    const read = Effect.gen(function* () {
      const thread = (yield* client["threads.list"]()).find(
        (t) => t.id === threadId
      );
      const items = yield* client["threads.items"]({ threadId });
      return { items, thread };
    });
    return yield* read.pipe(
      Effect.tap(() => Effect.sleep("25 millis")),
      Effect.repeat({
        until: ({ items, thread }) =>
          thread?.status === "idle" && items.at(-1)?.kind === "turn_end",
      }),
      Effect.timeout("20 seconds")
    );
  });

const said = (items: readonly ThreadItem[]) =>
  items.flatMap((i) => (i.kind === "agent" ? [i.text] : [])).join("\n");

const runTurn = (text: string) =>
  Effect.gen(function* () {
    const { client } = yield* TestEnv;
    const thread: Thread = yield* client["threads.create"]({ agentId: "fake" });
    yield* client["threads.prompt"]({
      attachments: [],
      text,
      threadId: thread.id,
    });
    return yield* waitForTurn(thread.id);
  });

layer(PlainFolder, { excludeTestServices: true, timeout: "60 seconds" })(
  "a folder without git",
  (it) => {
    it.effect("opens it as a project, and never makes it a repository", () =>
      Effect.gen(function* () {
        const { client, repo, settings } = yield* TestEnv;
        const fs = yield* FileSystem.FileSystem;
        const validation = yield* client["settings.set"](settings);
        assert.deepStrictEqual(validation.problems, []);
        assert.isTrue(validation.ok);
        const info = yield* client["project.info"]();
        assert.isTrue(info.configured);
        assert.isFalse(info.gitRepository);
        assert.strictEqual(info.branch, "");
        const { pages } = yield* client["pages.list"]();
        assert.include(
          pages.map((p) => p.file),
          "designs/home.page.json"
        );
        assert.isFalse(yield* fs.exists(path.join(repo, ".git")));
      })
    );

    it.effect("tells the agent nothing about a .git there is not", () =>
      Effect.gen(function* () {
        const { client, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        const { items } = yield* runTurn("briefing");
        const briefing = said(items);
        assert.include(briefing, "<ultrapaint>");
        assert.notInclude(briefing, ".git");
      })
    );
  }
);

/** Started without a configuration in a folder that is no repository. */
const UnsavedPlainFolder = makeTestServer(
  () => Effect.succeed({ mode: "ephemeral" }),
  { git: false }
);

layer(UnsavedPlainFolder, { excludeTestServices: true, timeout: "60 seconds" })(
  "an unsaved session in a folder without git",
  (it) => {
    it.effect("proposes the working directory as the project", () =>
      Effect.gen(function* () {
        const { client, repo } = yield* TestEnv;
        const info = yield* client["project.info"]();
        assert.strictEqual(info.storage.defaultRepoPath, repo);
      })
    );
  }
);
