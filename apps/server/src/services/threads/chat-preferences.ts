import {
  type AgentOptions,
  type ChatDefaults,
  ChatPreferencesFile,
  type ConfigOption,
  isEffortOption,
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

type Stored = typeof ChatPreferencesFile.Type;
const decodeStored = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ChatPreferencesFile)
);
const encodeStored = Schema.encodeEffect(
  Schema.fromJsonString(ChatPreferencesFile)
);

/** Where they are kept, in the user's directory: `~/.ultrapaint/chat/preferences.json`. */
const CHAT_PREFERENCES_FILE = ["chat", "preferences.json"] as const;

/** The options a thread starts with, before its session says otherwise. */
type ThreadOptions = Pick<Thread, "configOptions" | "currentModeId" | "modes">;

/**
 * What the chat knows about agents across threads: the agent and model a new thread starts
 * with, and the options each agent's sessions offer. The options are only known once a session
 * has started; remembering them is what lets a thread offer its models before it has one.
 *
 * They are the user's, not a project's (ADR 0062): kept in the user's directory, so a new
 * project offers the models the last one learnt, and the desktop app's start screen, which has
 * no server, reads them there.
 */
export class ChatPreferences extends Context.Service<
  ChatPreferences,
  {
    readonly defaults: Effect.Effect<ChatDefaults>;
    readonly options: Effect.Effect<readonly AgentOptions[]>;
    /**
     * The agent's remembered options; when it is the default agent, with the default model, effort
     * and mode chosen where it offers them.
     */
    readonly optionsFor: (agentId: string) => Effect.Effect<ThreadOptions>;
    readonly remember: (options: AgentOptions) => Effect.Effect<void>;
    readonly setDefaults: (defaults: ChatDefaults) => Effect.Effect<void>;
  }
>()("ultrapaint/server/ChatPreferences") {
  static readonly layer = Layer.effect(
    ChatPreferences,
    Effect.gen(function* () {
      const { userDir } = yield* ServerConfig;
      const log = yield* AppLog;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const file = path.join(userDir, ...CHAT_PREFERENCES_FILE);

      const empty: Stored = { agents: [], defaults: {} };
      const read = Effect.gen(function* () {
        if (yield* fs.exists(file)) {
          return yield* decodeStored(yield* fs.readFileString(file));
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

      /** The option `is` picks set to `value`, where the option offers it. */
      const choose = (
        options: readonly ConfigOption[],
        is: (option: ConfigOption) => boolean,
        value: string | undefined
      ) =>
        value === undefined
          ? options
          : options.map((o) =>
              is(o) && o.options.some((x) => x.value === value)
                ? { ...o, currentValue: value }
                : o
            );

      const optionsFor = (agentId: string) =>
        Effect.sync((): ThreadOptions => {
          const known = state.agents.find((a) => a.agentId === agentId);
          if (!known) {
            return {};
          }
          // The defaults are the default agent's: another agent starts as it last offered.
          const { effort, model, modeId } =
            state.defaults.agentId === agentId ? state.defaults : {};
          const configOptions = choose(
            choose(known.configOptions, isModelOption, model),
            isEffortOption,
            effort
          );
          const mode =
            modeId !== undefined && known.modes?.some((m) => m.id === modeId)
              ? modeId
              : startingMode(known.modes, known.currentModeId);
          return {
            configOptions: withNamedChoices(configOptions),
            currentModeId: mode,
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
