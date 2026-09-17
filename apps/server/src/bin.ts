import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, Layer, Option, Path } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ServerConfig } from "./config.ts";
import { ServerLive } from "./server.ts";

const VERSION = "0.1.0";

const serve = Command.make(
  "ultrapaint",
  {
    home: Flag.String("home").pipe(
      Flag.withDescription("Tool state directory (default ~/.ultrapaint)"),
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
  Effect.fn(function* ({ home, port, webDist }) {
    const path = yield* Path.Path;
    const config = ServerConfig.of({
      home: Option.getOrElse(home, () =>
        path.join(process.env.HOME ?? process.cwd(), ".ultrapaint")
      ),
      port,
      version: VERSION,
      webDist: Option.getOrUndefined(webDist),
    });
    return yield* Layer.launch(
      ServerLive.pipe(Layer.provide(Layer.succeed(ServerConfig, config)))
    );
  })
).pipe(Command.withDescription("Local backend of the ultrapaint editor"));

serve.pipe(
  Command.run({ version: VERSION }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
);
