/**
 * Which app this is (ADR 0113): the release, as its installers ship it, or **Ultrapaint Dev**,
 * the app run from a checkout of Ultrapaint (`pnpm desktop:dev`, or `Ultrapaint Dev.app` on a
 * Mac), which runs beside the release with a name, a data folder and a look of its own, opens its
 * local projects live (`ultrapaint --dev`) and updates from `main`. The runner (`scripts/dev.ts`)
 * says which by a variable, read once as the app starts. Free of Electron.
 */
import path from "node:path";
import { Schema } from "effect";

/** The variable the runner sets: the checkout it runs, as JSON (`DevRun`). */
export const DEV_RUN_ENV = "ULTRAPAINT_DESKTOP_DEV_RUN";

/** What Ultrapaint Dev exits with to be pulled, rebuilt and started again by its runner. */
export const RESTART_EXIT_CODE = 75;

export const RELEASE_NAME = "Ultrapaint";
export const DEV_NAME = "Ultrapaint Dev";

/** The checkout Ultrapaint Dev runs, as its runner found it before starting it. */
export const DevRun = Schema.Struct({
  /** The checkout's branch; `HEAD` when it is on none. */
  branch: Schema.String,
  /** The checkout's root. */
  checkout: Schema.String,
  /** The commit it runs, short. */
  commit: Schema.String,
  /** Why the update the person asked for last did not happen, when it did not. */
  updateFailed: Schema.optional(Schema.String),
  /** The version the checkout's `package.json` names. */
  version: Schema.String,
});
export type DevRun = typeof DevRun.Type;

export type Edition =
  | { readonly _tag: "Release" }
  | ({ readonly _tag: "Dev" } & DevRun);

const decodeRun = Schema.decodeUnknownSync(Schema.fromJsonString(DevRun));

/**
 * The app the environment says this is. A run the runner described and that cannot be read is
 * an error, never the release: the release would replace itself with a GitHub release.
 */
export const editionOf = (
  env: Readonly<Record<string, string | undefined>>
): Edition => {
  const run = env[DEV_RUN_ENV];
  return run === undefined
    ? { _tag: "Release" }
    : { _tag: "Dev", ...decodeRun(run) };
};

/**
 * Where the app keeps its data, under the system's folder for apps' data: a folder named as the
 * app, or the one `ULTRAPAINT_DESKTOP_USER_DATA` names for a throwaway run. Ultrapaint Dev's
 * first start fills its list from the release's folder (`firstFrom`), never a throwaway's.
 */
export const dataDirsOf = (
  edition: Edition,
  appData: string,
  override: string | undefined
): { readonly firstFrom?: string; readonly own: string } => {
  if (override !== undefined) {
    return { own: path.resolve(override) };
  }
  const release = path.join(appData, RELEASE_NAME);
  return edition._tag === "Dev"
    ? { firstFrom: release, own: path.join(appData, DEV_NAME) }
    : { own: release };
};

/**
 * A folder named on the command line: after the executable, and after the app's own path where
 * Electron is given one (Ultrapaint Dev, run from its build).
 */
export const folderArgument = (argv: readonly string[], edition: Edition) =>
  argv
    .slice(edition._tag === "Dev" ? 2 : 1)
    .find((arg) => !arg.startsWith("-"));
