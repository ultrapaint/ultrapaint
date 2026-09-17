import * as S from "effect/Schema";
import { RepoRelativePath } from "./base.ts";

export const Settings = S.Struct({
  /** Absolute path of the target repository. */
  repoPath: S.String,
  /** Directory holding the screens, relative to the repository. It should be a package. */
  designsDir: RepoRelativePath,
  /** CSS imports for the preview host entry, resolved from the designs directory. */
  hostCss: S.Array(S.String),
  /** Optional module (relative to designsDir) whose default export wraps every screen. */
  providersModule: S.optional(S.String),
  /** Directories (relative to repo) whose JSX is stamped with source locations and catalogued. */
  libraryDirs: S.Array(RepoRelativePath),
  /** Package names whose exports form the component palette. */
  componentPackages: S.Array(S.String),
  /** Formatter command run on edited files, relative to repo root. `{file}` is substituted. */
  formatCommand: S.optional(S.String),
  /** Value written to `data-theme` on the host document. */
  theme: S.Literal("light", "dark"),
  /** Running Storybook for the design system, used for palette previews. */
  storybookUrl: S.optional(S.String),
});
export type Settings = typeof Settings.Type;

export const defaultSettings = (repoPath: string): Settings => ({
  repoPath,
  designsDir: "designs",
  hostCss: [],
  libraryDirs: [],
  componentPackages: [],
  theme: "light",
});

export const SettingsValidation = S.Struct({
  ok: S.Boolean,
  problems: S.Array(S.String),
  repoName: S.optional(S.String),
  branch: S.optional(S.String),
});
export type SettingsValidation = typeof SettingsValidation.Type;
