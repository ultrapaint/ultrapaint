import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { isNewer, latestRelease, updateNotice } from "./updates.ts";

/** A `fetch` that answers GitHub's latest release with `body`, or fails. */
const answering =
  (body: unknown, status = 200): typeof fetch =>
  () =>
    Promise.resolve(Response.json(body, { status }));

describe("a newer release", () => {
  it("is a later version, part by part", () => {
    assert.isTrue(isNewer("0.1.1", "0.1.0"));
    assert.isTrue(isNewer("0.2.0", "0.1.9"));
    assert.isTrue(isNewer("1.0.0", "0.10.0"));
    assert.isTrue(isNewer("v0.10.0", "0.9.0"));
    assert.isFalse(isNewer("0.1.0", "0.1.0"));
    assert.isFalse(isNewer("0.1.0", "0.2.0"));
    assert.isFalse(isNewer("0.2.0-beta.1", "0.1.0"));
    assert.isFalse(isNewer("not a version", "0.1.0"));
  });

  it.effect("is read from the repository's latest GitHub release", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* latestRelease(answering({ tag_name: "v0.2.0" })),
        Option.some("0.2.0")
      );
    })
  );

  it.effect("is none when GitHub cannot be read or says something else", () =>
    Effect.gen(function* () {
      const offline: typeof fetch = () =>
        Promise.reject(new TypeError("fetch failed"));
      assert.isTrue(Option.isNone(yield* latestRelease(offline)));
      assert.isTrue(
        Option.isNone(yield* latestRelease(answering({ message: "no" }, 404)))
      );
      assert.isTrue(
        Option.isNone(yield* latestRelease(answering({ tag_name: 3 })))
      );
    })
  );
});

describe("the update notice", () => {
  it("says how to update with Homebrew on macOS, for that version only", () => {
    const notice = Option.getOrThrow(updateNotice("0.1.0", "0.2.0", "darwin"));
    assert.strictEqual(notice.id, "update-0.2.0");
    assert.strictEqual(notice.title, "Ultrapaint 0.2.0 is out");
    assert.strictEqual(notice.command, "brew upgrade --cask ultrapaint");
    assert.strictEqual(
      notice.link?.url,
      "https://github.com/ultrapaint/ultrapaint/releases/tag/v0.2.0"
    );
  });

  it("points to the download elsewhere", () => {
    const notice = Option.getOrThrow(updateNotice("0.1.0", "0.2.0", "linux"));
    assert.isUndefined(notice.command);
    assert.strictEqual(notice.link?.label, "Download");
  });

  it("is not shown when the app is up to date", () => {
    assert.isTrue(Option.isNone(updateNotice("0.2.0", "0.2.0", "darwin")));
    assert.isTrue(Option.isNone(updateNotice("0.3.0", "0.2.0", "darwin")));
  });
});
