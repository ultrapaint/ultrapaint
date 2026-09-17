import { createServer } from "node:net";
import { NodeServices } from "@effect/platform-node";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import type { Settings } from "@ultrapaint/contracts/settings";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import {
  RpcClient,
  type RpcClientError,
  RpcSerialization,
} from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { ServerConfig } from "../config.ts";
import { runCommand } from "../process.ts";
import { ServerLive } from "../server.ts";

const HOME_SCREEN = `export default function Home() {
  return (
    <main className="p-4">
      <h1 className="text-xl">Hello</h1>
    </main>
  );
}
`;

const BUTTON_COMPONENT = `export interface ButtonProps {
  disabled?: boolean;
  label: string;
  variant?: "primary" | "ghost";
}

/** A button. */
export function Button(props: ButtonProps) {
  return props.disabled ? null : null;
}
`;

export const freePort = Effect.callback<number>((resume) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resume(Effect.succeed(port)));
  });
});

/** A throwaway git repository with a designs package and one committed screen. */
export const makeRepository = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // macOS temp directories are symlinks; the server resolves them, so the fixture does too.
  const repo = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const write = (rel: string, content: string) =>
    Effect.andThen(
      fs.makeDirectory(path.dirname(path.join(repo, rel)), { recursive: true }),
      fs.writeFileString(path.join(repo, rel), content)
    );
  yield* write("package.json", '{ "name": "fixture", "private": true }\n');
  yield* write("designs/package.json", '{ "name": "designs" }\n');
  yield* write("designs/home.tsx", HOME_SCREEN);
  yield* write("ui/button.tsx", BUTTON_COMPONENT);
  const git = (...args: string[]) => runCommand("git", args, { cwd: repo });
  yield* git("init", "-q", "-b", "main");
  yield* git("config", "user.email", "test@example.com");
  yield* git("config", "user.name", "Test");
  yield* git("config", "commit.gpgsign", "false");
  yield* git("add", "-A");
  yield* git("commit", "-q", "-m", "init");
  return repo;
});

export class TestEnv extends Context.Service<
  TestEnv,
  {
    readonly client: RpcClient.FromGroup<
      typeof UltrapaintRpcs,
      RpcClientError.RpcClientError
    >;
    readonly home: string;
    readonly port: number;
    readonly repo: string;
    readonly settings: Settings;
  }
>()("ultrapaint/server/testing/TestEnv") {}

/**
 * The real server on a free loopback port with its own home directory, a fixture repository
 * and a real RPC client over WebSocket. The fake ACP agent is registered as `fake`, and as
 * `fake-auth` and `fake-load` with the matching behaviour switched on.
 */
export const TestServer = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped();
    const repo = yield* makeRepository;
    const port = yield* freePort;
    const fakeAgent = path.resolve(
      import.meta.dirname,
      "../../../../packages/acp/testing/fake-agent.mjs"
    );
    yield* fs.makeDirectory(path.join(home, "agents"), { recursive: true });
    const agents = {
      fake: {},
      "fake-auth": { FAKE_AGENT_AUTH: "1" },
      "fake-load": { FAKE_AGENT_LOAD: "1" },
    };
    for (const [id, env] of Object.entries(agents)) {
      yield* fs.writeFileString(
        path.join(home, "agents", `${id}.json`),
        JSON.stringify({
          args: [fakeAgent],
          command: process.execPath,
          env,
          id,
          name: "Fake",
        })
      );
    }

    const server = ServerLive.pipe(
      Layer.provide(
        Layer.succeed(ServerConfig, {
          home,
          port,
          version: "test",
          webDist: undefined,
        })
      )
    );
    const protocol = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}/ws`)),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
      Layer.provide(RpcSerialization.layerJson)
    );
    const env = Layer.effect(
      TestEnv,
      Effect.map(RpcClient.make(UltrapaintRpcs), (client) => ({
        client,
        home,
        port,
        repo,
        settings: {
          componentPackages: [],
          designsDir: "designs",
          hostCss: [],
          libraryDirs: [],
          repoPath: repo,
          theme: "light",
        } satisfies Settings,
      }))
    );
    // The client connects only after the server layer is up.
    return env.pipe(Layer.provide(protocol), Layer.provide(server));
  })
).pipe(Layer.provideMerge(NodeServices.layer));
