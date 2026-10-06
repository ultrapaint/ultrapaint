import {
  AgentOptions,
  ChatDefaults,
  isModelOption,
  startingMode,
  type Thread,
  withNamedChoices,
} from "@ultrapaint/contracts/threads";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { AppLog } from "../../app-log.ts";
import { makeWriteAtomic } from "../../atomic-write.ts";
import { makeKeyedLock } from "../../keyed-lock.ts";
import { Storage } from "../storage.ts";

const Stored = Schema.Struct({
  agents: Schema.Array(AgentOptions),
  defaults: ChatDefaults,
});
type Stored = typeof Stored.Type;
const decodeStored = Schema.decodeUnknownEffect(Schema.fromJsonString(Stored));
const encodeStored = Schema.encodeEffect(Schema.fromJsonString(Stored));

/** The options a thread starts with, before its session says otherwise. */
export type ThreadOptions = Pick<
  Thread,
  "configOptions" | "currentModeId" | "modes"
>;

/**
 * What the chat knows about agents across threads: the agent and model a new thread starts
 * with, and the options each agent's sessions offer. The options are only known once a session
 * has started; remembering them is what lets a thread offer its models before it has one.
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
      const log = yield* AppLog;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      // Asked for on every write: saving an unsaved session moves the state directory.
      const file = Effect.map(storage.stateDir, (dir) =>
        path.join(dir, "chat", "preferences.json")
      );

      const empty: Stored = { agents: [], defaults: {} };
      const read = Effect.gen(function* () {
        const f = yield* file;
        if (!(yield* fs.exists(f))) {
          return empty;
        }
        return yield* decodeStored(yield* fs.readFileString(f));
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
          Effect.flatMap((json) =>
            Effect.flatMap(file, (f) => writeAtomic(f, json))
          ),
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
