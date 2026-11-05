import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { Storage } from "./services/storage.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";

/** The preferences of a project whose state is in `stateDir`, for the user in `userDir`. */
const preferencesOf = (userDir: string, stateDir: string) =>
  ChatPreferences.layer.pipe(
    Layer.provide(Storage.layer),
    Layer.provide(AppLog.layer),
    Layer.provide(EventBus.layer),
    Layer.provide(
      ServerConfig.layerTest({
        storage: { mode: "ephemeral", sessionDir: stateDir },
        userDir,
      })
    )
  );

/** The defaults a project's chat starts with. */
const defaultsOf = (userDir: string, stateDir: string) =>
  Effect.scoped(
    ChatPreferences.use((p) => p.defaults).pipe(
      Effect.provide(preferencesOf(userDir, stateDir))
    )
  );

describe("the chat's preferences", () => {
  it.effect("follow the user from one project to the next (ADR 0062)", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const user = yield* fs.makeTempDirectoryScoped();
      const one = yield* fs.makeTempDirectoryScoped();
      const two = yield* fs.makeTempDirectoryScoped();
      yield* Effect.scoped(
        ChatPreferences.use((p) =>
          p.setDefaults({ agentId: "codex", model: "gpt" })
        ).pipe(Effect.provide(preferencesOf(user, one)))
      );
      const defaults = yield* defaultsOf(user, two);
      assert.deepStrictEqual(defaults, { agentId: "codex", model: "gpt" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "are read from a project's state directory while the user's has none",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const user = yield* fs.makeTempDirectoryScoped();
        const project = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(path.join(project, "chat"));
        yield* fs.writeFileString(
          path.join(project, "chat", "preferences.json"),
          JSON.stringify({ agents: [], defaults: { agentId: "claude-code" } })
        );
        const defaults = yield* defaultsOf(user, project);
        assert.deepStrictEqual(defaults, { agentId: "claude-code" });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
