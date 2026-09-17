import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, Layer, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ServerConfig } from "./config.ts";
import { ServerLive } from "./server.ts";
import { resolveStorage } from "./storage-resolve.ts";

const VERSION = "0.1.0";

const serve = Command.make(
  "ultrapaint",
  {
    config: Flag.String("config").pipe(
      Flag.withDescription(
        "Configuration file (default: the nearest ultrapaint.json from the working directory up)"
      ),
      Flag.withFallbackConfig(Config.String("ULTRAPAINT_CONFIG")),
      Flag.optional
    ),
    ephemeral: Flag.Boolean("ephemeral").pipe(
      Flag.withDescription(
        "Save nothing, even when a configuration file exists"
      ),
      Flag.withDefault(false)
    ),
    home: Flag.String("home").pipe(
      Flag.withDescription(
        "Directory for settings and state, as the desktop app uses it"
      ),
      Flag.withFallbackConfig(Config.String("ULTRAPAINT_HOME")),
      Flag.optional
    ),
    port: Flag.Int("port").pipe(
      Flag.withDescription("Port to listen on, loopback only"),
      Flag.withFallbackConfig(Config.Int("ULTRAPAINT_PORT")),
      Flag.withDefault(4770)
    ),
    webDist: Flag.String("web-dist").pipe(
      Flag.withDescription("Built editor bundle to serve"),
      Flag.withFallbackConfig(Config.String("ULTRAPAINT_WEB_DIST")),
      Flag.optional
    ),
  },
  Effect.fn(function* ({ config, ephemeral, home, port, webDist }) {
    const cwd = process.cwd();
    const { storage, userDir } = yield* resolveStorage({
      config: Option.getOrUndefined(config),
      cwd,
      ephemeral,
      home: Option.getOrUndefined(home),
      userHome: process.env.HOME ?? cwd,
    });
    const resolved = ServerConfig.of({
      cwd,
      port,
      storage,
      userDir,
      version: VERSION,
      webDist: Option.getOrUndefined(webDist),
    });
    return yield* Layer.launch(
      ServerLive.pipe(Layer.provide(Layer.succeed(ServerConfig, resolved)))
    );
  })
).pipe(Command.withDescription("Local backend of the ultrapaint editor"));

serve.pipe(
  Command.run({ version: VERSION }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
