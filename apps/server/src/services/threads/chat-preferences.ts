import {
  type AgentOptions,
  type ChatDefaults,
  ChatPreferencesFile,
  isModelOption,
  startingMode,
  type Thread,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { AppLog } from "../../app-log.ts";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { ServerConfig } from "../../config.ts";
import { makeKeyedLock } from "../../keyed-lock.ts";
import { Storage } from "../storage.ts";

type Stored = typeof ChatPreferencesFile.Type;
const decodeStored = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ChatPreferencesFile)
);
const encodeStored = Schema.encodeEffect(
  Schema.fromJsonString(ChatPreferencesFile)
);

/** Where they are kept, in the user's directory: `~/.ultrapaint/chat/preferences.json`. */
export const CHAT_PREFERENCES_FILE = ["chat", "preferences.json"] as const;

/** The options a thread starts with, before its session says otherwise. */
type ThreadOptions = Pick<Thread, "configOptions" | "currentModeId" | "modes">;

/**
 * What the chat knows about agents across threads: the agent and model a new thread starts
 * with, and the options each agent's sessions offer. The options are only known once a session
 * has started; remembering them is what lets a thread offer its models before it has one.
 *
 * They are the user's, not a project's (ADR 0062): kept in the user's directory, so a new
 * project offers the models the last one learnt, and the desktop app's start screen, which has
 * no server, reads them there. A project's state directory held them before; that file is read
 * when the user's directory has none yet.
 */
export class ChatPreferences extends Context.Service<
  ChatPreferences,
  {
    readonly defaults: Effect.Effect<ChatDefaults>;
    readonly options: Effect.Effect<readonly AgentOptions[]>;
    /** The agent's remembered options, the default model chosen when it is the default agent. */
    readonly optionsFor: (agentId: string) => Effect.Effect<ThreadOptions>;
    readonly remember: (options: AgentOptions) => Effect.Effect<void>;
    readonly setDefaults: (defaults: ChatDefaults) => Effect.Effect<void>;
  }
>()("ultrapaint/server/ChatPreferences") {
  static readonly layer = Layer.effect(
    ChatPreferences,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const { userDir } = yield* ServerConfig;
      const log = yield* AppLog;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const file = path.join(userDir, ...CHAT_PREFERENCES_FILE);

      const empty: Stored = { agents: [], defaults: {} };
      const read = Effect.gen(function* () {
        const before = path.join(
          yield* storage.stateDir,
          ...CHAT_PREFERENCES_FILE
        );
        for (const from of [file, before]) {
          if (yield* fs.exists(from)) {
            return yield* decodeStored(yield* fs.readFileString(from));
          }
        }
        return empty;
      });
      let state = yield* read.pipe(
        // A file that cannot be read costs the preferences, not the chat.
        Effect.catch((error) =>
          Effect.as(
            log.log(
              "agent",
              "warn",
              `ignoring chat preferences: ${error.message}`
            ),
            empty
          )
        )
      );

      // One write at a time, so an older state cannot land after a newer one.
      const writes = makeKeyedLock();
      const save = writes.withLock(
        "preferences",
        Effect.suspend(() => encodeStored(state)).pipe(
          Effect.flatMap((json) => writeAtomic(file, json)),
          // What is in memory stays right; the next change writes it again.
          Effect.ignore({ log: true })
        )
      );

      const optionsFor = (agentId: string) =>
        Effect.sync((): ThreadOptions => {
          const known = state.agents.find((a) => a.agentId === agentId);
          if (!known) {
            return {};
          }
          const { agentId: defaultAgent, model } = state.defaults;
          const configOptions =
            defaultAgent === agentId && model !== undefined
              ? known.configOptions.map((o) =>
                  isModelOption(o) && o.options.some((x) => x.value === model)
                    ? { ...o, currentValue: model }
                    : o
                )
              : known.configOptions;
          return {
            configOptions: withNamedChoices(configOptions),
            currentModeId: startingMode(known.modes, known.currentModeId),
            modes: known.modes,
          };
        });

      return ChatPreferences.of({
        defaults: Effect.sync(() => state.defaults),
        options: Effect.sync(() => state.agents),
        optionsFor,
        remember: Effect.fn("ChatPreferences.remember")(function* (
          options: AgentOptions
        ) {
          state = {
            ...state,
            agents: [
              ...state.agents.filter((a) => a.agentId !== options.agentId),
              options,
            ],
          };
          yield* save;
        }),
        setDefaults: Effect.fn("ChatPreferences.setDefaults")(function* (
          defaults: ChatDefaults
        ) {
          state = { ...state, defaults };
          yield* save;
        }),
      });
    })
  );
}
