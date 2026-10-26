import type { ProjectConfig, Settings } from "@ultrapaint/contracts/settings";
import type { Path } from "effect";
import { toPosix } from "../hash.ts";

/** Resolves what a configuration file says against the directory it lives in. */
export const toSettings = (
  path: Path.Path,
  config: ProjectConfig,
  baseDir: string
): Settings => {
  const { $schema: _schema, repoPath, ...rest } = config;
  return {
    ...rest,
    componentPackages: config.componentPackages ?? [],
    hostCss: config.hostCss ?? [],
    libraryDirs: config.libraryDirs ?? [],
    repoPath: path.resolve(baseDir, repoPath ?? "."),
    theme: config.theme ?? "light",
  };
};

/**
 * The file form of the settings. A shared file carries no machine-specific path: the
 * repository is written relative to the file, and left out when it is the file's directory.
 */
export const toConfig = (
  path: Path.Path,
  settings: Settings,
  baseDir: string,
  options: { readonly relative: boolean; readonly schema?: string | undefined }
): ProjectConfig => {
  const { repoPath, ...rest } = settings;
  const relative = toPosix(path.relative(baseDir, repoPath));
  let written: string | undefined = repoPath;
  if (options.relative) {
    written = relative === "" ? undefined : relative;
  }
  return {
    ...(options.schema ? { $schema: options.schema } : {}),
    ...rest,
    ...(written === undefined ? {} : { repoPath: written }),
  };
};

/** A configuration as its file is written: keys in order, so a change reads as a small diff. */
export const configText = (encoded: object): string =>
  `${JSON.stringify(
    Object.fromEntries(
      Object.entries(encoded).sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
    ),
    null,
    2
  )}\n`;
