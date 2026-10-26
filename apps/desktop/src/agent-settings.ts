/**
 * The app's own settings for the agents, in its data directory (`agents.json`): where each
 * agent's executable is when it is not on the PATH, and the key Claude Code signs in with when
 * the user gave one, encrypted by the system's keychain (1.7). Nothing here is written in a
 * project, nor anywhere the agents keep their own settings.
 */
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
} from "effect";
import { writeAtomic } from "./atomic-write.ts";
import { StoreError } from "./errors.ts";

export const AgentSetting = Schema.Struct({
  /** The key the agent signs in with, encrypted; base64. */
  apiKey: Schema.optional(Schema.String),
  /** The executable to run, in place of the one on the PATH. */
  path: Schema.optional(Schema.String),
});
export type AgentSetting = typeof AgentSetting.Type;

const SettingsFile = Schema.fromJsonString(
  Schema.Struct({
    agents: Schema.Record(Schema.String, AgentSetting),
    version: Schema.Literal(1),
  })
);
const decodeFile = Schema.decodeUnknownEffect(SettingsFile);
const encodeFile = Schema.encodeEffect(SettingsFile);

export const AGENT_SETTINGS_FILE = "agents.json";

export class AgentSettings extends Context.Service<
  AgentSettings,
  {
    readonly get: (id: string) => Effect.Effect<AgentSetting, StoreError>;
    /** Changes one agent's settings; an `undefined` field is taken away. */
    readonly update: (
      id: string,
      change: (setting: AgentSetting) => AgentSetting
    ) => Effect.Effect<void, StoreError>;
  }
>()("ultrapaint/desktop/AgentSettings") {
  static readonly layer = (dir: string) =>
    Layer.effect(
      AgentSettings,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = path.join(dir, AGENT_SETTINGS_FILE);
        const lock = yield* Semaphore.make(1);
        const fail = (what: string) => (error: { message: string }) =>
          new StoreError({ message: `${what} ${file}: ${error.message}` });

        const read = Effect.gen(function* () {
          if (!(yield* fs.exists(file))) {
            return {} as Record<string, AgentSetting>;
          }
          return (yield* decodeFile(yield* fs.readFileString(file))).agents;
        }).pipe(
          Effect.mapError(fail("the agents' settings could not be read from"))
        );

        const update = Effect.fn("AgentSettings.update")(
          function* (
            id: string,
            change: (setting: AgentSetting) => AgentSetting
          ) {
            const agents = yield* read;
            const next = change(agents[id] ?? {});
            const text = yield* encodeFile({
              agents: { ...agents, [id]: next },
              version: 1,
            });
            // Readable by the user alone: the key, encrypted as it is, is theirs.
            yield* writeAtomic(file, `${text}\n`, { mode: 0o600 }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path)
            );
          },
          Effect.mapError(fail("the agents' settings could not be written to")),
          lock.withPermits(1)
        );

        return AgentSettings.of({
          get: (id) => Effect.map(read, (agents) => agents[id] ?? {}),
          update,
        });
      })
    );
}
