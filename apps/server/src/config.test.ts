import { assert, describe, it } from "@effect/vitest";
import { allowedHostNames, hostNameOf } from "./config.ts";

describe("the names the server answers to", () => {
  it("is loopback, and the address it is bound to", () => {
    const local = allowedHostNames("127.0.0.1", ["192.168.1.5", "box"]);
    assert.deepStrictEqual([...local].sort(), [
      "127.0.0.1",
      "[::1]",
      "localhost",
    ]);
    const lan = allowedHostNames("192.168.1.5", []);
    assert.isTrue(lan.has("192.168.1.5"));
    assert.isTrue(lan.has("localhost"));
  });

  it("is every address of the machine and its name when bound to all", () => {
    const all = allowedHostNames("0.0.0.0", ["192.168.1.5", "fe80::1", "Box"]);
    for (const name of ["192.168.1.5", "[fe80::1]", "box", "127.0.0.1"]) {
      assert.isTrue(all.has(name), name);
    }
    assert.isFalse(all.has("0.0.0.0"));
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
