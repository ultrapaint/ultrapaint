import { Schema as S } from "effect";
import { RepoRelativePath } from "./base.ts";

export const Settings = S.Struct({
  /** Package names whose exports form the component palette. */
  componentPackages: S.Array(S.String),
  /** Directory holding the screens, relative to the repository. It should be a package. */
  designsDir: RepoRelativePath,
  /** Formatter command run on edited files, relative to repo root. `{file}` is substituted. */
  formatCommand: S.optional(S.String),
  /** CSS imports for the preview host entry, resolved from the designs directory. */
  hostCss: S.Array(S.String),
  /** Directories (relative to repo) whose JSX is stamped with source locations and catalogued. */
  libraryDirs: S.Array(RepoRelativePath),
  /** Optional module (relative to designsDir) whose default export wraps every screen. */
  providersModule: S.optional(S.String),
  /** Absolute path of the target repository. */
  repoPath: S.String,
  /** Running Storybook for the design system, used for palette previews. */
  storybookUrl: S.optional(S.String),
  /** Value written to `data-theme` on the host document. */
  theme: S.Literal("light", "dark"),
});
export type Settings = typeof Settings.Type;

export const defaultSettings = (repoPath: string): Settings => ({
  componentPackages: [],
  designsDir: "designs",
  hostCss: [],
  libraryDirs: [],
  repoPath,
  theme: "light",
});

export const SettingsValidation = S.Struct({
  branch: S.optional(S.String),
  ok: S.Boolean,
  problems: S.Array(S.String),
  repoName: S.optional(S.String),
});
export type SettingsValidation = typeof SettingsValidation.Type;
