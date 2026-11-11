import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { INSTALL_MARK } from "@ultrapaint/contracts/release-notes";
import type { AppUpdate } from "@ultrapaint/contracts/shell-bridge";
import { Effect, Layer } from "effect";
import { type InstallMode, Updater } from "./updater.ts";
import {
  bundleOf,
  isNewer,
  macZip,
  notesOf,
  releasesSince,
  swapTarget,
} from "./updates.ts";

const release = (
  tag: string,
  body: string | null = null,
  extra: object = {}
) => ({
  body,
  draft: false,
  prerelease: false,
  published_at: "2026-11-10T15:07:50Z",
  tag_name: tag,
  ...extra,
});

/** A `fetch` that answers each address it knows, and 404 for the rest; it records each asked. */
const answering = (routes: Record<string, () => Response>) => {
  const asked: string[] = [];
  const fetchFn: typeof fetch = (input) => {
    const url = String(input);
    asked.push(url);
    const route = Object.entries(routes).find(([part]) => url.includes(part));
    return Promise.resolve(
      route ? route[1]() : new Response("missing", { status: 404 })
    );
  };
  return { asked, fetchFn };
};

const RELEASES = [
  release(
    "v0.1.3",
    `**Pictures on the start screen.**\n\n${INSTALL_MARK}\nInstall it…`
  ),
  release("v0.1.2", "Only how to install it"),
  release("v0.1.4", null, { draft: true }),
  release("v0.2.0-beta.1", null, { prerelease: true }),
  release("v0.1.1", `Old\n${INSTALL_MARK}`),
];

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

  it("brings what its notes say before how to install it, and nothing without the mark", () => {
    assert.strictEqual(notesOf(`New\n\n${INSTALL_MARK}\nnpm install`), "New");
    assert.strictEqual(notesOf("npm install"), "");
    assert.strictEqual(notesOf(null), "");
  });

  it.effect(
    "are the published releases since the one running, newest first, with their notes",
    () =>
      Effect.gen(function* () {
        const { fetchFn } = answering({
          "/releases?": () => Response.json(RELEASES),
        });
        assert.deepStrictEqual(yield* releasesSince(fetchFn, "0.1.1"), [
          {
            date: "2026-11-10T15:07:50Z",
            notes: "**Pictures on the start screen.**",
            version: "0.1.3",
          },
          { date: "2026-11-10T15:07:50Z", notes: "", version: "0.1.2" },
        ]);
        assert.deepStrictEqual(yield* releasesSince(fetchFn, "0.1.3"), []);
      })
  );

  it.effect("fails when GitHub cannot be read or says something else", () =>
    Effect.gen(function* () {
      const offline: typeof fetch = () =>
        Promise.reject(new TypeError("fetch failed"));
      const said = answering({ "/releases?": () => Response.json({ no: 1 }) });
      for (const fetchFn of [offline, said.fetchFn]) {
        const exit = yield* Effect.exit(releasesSince(fetchFn, "0.1.0"));
        assert.strictEqual(exit._tag, "Failure");
      }
    })
  );
});

const FEED = (sha512: string, size: number) => `version: 0.1.3
files:
  - url: ultrapaint-0.1.3-mac-arm64.zip
    sha512: ${sha512}
    size: ${size}
  - url: ultrapaint-0.1.3-mac-arm64.dmg
    sha512: other
    size: 2
path: ultrapaint-0.1.3-mac-arm64.zip
`;

describe("a macOS release's zip", () => {
  it.effect("is the feed's zip, at the release's address", () =>
    Effect.gen(function* () {
      const { fetchFn } = answering({
        "latest-mac.yml": () => new Response(FEED("abc", 12)),
      });
      assert.deepStrictEqual(yield* macZip(fetchFn, "0.1.3"), {
        sha512: "abc",
        size: 12,
        url: "https://github.com/ultrapaint/ultrapaint/releases/download/v0.1.3/ultrapaint-0.1.3-mac-arm64.zip",
      });
    })
  );
});

/** A folder of its own, with an app bundle in it, writable or not, wherever it was installed. */
const installed = (name = "Ultrapaint.app", writable = true) => {
  const root = mkdtempSync(path.join(tmpdir(), "ultrapaint-update-"));
  const apps = path.join(root, "Somewhere Else");
  const macos = path.join(apps, name, "Contents", "MacOS");
  mkdirSync(macos, { recursive: true });
  const executable = path.join(macos, "Ultrapaint");
  writeFileSync(executable, "");
  if (!writable) {
    chmodSync(apps, 0o555);
  }
  return { bundle: path.join(apps, name), executable, root };
};

describe("where the macOS app is replaced", () => {
  it("is the bundle it runs from, under whatever name", () => {
    assert.strictEqual(
      bundleOf("/Users/me/Apps/Ultrapaint Beta.app/Contents/MacOS/Ultrapaint"),
      "/Users/me/Apps/Ultrapaint Beta.app"
    );
    assert.isUndefined(bundleOf("/usr/bin/electron"));
  });

  it.effect("is its own folder, where that can be written", () =>
    Effect.gen(function* () {
      const app = installed("Ultrapaint Beta.app");
      assert.deepStrictEqual(yield* swapTarget(app.executable), {
        _tag: "Bundle",
        path: app.bundle,
      });
    })
  );

  it.effect(
    "is none for a copy macOS moved to a temporary folder, or one in a folder it cannot write",
    () =>
      Effect.gen(function* () {
        const moved = yield* swapTarget(
          "/private/var/folders/x/AppTranslocation/1/d/Ultrapaint.app/Contents/MacOS/Ultrapaint"
        );
        assert.strictEqual(moved._tag, "Cannot");
        const locked = installed("Ultrapaint.app", false);
        const target = yield* swapTarget(locked.executable);
        assert.strictEqual(target._tag, "Cannot");
        assert.include(
          target._tag === "Cannot" ? target.reason : "",
          "Somewhere Else"
        );
      })
  );
});

/** The updater in `mode`, its first check done, with what it told the window. */
const updaterTold = (mode: InstallMode, fetchFn: typeof fetch) =>
  Effect.gen(function* () {
    const told: (AppUpdate | null)[] = [];
    const layer = Updater.layer({
      current: "0.1.1",
      fetch: fetchFn,
      mode,
      publish: (update) => told.push(update),
    }).pipe(Layer.provide(NodeServices.layer));
    yield* Updater.use((u) => u.check).pipe(Effect.provide(layer));
    return told;
  });

const RELEASE_ROUTES = { "/releases?": () => Response.json(RELEASES) };

describe("the updater", () => {
  it.effect("offers a deb's release to download, with its notes", () =>
    Effect.gen(function* () {
      const { fetchFn } = answering(RELEASE_ROUTES);
      const told = yield* updaterTold({ _tag: "Download" }, fetchFn);
      assert.deepStrictEqual(told.at(-1), {
        current: "0.1.1",
        install: "download",
        releases: [
          {
            date: "2026-11-10T15:07:50Z",
            notes: "**Pictures on the start screen.**",
            version: "0.1.3",
          },
          { date: "2026-11-10T15:07:50Z", notes: "", version: "0.1.2" },
        ],
        url: "https://github.com/ultrapaint/ultrapaint/releases/tag/v0.1.3",
      });
    })
  );

  it.effect("tells nothing when the app is up to date", () =>
    Effect.gen(function* () {
      const { fetchFn } = answering({
        "/releases?": () => Response.json([release("v0.1.1")]),
      });
      const told = yield* updaterTold({ _tag: "Download" }, fetchFn);
      // The check the updater starts with, and the one asked: neither finds anything.
      assert.isNotEmpty(told);
      assert.isTrue(told.every((update) => update === null));
    })
  );

  it.effect(
    "restarts a macOS app into a release it unpacked before, wherever the app is, with no download",
    () =>
      Effect.gen(function* () {
        const app = installed("Ultrapaint Beta.app");
        const stageDir = path.join(app.root, "updates");
        mkdirSync(path.join(stageDir, "0.1.3", "Ultrapaint.app"), {
          recursive: true,
        });
        writeFileSync(path.join(stageDir, "0.1.3", ".ready"), "");
        const { asked, fetchFn } = answering(RELEASE_ROUTES);
        const told = yield* updaterTold(
          { _tag: "Swap", executable: app.executable, stageDir },
          fetchFn
        );
        assert.strictEqual(told.at(-1)?.install, "restart");
        assert.isFalse(asked.some((url) => url.includes("latest-mac.yml")));
      })
  );

  it.effect(
    "offers the download when a macOS release's zip does not match its checksum",
    () =>
      Effect.gen(function* () {
        const app = installed();
        const zip = new TextEncoder().encode("not the release");
        const wrong = createHash("sha512").update("other").digest("base64");
        const { fetchFn } = answering({
          ...RELEASE_ROUTES,
          "latest-mac.yml": () => new Response(FEED(wrong, zip.length)),
          "mac-arm64.zip": () => new Response(zip),
        });
        const told = yield* updaterTold(
          {
            _tag: "Swap",
            executable: app.executable,
            stageDir: path.join(app.root, "updates"),
          },
          fetchFn
        );
        assert.strictEqual(told.at(-1)?.install, "download");
        assert.include(told.at(-1)?.reason ?? "", "checksum");
      })
  );

  it.effect(
    "offers the download when the macOS app cannot replace itself, saying why",
    () =>
      Effect.gen(function* () {
        const app = installed("Ultrapaint.app", false);
        const { fetchFn } = answering(RELEASE_ROUTES);
        const told = yield* updaterTold(
          {
            _tag: "Swap",
            executable: app.executable,
            stageDir: path.join(app.root, "updates"),
          },
          fetchFn
        );
        assert.strictEqual(told.at(-1)?.install, "download");
        assert.include(told.at(-1)?.reason ?? "", "can’t replace itself");
      })
  );
});
