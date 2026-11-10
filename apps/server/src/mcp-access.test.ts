import { homedir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { ServerConfig, type StorageTarget } from "./config.ts";
import { ListenPort } from "./listen-port.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { Storage } from "./services/storage.ts";
import { STATE_DIR_NAME } from "./storage-resolve.ts";

const TOKEN_RE = /^mcp_[A-Za-z0-9_-]{43}$/;

/** A token as the server makes them, as an earlier run would have left it. */
const LEFT = `mcp_${"a".repeat(43)}`;

/**
 * The access rules alone, with the project's state in `home` unless `storage` says where; `mcp`
 * off is a server started with `--no-mcp`.
 */
const accessIn = (
  home: string,
  options: { readonly mcp?: boolean; readonly storage?: StorageTarget } = {}
) =>
  McpAccess.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(Storage.layer, ListenPort.layer)),
    Layer.provide(
      ServerConfig.layerTest({
        cwd: home,
        machine: { home: homedir() },
        mcp: options.mcp ?? true,
        storage: options.storage ?? { home, mode: "managed" },
        userDir: home,
      })
    )
  );

describe("McpAccess", () => {
  it.effect(
    "makes the project's token from 256 random bits and keeps it to its owner",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        yield* Effect.gen(function* () {
          const access = yield* McpAccess;
          yield* (yield* ListenPort).listening(1);
          const token = yield* access.external;
          assert.match(token, TOKEN_RE);
          assert.isFalse((yield* access.connection).replaced);
          assert.isTrue(yield* access.allows(token));
          // As long as the token, and one character off.
          assert.isFalse(yield* access.allows(`${token.slice(0, -1)}x`));
          assert.isFalse(yield* access.allows(token.slice(0, -1)));
          const thread = yield* Effect.scoped(access.issue("thread_a_00001"));
          assert.match(thread, TOKEN_RE);
          assert.notStrictEqual(thread, token);
        }).pipe(Effect.provide(accessIn(home)));
        const info = yield* fs.stat(path.join(home, "mcp-token"));
        // The permission bits, without the file type above them.
        assert.strictEqual(Number(info.mode) % 0o1000, 0o600);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect("replaces a token made the old, guessable way", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const old = "mcp_lx3k9a_4f2k1";
      yield* fs.writeFileString(path.join(home, "mcp-token"), `${old}\n`);
      yield* Effect.gen(function* () {
        const access = yield* McpAccess;
        yield* (yield* ListenPort).listening(1);
        assert.isFalse(yield* access.allows(old));
        assert.match(yield* access.external, TOKEN_RE);
        // The settings tell the user to give the agents outside the new one.
        assert.isTrue((yield* access.connection).replaced);
      }).pipe(Effect.provide(accessIn(home)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "keeps the token it handed out when the unsaved session is saved",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sessionDir = yield* fs.makeTempDirectoryScoped();
        const repo = yield* fs.makeTempDirectoryScoped();
        yield* Effect.gen(function* () {
          const access = yield* McpAccess;
          yield* (yield* ListenPort).listening(1);
          const token = yield* access.external;
          yield* (yield* Storage).promote(path.join(repo, "ultrapaint.json"));
          // The agent outside that was given it goes on calling.
          assert.isTrue(yield* access.allows(token));
          assert.strictEqual((yield* access.connection).token, token);
          // Where the state now is, for the next start to find.
          const kept = yield* fs.readFileString(
            path.join(repo, STATE_DIR_NAME, "mcp-token")
          );
          assert.strictEqual(kept.trim(), token);
        }).pipe(
          Effect.provide(
            accessIn(sessionDir, {
              storage: { mode: "ephemeral", sessionDir },
            })
          )
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "takes the token a saved project already has, over the unsaved session's",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sessionDir = yield* fs.makeTempDirectoryScoped();
        const repo = yield* fs.makeTempDirectoryScoped();
        const state = path.join(repo, STATE_DIR_NAME);
        yield* fs.makeDirectory(state);
        yield* fs.writeFileString(path.join(state, "mcp-token"), `${LEFT}\n`);
        yield* Effect.gen(function* () {
          const access = yield* McpAccess;
          const session = yield* access.external;
          yield* (yield* Storage).promote(path.join(repo, "ultrapaint.json"));
          assert.strictEqual(yield* access.external, LEFT);
          assert.isFalse(yield* access.allows(session));
        }).pipe(
          Effect.provide(
            accessIn(sessionDir, {
              storage: { mode: "ephemeral", sessionDir },
            })
          )
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "turns the project's token away when the server was started without its MCP server",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        // Left by a run that had the MCP server.
        yield* fs.writeFileString(path.join(home, "mcp-token"), `${LEFT}\n`);
        yield* Effect.gen(function* () {
          const access = yield* McpAccess;
          yield* (yield* ListenPort).listening(1);
          assert.isFalse(yield* access.allows(LEFT));
          assert.deepInclude(yield* access.connection, {
            enabled: false,
            token: "",
          });
          // A thread's own token is its session's, whatever the project's is.
          const thread = yield* access.issue("thread_a_00001");
          assert.isTrue(yield* access.allows(thread));
        }).pipe(Effect.provide(accessIn(home, { mcp: false })));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
