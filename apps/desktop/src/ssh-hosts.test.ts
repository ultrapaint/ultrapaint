import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { parseHostInput, parseSshConfig, readSshHosts } from "./ssh-hosts.ts";

describe("parseHostInput", () => {
  it("takes an alias, user@host and a port after the host", () => {
    assert.deepStrictEqual(parseHostInput("devbox"), { host: "devbox" });
    assert.deepStrictEqual(parseHostInput(" me@box.local "), {
      host: "me@box.local",
    });
    assert.deepStrictEqual(parseHostInput("me@box:2222"), {
      host: "me@box",
      port: 2222,
    });
  });

  it("keeps an IPv6 address's colons, in brackets or not", () => {
    assert.deepStrictEqual(parseHostInput("me@[::1]:2200"), {
      host: "me@::1",
      port: 2200,
    });
    assert.deepStrictEqual(parseHostInput("fe80::1"), { host: "fe80::1" });
  });

  it("refuses what ssh would read as a flag or as several arguments", () => {
    assert.isUndefined(parseHostInput(""));
    assert.isUndefined(parseHostInput("-oProxyCommand=evil"));
    assert.isUndefined(parseHostInput("box rm"));
    assert.isUndefined(parseHostInput("box:99999"));
    assert.isUndefined(parseHostInput("box:ssh"));
  });
});

describe("parseSshConfig", () => {
  it("lists Host aliases without patterns, and the files it includes", () => {
    const parsed = parseSshConfig(
      [
        "# a comment",
        "Include config.d/*",
        "Host devbox  build # the build machine",
        "  HostName 10.0.0.2",
        "Host *.internal !secret gpu?",
        "host=lowercase",
        'Host "quoted name"',
        "Match host other",
      ].join("\n")
    );
    assert.deepStrictEqual(parsed.aliases, [
      "devbox",
      "build",
      "lowercase",
      "quoted name",
    ]);
    assert.deepStrictEqual(parsed.includes, ["config.d/*"]);
  });
});

describe("readSshHosts", () => {
  it.effect(
    "follows Include relative to ~/.ssh and with a pattern, each file once",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const home = yield* fs.makeTempDirectoryScoped();
        const ssh = path.join(home, ".ssh");
        yield* fs.makeDirectory(path.join(ssh, "config.d"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          path.join(ssh, "config"),
          "Include config.d/*.conf ~/.ssh/config\nHost zeta alpha\n"
        );
        yield* fs.writeFileString(
          path.join(ssh, "config.d", "work.conf"),
          "Host work-box\n"
        );
        yield* fs.writeFileString(
          path.join(ssh, "config.d", "ignored.txt"),
          "Host not-included\n"
        );
        assert.deepStrictEqual(
          yield* readSshHosts(path.join(ssh, "config"), home),
          ["alpha", "work-box", "zeta"]
        );
        // No configuration is no hosts.
        assert.deepStrictEqual(
          yield* readSshHosts(path.join(home, "missing"), home),
          []
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
