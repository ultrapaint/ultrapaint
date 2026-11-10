import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { AppLog } from "./app-log.ts";
import { ServerConfig } from "./config.ts";
import { EventBus } from "./events.ts";
import { ChatPreferences } from "./services/threads/chat-preferences.ts";

/** The preferences as a project's server has them, for the user in `userDir`. */
const preferencesOf = (userDir: string) =>
  ChatPreferences.layer.pipe(
    Layer.provide(AppLog.layer),
    Layer.provide(EventBus.layer),
    Layer.provide(ServerConfig.layerTest({ userDir }))
  );

describe("the chat's preferences", () => {
  it.effect("follow the user from one project to the next (ADR 0062)", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const user = yield* fs.makeTempDirectoryScoped();
      yield* Effect.scoped(
        ChatPreferences.use((p) =>
          p.setDefaults({ agentId: "codex", model: "gpt" })
        ).pipe(Effect.provide(preferencesOf(user)))
      );
      // Another project's server, started later for the same user.
      const defaults = yield* Effect.scoped(
        ChatPreferences.use((p) => p.defaults).pipe(
          Effect.provide(preferencesOf(user))
        )
      );
      assert.deepStrictEqual(defaults, { agentId: "codex", model: "gpt" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

/** An agent as its last session offered it: a model, an effort and two modes. */
const OFFERED = {
  agentId: "claude-code",
  configOptions: [
    {
      currentValue: "sonnet",
      id: "model",
      name: "Model",
      options: [
        { name: "Opus", value: "opus" },
        { name: "Sonnet", value: "sonnet" },
      ],
      type: "select" as const,
    },
    {
      category: "thought_level",
      currentValue: "medium",
      id: "effort",
      name: "Effort",
      options: [
        { name: "Medium", value: "medium" },
        { name: "High", value: "high" },
      ],
      type: "select" as const,
    },
  ],
  currentModeId: "default",
  modes: [
    { id: "default", name: "Default" },
    { id: "plan", name: "Plan" },
    { id: "acceptEdits", name: "Accept edits" },
  ],
};

/** What a new thread of `agentId` starts with, the defaults set to `defaults`. */
const startsWith = (
  defaults: Parameters<ChatPreferences["Service"]["setDefaults"]>[0],
  agentId = "claude-code"
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const user = yield* fs.makeTempDirectoryScoped();
    return yield* Effect.scoped(
      ChatPreferences.use((p) =>
        Effect.gen(function* () {
          yield* p.remember(OFFERED);
          yield* p.remember({ ...OFFERED, agentId: "other" });
          yield* p.setDefaults(defaults);
          const options = yield* p.optionsFor(agentId);
          const current = (id: string) =>
            options.configOptions?.find((o) => o.id === id)?.currentValue;
          return {
            effort: current("effort"),
            mode: options.currentModeId,
            model: current("model"),
          };
        })
      ).pipe(Effect.provide(preferencesOf(user)))
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("a new thread of the default agent (ADR 0063)", () => {
  it.effect("starts with the default model, effort and mode", () =>
    Effect.gen(function* () {
      const started = yield* startsWith({
        agentId: "claude-code",
        effort: "high",
        modeId: "plan",
        model: "opus",
      });
      assert.deepStrictEqual(started, {
        effort: "high",
        mode: "plan",
        model: "opus",
      });
    })
  );

  it.effect("keeps the agent's own where it doesn't offer the default", () =>
    Effect.gen(function* () {
      const started = yield* startsWith({
        agentId: "claude-code",
        effort: "max",
        modeId: "yolo",
      });
      assert.deepStrictEqual(started, {
        effort: "medium",
        mode: "default",
        model: "sonnet",
      });
    })
  );

  it.effect("leaves another agent as it last offered", () =>
    Effect.gen(function* () {
      const started = yield* startsWith(
        { agentId: "claude-code", effort: "high", modeId: "plan" },
        "other"
      );
      assert.deepStrictEqual(started, {
        effort: "medium",
        mode: "default",
        model: "sonnet",
      });
    })
  );
});
