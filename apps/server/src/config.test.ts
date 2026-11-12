import { existsSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  hostNameOf,
  interfaceAddresses,
  isAllowedHost,
  ServerConfig,
} from "./config.ts";

const allowed = (
  name: string,
  host: string,
  addresses: readonly string[],
  extra?: readonly string[]
) => isAllowedHost(name, host, addresses, extra);

describe("the names the server answers to", () => {
  it("is loopback, and the address it is bound to", () => {
    for (const name of ["127.0.0.1", "[::1]", "localhost"]) {
      assert.isTrue(allowed(name, "127.0.0.1", ["192.168.1.5", "box"]), name);
    }
    assert.isFalse(allowed("192.168.1.5", "127.0.0.1", ["192.168.1.5"]));
    assert.isFalse(allowed("box", "127.0.0.1", ["box"]));
    assert.isTrue(allowed("192.168.1.5", "192.168.1.5", []));
    assert.isTrue(allowed("localhost", "192.168.1.5", []));
  });

  it("is every address of the machine and its names when bound to all", () => {
    const addresses = ["192.168.1.5", "fe80::1", "Box", "Box.local"];
    for (const name of [
      "192.168.1.5",
      "[fe80::1]",
      "box",
      "box.local",
      "127.0.0.1",
    ]) {
      assert.isTrue(allowed(name, "0.0.0.0", addresses), name);
    }
    assert.isFalse(allowed("0.0.0.0", "0.0.0.0", addresses));
    assert.isFalse(allowed("attacker.com", "0.0.0.0", addresses));
  });

  it("is the names the user allowed, a leading dot for a domain's subdomains", () => {
    const extra = ["editor.example.com", ".tailnet.ts.net"];
    assert.isTrue(allowed("editor.example.com", "0.0.0.0", [], extra));
    assert.isTrue(allowed("box.tailnet.ts.net", "0.0.0.0", [], extra));
    assert.isTrue(allowed("tailnet.ts.net", "0.0.0.0", [], extra));
    assert.isFalse(allowed("eviltailnet.ts.net", "0.0.0.0", [], extra));
    assert.isFalse(allowed("example.com", "0.0.0.0", [], extra));
  });

  it("is loopback still where the machine's addresses cannot be read, as under mcp-hub's unit", () => {
    const unreadable = interfaceAddresses(() => {
      throw new Error(
        "uv_interface_addresses returned Unknown system error 97"
      );
    });
    assert.deepStrictEqual(unreadable, []);
    assert.isTrue(allowed("127.0.0.1", "127.0.0.1", unreadable));
    assert.deepStrictEqual(
      interfaceAddresses(() => ({
        lo: [{ address: "127.0.0.1" }],
        wlan0: undefined,
      })),
      ["127.0.0.1"]
    );
  });

  it("reads the name out of a Host header and refuses anything else", () => {
    assert.strictEqual(hostNameOf("LocalHost:4770"), "localhost");
    assert.strictEqual(hostNameOf("[::1]:4770"), "[::1]");
    assert.strictEqual(hostNameOf("attacker.com:4770"), "attacker.com");
    assert.isUndefined(hostNameOf("attacker.com@localhost"));
    assert.isUndefined(hostNameOf("localhost/evil"));
    assert.isUndefined(hostNameOf(""));
  });
});

describe("a test's configuration", () => {
  it.effect("has a user directory of its own, which goes with it", () =>
    Effect.gen(function* () {
      const made = yield* Effect.gen(function* () {
        const { userDir } = yield* ServerConfig;
        assert.isTrue(existsSync(userDir));
        return userDir;
      }).pipe(Effect.provide(ServerConfig.layerTest()));
      assert.isFalse(existsSync(made));
    })
  );
});
