import { assert, describe, it } from "@effect/vitest";
import {
  type Forwards,
  forwardOf,
  movePreview,
  remotePortOf,
  throughForward,
} from "./forwards.ts";

const server = { local: 41_000, remoteHost: "127.0.0.1", remotePort: 4770 };

describe("forwards", () => {
  it("reads the remote port of a URL on the remote machine's loopback only", () => {
    assert.strictEqual(remotePortOf("http://127.0.0.1:5173"), 5173);
    assert.strictEqual(remotePortOf("http://localhost:5173/x?y=1"), 5173);
    assert.strictEqual(remotePortOf("http://[::1]:5173"), 5173);
    assert.isUndefined(remotePortOf("http://devbox:5173"));
    assert.isUndefined(remotePortOf("https://127.0.0.1:5173"));
    assert.isUndefined(remotePortOf("not a url"));
  });

  it("rewrites the origin and keeps the path, the query and the hash", () => {
    const preview = {
      local: 42_000,
      remoteHost: "127.0.0.1",
      remotePort: 5173,
    };
    assert.strictEqual(
      throughForward("http://127.0.0.1:5173", preview),
      "http://127.0.0.1:42000"
    );
    assert.strictEqual(
      throughForward("http://localhost:5173/", preview),
      "http://127.0.0.1:42000/"
    );
    assert.strictEqual(
      throughForward(
        "http://127.0.0.1:4770/?new-design=starter&settings=1#top",
        server
      ),
      "http://127.0.0.1:41000/?new-design=starter&settings=1#top"
    );
    assert.strictEqual(
      throughForward("http://127.0.0.1:5173/pages/home?frame=a%20b", preview),
      "http://127.0.0.1:42000/pages/home?frame=a%20b"
    );
  });

  it("adds the preview's forward, moves it, and cancels the one it leaves", () => {
    let forwards: Forwards = { server };
    assert.strictEqual(forwardOf(forwards, 4770), server);
    assert.isUndefined(forwardOf(forwards, 5173));

    const first = { local: 42_000, remoteHost: "127.0.0.1", remotePort: 5173 };
    const added = movePreview(forwards, first);
    assert.deepStrictEqual(added.cancel, []);
    forwards = added.next;
    assert.strictEqual(forwardOf(forwards, 5173), first);

    // The preview started again elsewhere: the old port goes.
    const second = { local: 42_001, remoteHost: "127.0.0.1", remotePort: 5200 };
    const moved = movePreview(forwards, second);
    assert.deepStrictEqual(moved.cancel, [first]);
    forwards = moved.next;
    assert.isUndefined(forwardOf(forwards, 5173));
    assert.strictEqual(forwardOf(forwards, 5200), second);
    assert.strictEqual(forwards.server, server);

    // Back on the same port: nothing to cancel.
    assert.deepStrictEqual(movePreview(forwards, second).cancel, []);
  });
});
