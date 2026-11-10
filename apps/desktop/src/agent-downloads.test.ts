import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option } from "effect";
import { AgentDownloads, safeArchive } from "./agent-downloads.ts";
import type { AgentRelease } from "./agent-releases.ts";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** A server on loopback that serves `files` by path, as a release bucket would. */
const serve = (files: Readonly<Record<string, Uint8Array>>) =>
  Effect.acquireRelease(
    Effect.callback<{ close: () => void; url: string }>((resume) => {
      const server = createServer((request, response) => {
        const body = files[request.url ?? ""];
        if (!body) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.end(body);
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        resume(
          Effect.succeed({
            close: () => server.close(),
            url: `http://127.0.0.1:${port}`,
          })
        );
      });
    }),
    (server) => Effect.sync(server.close)
  );

const BINARY = new TextEncoder().encode(
  `#!/bin/sh\necho fake claude\n# ${"padding ".repeat(4000)}\n`
);
const ZST = new Uint8Array(zstdCompressSync(BINARY));

const claudeRelease = (
  url: string,
  zstSha = sha256(ZST),
  version = "9.9.9"
): AgentRelease => ({
  kind: "zst-binary",
  sha256: sha256(BINARY),
  size: BINARY.length,
  url: `${url}/claude.zst`,
  version,
  zstSha256: zstSha,
  zstSize: ZST.length,
});

/** A Codex package as its release workflow lays one out, gzipped. */
const codexPackage = (dir: string) => {
  const root = path.join(dir, "package");
  mkdirSync(path.join(root, "bin"), { recursive: true });
  writeFileSync(
    path.join(root, "bin", "codex"),
    "#!/bin/sh\necho fake codex\n",
    {
      mode: 0o755,
    }
  );
  writeFileSync(
    path.join(root, "codex-package.json"),
    JSON.stringify({
      entrypoint: "bin/codex",
      layoutVersion: 1,
      target: "x86_64-test",
      version: "0.0.1",
    })
  );
  const archive = path.join(dir, "codex.tar.gz");
  execFileSync("tar", [
    "-czf",
    archive,
    "-C",
    root,
    "bin",
    "codex-package.json",
  ]);
  return new Uint8Array(readFileSync(archive));
};

const downloadsIn = (
  dir: string,
  releases: Readonly<Record<string, AgentRelease>>
) =>
  AgentDownloads.layer(dir, releases).pipe(Layer.provide(NodeServices.layer));

describe("AgentDownloads", () => {
  it.effect(
    "downloads Claude Code, checks both hashes, and installs it where it runs",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const server = yield* serve({ "/claude.zst": ZST });
        const downloads = yield* Effect.provide(
          AgentDownloads,
          downloadsIn(dir, { "claude-code": claudeRelease(server.url) })
        );
        assert.isTrue(Option.isNone(yield* downloads.installed("claude-code")));
        const executable = yield* downloads.download("claude-code");
        assert.strictEqual(
          executable,
          path.join(dir, "claude-code", "9.9.9", "claude")
        );
        assert.strictEqual(
          execFileSync(executable).toString().trim(),
          "fake claude"
        );
        assert.deepStrictEqual(
          yield* downloads.installed("claude-code"),
          Option.some(executable)
        );
        // Nothing is left of the download but the agent and its record.
        assert.deepStrictEqual(
          (yield* fs.readDirectory(path.join(dir, "claude-code"))).sort(),
          ["9.9.9", "installed.json"]
        );
        assert.isTrue(Option.isNone(yield* downloads.progress("claude-code")));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "counts a version the app no longer pins as not installed, and replaces it with the pinned one",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const server = yield* serve({ "/claude.zst": ZST });
        const before = yield* Effect.provide(
          AgentDownloads,
          downloadsIn(dir, { "claude-code": claudeRelease(server.url) })
        );
        yield* before.download("claude-code");
        // The app, updated: it pins the next version.
        const after = yield* Effect.provide(
          AgentDownloads,
          downloadsIn(dir, {
            "claude-code": claudeRelease(server.url, sha256(ZST), "9.9.10"),
          })
        );
        assert.isTrue(Option.isNone(yield* after.installed("claude-code")));
        const executable = yield* after.download("claude-code");
        assert.strictEqual(
          executable,
          path.join(dir, "claude-code", "9.9.10", "claude")
        );
        assert.deepStrictEqual(
          yield* after.installed("claude-code"),
          Option.some(executable)
        );
        // The version it replaces goes with it.
        assert.deepStrictEqual(
          (yield* fs.readDirectory(path.join(dir, "claude-code"))).sort(),
          ["9.9.10", "installed.json"]
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "installs nothing when the download is not the release it should be",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const server = yield* serve({ "/claude.zst": ZST });
        const downloads = yield* Effect.provide(
          AgentDownloads,
          downloadsIn(dir, {
            "claude-code": claudeRelease(server.url, "0".repeat(64)),
          })
        );
        const error = yield* Effect.flip(downloads.download("claude-code"));
        assert.strictEqual(error._tag, "DownloadError");
        assert.include(error.message, "SHA-256 differs");
        assert.isTrue(Option.isNone(yield* downloads.installed("claude-code")));
        assert.deepStrictEqual(
          yield* fs.readDirectory(path.join(dir, "claude-code")),
          []
        );
        const progress = Option.getOrThrow(
          yield* downloads.progress("claude-code")
        );
        assert.strictEqual(progress.phase, "failed");

        const missing = yield* Effect.flip(downloads.download("codex"));
        assert.include(missing.message, "no release of this agent");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.effect(
    "unpacks the Codex package and runs the executable its manifest names",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const work = yield* fs.makeTempDirectoryScoped();
        const archive = codexPackage(work);
        const server = yield* serve({ "/codex.tar.gz": archive });
        const downloads = yield* Effect.provide(
          AgentDownloads,
          downloadsIn(dir, {
            codex: {
              entrypoint: "bin/codex",
              kind: "tar-gz-package",
              sha256: sha256(archive),
              size: archive.length,
              target: "x86_64-test",
              url: `${server.url}/codex.tar.gz`,
              version: "0.0.1",
            },
          })
        );
        const executable = yield* downloads.download("codex");
        assert.strictEqual(
          executable,
          path.join(dir, "codex", "0.0.1", "bin", "codex")
        );
        assert.strictEqual(
          execFileSync(executable).toString().trim(),
          "fake codex"
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});

describe("safeArchive", () => {
  it("takes plain files and directories inside the archive only", () => {
    assert.isTrue(
      safeArchive(
        ["bin/", "bin/codex", "codex-package.json"],
        [
          "drwxr-xr-x bin/",
          "-rwxr-xr-x bin/codex",
          "-rw-r--r-- codex-package.json",
        ]
      )
    );
    assert.isFalse(safeArchive(["../evil"], ["-rw-r--r-- ../evil"]));
    assert.isFalse(safeArchive(["/etc/passwd"], ["-rw-r--r-- /etc/passwd"]));
    assert.isFalse(safeArchive(["link"], ["lrwxrwxrwx link -> /etc"]));
    assert.isFalse(safeArchive([], []));
  });
});
