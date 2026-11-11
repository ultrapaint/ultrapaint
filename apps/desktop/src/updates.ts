/**
 * What GitHub says of the app's releases (ADR 0078): the releases since the one running, with
 * their notes, and the feed that names a macOS release's zip and its checksum. And where this
 * copy of the app can be replaced from, which is where it runs from, wherever that is.
 */

import { access, constants } from "node:fs/promises";
import path from "node:path";
import { INSTALL_MARK } from "@ultrapaint/contracts/release-notes";
import type { AppRelease } from "@ultrapaint/contracts/shell-bridge";
import { Effect, Schema } from "effect";
import { parse as parseYaml } from "yaml";
import { UpdateCheckError } from "./errors.ts";

const REPOSITORY = "ultrapaint/ultrapaint";
export const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases`;
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;

const VERSION_RE = /^v?\d+\.\d+\.\d+$/;
const LEADING_V_RE = /^v/;

/** A release's version as its three numbers; a pre-release or anything else is none. */
const numbers = (version: string): readonly number[] | undefined => {
  const trimmed = version.trim();
  return VERSION_RE.test(trimmed)
    ? trimmed.replace(LEADING_V_RE, "").split(".").map(Number)
    : undefined;
};

/** Whether `latest` is a later release than `current`. */
export const isNewer = (latest: string, current: string): boolean => {
  const next = numbers(latest);
  const now = numbers(current);
  if (!(next && now)) {
    return false;
  }
  const differs = next.findIndex((part, i) => part !== now[i]);
  return differs !== -1 && (next[differs] ?? 0) > (now[differs] ?? 0);
};

/**
 * What a release brings, as its notes say it before the install mark. A release without the mark
 * has no notes the app shows: all of it is how to install it.
 */
export const notesOf = (body: string | null) => {
  const at = body?.indexOf(INSTALL_MARK) ?? -1;
  return at === -1 || !body ? "" : body.slice(0, at).trim();
};

const GitHubRelease = Schema.Struct({
  body: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  published_at: Schema.NullOr(Schema.String),
  tag_name: Schema.String,
});

/** What `url` answers, read by `read`: a failure when it cannot be reached or says no. */
const fetchRead = <A>(
  fetchFn: typeof fetch,
  url: string,
  read: (response: Response) => Promise<A>,
  headers: Record<string, string> = {}
) =>
  Effect.tryPromise({
    catch: (error) =>
      new UpdateCheckError({ message: `${url}: ${String(error)}` }),
    try: (signal) => fetchFn(url, { headers, signal }),
  }).pipe(
    Effect.filterOrFail(
      (response) => response.ok,
      (response) =>
        new UpdateCheckError({
          message: `${url} answered ${response.status}`,
        })
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        catch: (error) =>
          new UpdateCheckError({ message: `${url}: ${String(error)}` }),
        try: () => read(response),
      })
    ),
    Effect.timeout("20 seconds")
  );

/**
 * The releases published since `current`, newest first: none when the app is up to date.
 * Drafts and pre-releases are not releases yet.
 */
export const releasesSince = Effect.fn("Updates.releasesSince")(function* (
  fetchFn: typeof fetch,
  current: string
) {
  const all = yield* fetchRead(
    fetchFn,
    RELEASES_API,
    (response) => response.json() as Promise<unknown>,
    { accept: "application/vnd.github+json" }
  ).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(GitHubRelease))),
    Effect.mapError((error) => new UpdateCheckError({ message: String(error) }))
  );
  return all
    .filter((r) => !(r.draft || r.prerelease) && isNewer(r.tag_name, current))
    .map(
      (r): AppRelease => ({
        date: r.published_at ?? "",
        notes: notesOf(r.body),
        version: r.tag_name.replace(LEADING_V_RE, ""),
      })
    )
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1));
});

/** A release's page, where its installers are downloaded by hand. */
export const releasePage = (version: string) =>
  `${RELEASES_PAGE}/tag/v${version}`;

const MacFeed = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      sha512: Schema.String,
      size: Schema.Number,
      url: Schema.String,
    })
  ),
  version: Schema.String,
});

/** The zip a macOS release is installed from, as its feed (`latest-mac.yml`) names it. */
export interface MacZip {
  readonly sha512: string;
  readonly size: number;
  readonly url: string;
}

const ZIP_RE = /\.zip$/;

/** The zip of `version`'s macOS build, from the feed the release workflow attaches. */
export const macZip = Effect.fn("Updates.macZip")(function* (
  fetchFn: typeof fetch,
  version: string
) {
  const base = `${RELEASES_PAGE}/download/v${version}`;
  const text = yield* fetchRead(fetchFn, `${base}/latest-mac.yml`, (response) =>
    response.text()
  );
  const feed = yield* Effect.try({
    catch: (error) =>
      new UpdateCheckError({ message: `latest-mac.yml: ${String(error)}` }),
    try: () => parseYaml(text) as unknown,
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(MacFeed)),
    Effect.mapError((error) => new UpdateCheckError({ message: String(error) }))
  );
  const zip = feed.files.find((file) => ZIP_RE.test(file.url));
  if (!zip) {
    return yield* new UpdateCheckError({
      message: `the ${version} release has no macOS zip`,
    });
  }
  return { ...zip, url: `${base}/${zip.url}` } satisfies MacZip;
});

const BUNDLE_RE = /\.app$/;

/**
 * The bundle a macOS app runs from, from its executable (`<bundle>.app/Contents/MacOS/<name>`):
 * wherever it was installed, under whatever name.
 */
export const bundleOf = (executable: string) => {
  const bundle = path.dirname(path.dirname(path.dirname(executable)));
  return BUNDLE_RE.test(bundle) ? bundle : undefined;
};

/** Where a macOS app can be replaced, or why it cannot be. */
export type SwapTarget =
  | { readonly _tag: "Bundle"; readonly path: string }
  | { readonly _tag: "Cannot"; readonly reason: string };

/**
 * Where the running app is replaced: its own bundle, when its folder and itself can be written.
 * A copy macOS runs from a temporary folder (one opened in quarantine, App Translocation) or one
 * on a read-only disk (the dmg) is downloaded by hand.
 */
export const swapTarget = Effect.fn("Updates.swapTarget")(function* (
  executable: string
) {
  const bundle = bundleOf(executable);
  if (!bundle) {
    return {
      _tag: "Cannot",
      reason: "Ultrapaint isn’t running from an app bundle.",
    } satisfies SwapTarget;
  }
  if (bundle.includes("/AppTranslocation/")) {
    return {
      _tag: "Cannot",
      reason:
        "macOS runs this copy from a temporary folder. Move Ultrapaint to your Applications folder and open it from there to update it in place.",
    } satisfies SwapTarget;
  }
  const writable = yield* Effect.promise(() =>
    Promise.all(
      [bundle, path.dirname(bundle)].map((p) => access(p, constants.W_OK))
    )
      .then(() => true)
      // Not writable, or not there: the app cannot replace itself, which the reason says.
      .catch(() => false)
  );
  return writable
    ? ({ _tag: "Bundle", path: bundle } satisfies SwapTarget)
    : ({
        _tag: "Cannot",
        reason: `Ultrapaint can’t replace itself in ${path.dirname(bundle)}.`,
      } satisfies SwapTarget);
});
