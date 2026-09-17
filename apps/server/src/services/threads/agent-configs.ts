import { builtInAgents } from "@ultrapaint/acp/configs";
import { NotFound } from "@ultrapaint/contracts/errors";
import type { AgentConfig } from "@ultrapaint/contracts/threads";
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ServerConfig } from "../../config.ts";

/** What a user writes in `~/.ultrapaint/agents/<name>.json`; everything but the launch is optional. */
const CustomAgent = Schema.fromJsonString(
  Schema.Struct({
    args: Schema.optional(Schema.Array(Schema.String)),
    authHint: Schema.optional(Schema.String),
    command: Schema.String,
    env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    id: Schema.String,
    name: Schema.String,
    package: Schema.optional(Schema.String),
  })
);
const decodeCustomAgent = Schema.decodeUnknownEffect(CustomAgent);

/**
 * Launch configurations are data: the built-in ones plus any JSON file under the home
 * directory. They are read on every call so a new file shows up without a restart.
 */
export class AgentConfigs extends Context.Service<
  AgentConfigs,
  {
    readonly get: (id: string) => Effect.Effect<AgentConfig, NotFound>;
    readonly list: Effect.Effect<AgentConfig[]>;
  }
>()("ultrapaint/server/AgentConfigs") {
  static readonly layer = Layer.effect(
    AgentConfigs,
    Effect.gen(function* () {
      const { home } = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(home, "agents");
      yield* Effect.orDie(fs.makeDirectory(dir, { recursive: true }));

      const readCustom = (name: string) =>
        fs.readFileString(path.join(dir, name)).pipe(
          Effect.flatMap(decodeCustomAgent),
          Effect.map(
            (cfg): AgentConfig => ({
              args: cfg.args ?? [],
              builtIn: false,
              command: cfg.command,
              env: cfg.env ?? {},
              id: cfg.id,
              name: cfg.name,
              ...(cfg.package ? { package: cfg.package } : {}),
              ...(cfg.authHint ? { authHint: cfg.authHint } : {}),
            })
          ),
          // One malformed file must not hide the other agents.
          Effect.option
        );

      const list = Effect.gen(function* () {
        const names = yield* Effect.orElseSucceed(
          fs.readDirectory(dir),
          (): string[] => []
        );
        const custom = yield* Effect.forEach(
          names.filter((n) => n.endsWith(".json")).sort(),
          readCustom
        );
        return [
          ...builtInAgents,
          ...custom.flatMap((c) => (c._tag === "Some" ? [c.value] : [])),
        ];
      });

      return AgentConfigs.of({
        get: (id) =>
          Effect.flatMap(list, (agents) => {
            const found = agents.find((a) => a.id === id);
            return found
              ? Effect.succeed(found)
              : Effect.fail(new NotFound({ message: `unknown agent ${id}` }));
          }),
        list,
      });
    })
  );
}
