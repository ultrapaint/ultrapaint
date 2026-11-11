import { NodeServices } from "@effect/platform-node";
import { UltrapaintRpcs } from "@ultrapaint/contracts/rpc";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { Thread, ThreadItem } from "@ultrapaint/contracts/threads";
import {
  Context,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Path,
  type PlatformError,
  Stream,
  SubscriptionRef,
} from "effect";
import { RpcClient, type RpcClientError, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { ServerConfig, type StorageTarget } from "../config.ts";
import { EventBus } from "../events.ts";
import { ListenPort } from "../listen-port.ts";
import { runCommand } from "../process.ts";
import { ServerLive } from "../server.ts";
import { waitFor } from "./wait-for.ts";

const HOME_PAGE = `${JSON.stringify(
  {
    root: {
      children: [
        {
          id: "heading",
          level: 1,
          role: "heading",
          text: "Hello",
          type: "text",
        },
      ],
      id: "root",
      padding: 16,
      type: "page",
    },
    version: 1,
  },
  null,
  2
)}\n`;

/**
 * A file of the application's code, which nothing reads as a component (the components are the
 * designs' files, ADR 0041): what a design is implemented in, and what the setup restores.
 */
const APP_CODE = `export interface ButtonProps {
  disabled?: boolean;
  label: string;
  variant?: "primary" | "ghost";
}

/** A button. */
export function Button(props: ButtonProps) {
  return props.disabled ? null : null;
}
`;

/**
 * A throwaway project folder with a designs package and one page. With `git`, a repository
 * with all of it committed; without, a plain folder, as a design started from nothing is.
 */
export const makeFixture = Effect.fnUntraced(function* (options: {
  readonly git: boolean;
}) {
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
  yield* write("designs/home.page.json", HOME_PAGE);
  yield* write("ui/button.tsx", APP_CODE);
  if (!options.git) {
    return repo;
  }
  const git = (...args: string[]) => runCommand("git", args, { cwd: repo });
  yield* git("init", "-q", "-b", "main");
  yield* git("config", "user.email", "test@example.com");
  yield* git("config", "user.name", "Test");
  yield* git("config", "commit.gpgsign", "false");
  yield* git("add", "-A");
  yield* git("commit", "-q", "-m", "init");
  return repo;
});

/** A throwaway git repository with a designs package and one committed page. */
export const makeRepository = makeFixture({ git: true });

export class TestEnv extends Context.Service<
  TestEnv,
  {
    readonly client: RpcClient.FromGroup<
      typeof UltrapaintRpcs,
      RpcClientError.RpcClientError
    >;
    /**
     * How many subscriptions the server has held since it started: an editor's stream is heard
     * from once this goes up, counted from the start so that none is missed.
     */
    readonly follows: SubscriptionRef.SubscriptionRef<number>;
    readonly home: string;
    readonly port: number;
    readonly repo: string;
    readonly settings: Settings;
  }
>()("ultrapaint/server/testing/TestEnv") {}

/**
 * The subscriptions the server holds, counted in the background from now (`TestEnv.follows`):
 * counted from before any test runs, one held the moment a test asks for it is counted all the
 * same, where one listened for only then may be missed.
 */
export const countFollows = Effect.fnUntraced(function* (
  followed: Stream.Stream<unknown>
) {
  const follows = yield* SubscriptionRef.make(0);
  yield* followed.pipe(
    Stream.runForEach(() => SubscriptionRef.update(follows, (n) => n + 1)),
    Effect.forkScoped({ startImmediately: true })
  );
  return follows;
});

/** The RPC protocol over a WebSocket of its own to the server on `port`, as an editor has. */
const socketProtocol = (port: number) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(`ws://127.0.0.1:${port}/ws`)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson)
  );

/** Another editor on the test's server: a client over a socket of its own, open while the scope is. */
export const anotherClient = Effect.gen(function* () {
  const { port } = yield* TestEnv;
  const context = yield* Layer.build(socketProtocol(port));
  return yield* RpcClient.make(UltrapaintRpcs).pipe(Effect.provide(context));
});

/**
 * The real server on a loopback port with its own home directory, a fixture repository and a
 * real RPC client over WebSocket. The fake ACP agent is registered as `fake`, and as `fake-auth`
 * and `fake-load` with the matching behaviour switched on. The server binds port 0 itself, as
 * the desktop app starts it: a port picked beforehand and let go of could be taken by another
 * test's server before this one listens.
 */
export const makeTestServer = (
  /** Runs before the server starts, so it can also put a configuration file in place. */
  storageFor: (dirs: {
    readonly home: string;
    readonly repo: string;
  }) => Effect.Effect<
    StorageTarget,
    PlatformError.PlatformError,
    FileSystem.FileSystem
  >,
  /** `git: false` makes the fixture a plain folder, without `git init`. */
  options: { readonly git?: boolean } = {}
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const repo = yield* makeFixture({ git: options.git ?? true });
      const storage = yield* Effect.orDie(storageFor({ home, repo }));
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
            // The fake agent and its SDK live in this checkout, outside the fixture repository.
            stateDirs: [path.resolve(import.meta.dirname, "../../../..")],
          })
        );
      }

      const server = ServerLive.pipe(
        Layer.provide(
          ServerConfig.layerTest({
            briefing: true,
            cwd: repo,
            // The fixture's home: the preview is generated under its cache, not the user's.
            machine: { home, path: process.env.PATH ?? "" },
            mcp: true,
            port: 0,
            storage,
            userDir: home,
          })
        )
      );
      /** The port the server listens on, once it does. */
      const listening = Effect.flatMap(ListenPort, (port) => port.get);
      const protocol = Layer.unwrap(Effect.map(listening, socketProtocol));
      const env = Layer.effect(
        TestEnv,
        Effect.gen(function* () {
          const [client, port, events] = yield* Effect.all([
            RpcClient.make(UltrapaintRpcs),
            listening,
            EventBus,
          ]);
          const follows = yield* countFollows(events.followed);
          return {
            client,
            follows,
            home,
            port,
            repo,
            settings: {
              designsDir: "designs",
              hostCss: [],
              libraryDirs: [],
              repoPath: repo,
            } satisfies Settings,
          };
        })
      );
      // The client connects only after the server layer is up. Its `ListenPort` and its
      // `EventBus` are the server's: a layer is built once for the whole of a build.
      return env.pipe(
        Layer.provide(protocol),
        Layer.provide(Layer.mergeAll(ListenPort.layer, EventBus.layer)),
        Layer.provide(server)
      );
    })
  ).pipe(Layer.provideMerge(NodeServices.layer));

/** The `--home` arrangement: settings and state in one home directory. */
export const TestServer = makeTestServer(({ home }) =>
  Effect.succeed({ home, mode: "managed" })
);

/**
 * Consumes an event stream in the background once the server holds its subscription, as the
 * server counts them (`follows`): an answer to a request sent after it says only that the server
 * has the request, and a stream subscribes when first pulled, which may come later.
 */
export const subscribed = <A, E, R>(consume: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { follows } = yield* TestEnv;
    const before = yield* SubscriptionRef.get(follows);
    const fiber = yield* Effect.forkScoped(consume, { startImmediately: true });
    // The count's changes start with its value now: one the server took meanwhile is seen.
    const holds = SubscriptionRef.changes(follows).pipe(
      Stream.filter((n) => n > before),
      Stream.runHead
    );
    // A stream that ends before the server holds it has nothing more to wait for.
    yield* Effect.raceFirst(holds, Fiber.await(fiber));
    return fiber;
  });

/** The first value of an event stream that arrives after `trigger` has run. */
export const nextEvent = <A, E, B, E2, R2>(
  stream: Stream.Stream<A, E>,
  trigger: Effect.Effect<B, E2, R2>
) =>
  Effect.gen(function* () {
    const first = yield* subscribed(
      Stream.runHead(stream).pipe(Effect.timeout("20 seconds"))
    );
    const result = yield* trigger;
    const event = yield* Fiber.join(first);
    return { event, result };
  });

/** The thread and its transcript, asked for over the socket until `done` holds of them. */
export const waitForThread = (
  threadId: string,
  done: (thread: Thread, items: readonly ThreadItem[]) => boolean
) =>
  Effect.flatMap(TestEnv, ({ client }) =>
    waitFor(
      Effect.all({
        items: client["threads.items"]({ threadId }),
        // The thread first: the server writes an item before the status it leads to, so a
        // transcript read after the thread holds whatever led to the status read.
        thread: Effect.map(client["threads.list"](), (all) =>
          all.find((t) => t.id === threadId)
        ),
      }),
      ({ items, thread }) => thread !== undefined && done(thread, items)
    )
  );
