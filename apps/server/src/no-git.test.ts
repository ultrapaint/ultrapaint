import path from "node:path";
import { assert, layer } from "@effect/vitest";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import { Effect, FileSystem } from "effect";
import { eachTest } from "./testing/each-test.ts";
import { makeTestServer, TestEnv, waitForThread } from "./testing/harness.ts";
import { turnEnded } from "./testing/turns.ts";

// A machine where git knows no one: whatever this one's global configuration says is not read.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

/** A plain folder, never `git init`ed, with its settings and state in a home directory. */
const PlainFolder = makeTestServer(
  ({ home }) => Effect.succeed({ home, mode: "managed" }),
  { git: false }
);

/** Why these tests run on the real clock, each on a server of its own (docs/TESTING.md rule 3). */
const AGENT_PROCESS =
  "the agent is a real process, its turn heard over the socket, and git a real command";

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
    return yield* waitForThread(thread.id, turnEnded);
  });

eachTest(PlainFolder, { realClock: AGENT_PROCESS })(
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

    it.effect(
      "signs comments with the profile's display name when git has none",
      () =>
        Effect.gen(function* () {
          const { client, settings } = yield* TestEnv;
          yield* client["settings.set"](settings);
          const unsigned = yield* client["comments.create"]({
            canvas: "",
            element: null,
            nodeId: null,
            page: "home.page.json",
            text: "Before a name",
            x: 0,
            y: 0,
          });
          assert.isNull(unsigned.author);

          const saved = yield* client["profile.set"]({
            displayName: "  Ada Lovelace ",
          });
          assert.deepStrictEqual(saved, { displayName: "Ada Lovelace" });
          assert.deepStrictEqual(yield* client["profile.get"](), saved);
          assert.strictEqual(
            (yield* client["project.info"]()).displayName,
            "Ada Lovelace"
          );
          const signed = yield* client["comments.create"]({
            canvas: "",
            element: null,
            nodeId: null,
            page: "home.page.json",
            text: "After",
            x: 0,
            y: 0,
          });
          assert.strictEqual(signed.author, "Ada Lovelace");
        })
    );

    it.effect(
      "makes the folder a repository only once writing to git is on",
      () =>
        Effect.gen(function* () {
          const { client, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          yield* client["settings.set"](settings);
          const refused = yield* Effect.flip(client["git.init"]());
          assert.strictEqual(refused._tag, "BadRequest");
          const commit = yield* Effect.flip(
            client["git.commit"]({ message: "m", paths: ["designs"] })
          );
          assert.strictEqual(commit._tag, "BadRequest");
          assert.isFalse(yield* fs.exists(path.join(repo, ".git")));

          assert.isTrue(
            (yield* client["settings.set"]({ ...settings, git: "on" })).ok
          );
          yield* client["git.init"]();
          assert.isTrue(yield* fs.exists(path.join(repo, ".git")));
          const info = yield* client["project.info"]();
          assert.isTrue(info.gitRepository);
          const status = yield* client["git.status"]();
          assert.include(
            status.files.map((f) => f.path),
            "designs/home.page.json"
          );
        })
    );

    it.effect("tells which files an agent's turn changed, without git", () =>
      Effect.gen(function* () {
        const { client, settings } = yield* TestEnv;
        yield* client["settings.set"](settings);
        const { items } = yield* runTurn("write");
        const end = items.at(-1);
        assert.deepStrictEqual(
          end?.kind === "turn_end" ? end.changedFiles : null,
          ["designs/agent.tsx"]
        );
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

const PlainSetupFolder = makeTestServer(
  ({ home }) => Effect.succeed({ home, mode: "managed" }),
  { git: false }
);

const SNAPSHOT_ID_RE = /^[0-9a-f]{64}$/;

const APP = `export const App = () => (
  <div className="bg-[#ff0000] p-4 text-gray-500">Save</div>
);
`;

eachTest(PlainSetupFolder, { realClock: AGENT_PROCESS })(
  "the design-system setup without git",
  (it) => {
    it.effect(
      "keeps each step in the tool's own snapshots, and puts back what a step changed",
      () =>
        Effect.gen(function* () {
          const { client, home, repo, settings } = yield* TestEnv;
          const fs = yield* FileSystem.FileSystem;
          const file = (rel: string) => path.join(repo, rel);
          yield* fs.makeDirectory(file("src"));
          yield* fs.writeFileString(file("src/app.tsx"), APP);
          // Ignored, so neither snapshotted nor put back.
          yield* fs.writeFileString(file(".gitignore"), "*.log\n");
          yield* client["settings.set"]({ ...settings, libraryDirs: ["ui"] });
          yield* client["chat.setDefaults"]({ agentId: "fake" });

          const { setup } = yield* client["dsSetup.start"]({
            step: "inventory",
          });
          assert.match(setup.steps[0]?.before ?? "", SNAPSHOT_ID_RE);
          yield* client["dsSetup.complete"]({ step: "inventory" });
          yield* client["dsSetup.start"]({ step: "define" });

          // The step's work: a file changed, one added, one deleted.
          yield* fs.writeFileString(
            file("src/app.tsx"),
            APP.replace("bg-[#ff0000]", "bg-primary")
          );
          yield* fs.writeFileString(file("src/theme.css"), "@theme {}\n");
          yield* fs.remove(file("ui/button.tsx"));
          yield* fs.writeFileString(file("debug.log"), "noise\n");
          yield* client["dsSetup.stop"]({ step: "define" });

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
          yield* client["dsSetup.redo"]({ step: "define" });
          assert.strictEqual(
            yield* fs.readFileString(file("src/app.tsx")),
            APP
          );
          assert.isFalse(yield* fs.exists(file("src/theme.css")));
          assert.isTrue(yield* fs.exists(file("ui/button.tsx")));
          assert.isTrue(yield* fs.exists(file("debug.log")));
          assert.isFalse(yield* fs.exists(file(".git")));
          // The snapshots are in the state directory, not in the project.
          assert.isTrue(
            yield* fs.exists(path.join(home, "store", "manifests"))
          );
        }),
      30_000
    );
  }
);
