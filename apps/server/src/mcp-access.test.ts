import { homedir, tmpdir } from "node:os";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { ServerConfig } from "./config.ts";
import { McpAccess } from "./services/mcp/access.ts";
import { Storage } from "./services/storage.ts";

const TOKEN_RE = /^mcp_[A-Za-z0-9_-]{43}$/;

/** The access rules alone, with the project's state in `home`. */
const accessIn = (home: string) =>
  McpAccess.layer.pipe(
    Layer.provide(Storage.layer),
    Layer.provide(
      Layer.succeed(ServerConfig, {
        allowedHosts: [],
        briefing: true,
        cwd: home,
        discovery: false,
        host: "127.0.0.1",
        machine: {
          addresses: () => [],
          home: homedir(),
          node: process.execPath,
          path: process.env.PATH ?? "",
          tmpdir: tmpdir(),
          uid: process.getuid?.(),
        },
        mcp: true,
        port: 0,
        readyJson: false,
        storage: { home, mode: "managed" },
        token: "test",
        userDir: home,
        version: "test",
        webDist: undefined,
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
          const token = yield* access.external;
          assert.match(token, TOKEN_RE);
          assert.isFalse(yield* access.replaced);
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
        assert.isFalse(yield* access.allows(old));
        assert.match(yield* access.external, TOKEN_RE);
        // The settings tell the user to give the agents outside the new one.
        assert.isTrue(yield* access.replaced);
      }).pipe(Effect.provide(accessIn(home)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
