/**
 * Whether a newer release of the app is out (ADR 0051), read from the repository's latest GitHub
 * release and told as a notice over the editor where the app does not update itself: a macOS
 * app is unsigned, which Squirrel does not update, so Homebrew or a download does; a deb is
 * installed again. An AppImage updates itself through electron-updater (`main.ts`) and is told
 * nothing here.
 */

import type { ShellNotice } from "@ultrapaint/contracts/shell-bridge";
import { Effect, Option, Schema } from "effect";
import { UpdateCheckError } from "./errors.ts";

const REPOSITORY = "ultrapaint/ultrapaint";
const RELEASES = `https://github.com/${REPOSITORY}/releases`;
const LATEST = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

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

const LatestRelease = Schema.Struct({ tag_name: Schema.String });

/** The latest release's version, without its `v`; none when GitHub cannot be read. */
export const latestRelease = Effect.fn("Updates.latestRelease")(function* (
  fetchFn: typeof fetch
) {
  const release = yield* Effect.tryPromise({
    catch: (error) =>
      new UpdateCheckError({ message: `${LATEST}: ${String(error)}` }),
    try: async (signal) => {
      const response = await fetchFn(LATEST, {
        headers: { accept: "application/vnd.github+json" },
        signal,
      });
      return response.ok ? await response.json() : undefined;
    },
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(LatestRelease)),
    Effect.timeout("10 seconds"),
    Effect.option
  );
  // Offline, rate-limited or answered with something else: no notice, and no error to show.
  return Option.map(release, ({ tag_name }) =>
    tag_name.replace(LEADING_V_RE, "")
  );
});

/** The notice for `latest` when it is newer than `current`, saying how to update on `platform`. */
export const updateNotice = (
  current: string,
  latest: string,
  platform: NodeJS.Platform
): Option.Option<ShellNotice> => {
  if (!isNewer(latest, current)) {
    return Option.none();
  }
  const link = { label: "Download", url: `${RELEASES}/tag/v${latest}` };
  return Option.some(
    platform === "darwin"
      ? {
          command: "brew upgrade --cask ultrapaint",
          detail: `You have ${current}. Update it with Homebrew, or download it from the release.`,
          id: `update-${latest}`,
          link,
          title: `Ultrapaint ${latest} is out`,
        }
      : {
          detail: `You have ${current}. Download it from the release and install it.`,
          id: `update-${latest}`,
          link,
          title: `Ultrapaint ${latest} is out`,
        }
  );
};
