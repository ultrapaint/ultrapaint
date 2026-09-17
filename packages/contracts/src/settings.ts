import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";

export const Settings = Schema.Struct({
  /** Package names whose exports form the component palette. */
  componentPackages: Schema.Array(Schema.String),
  /** Directory holding the screens, relative to the repository. It should be a package. */
  designsDir: RepoRelativePath,
  /** Formatter command run on edited files, relative to repo root. `{file}` is substituted. */
  formatCommand: Schema.optional(Schema.String),
  /** CSS imports for the preview host entry, resolved from the designs directory. */
  hostCss: Schema.Array(Schema.String),
  /** Directories (relative to repo) whose JSX is stamped with source locations and catalogued. */
  libraryDirs: Schema.Array(RepoRelativePath),
  /** Optional module (relative to designsDir) whose default export wraps every screen. */
  providersModule: Schema.optional(Schema.String),
  /** Absolute path of the target repository. */
  repoPath: Schema.String,
  /** Running Storybook for the design system, used for palette previews. */
  storybookUrl: Schema.optional(Schema.String),
  /** Value written to `data-theme` on the host document. */
  theme: Schema.Literals(["light", "dark"]),
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

export const SettingsValidation = Schema.Struct({
  branch: Schema.optional(Schema.String),
  ok: Schema.Boolean,
  problems: Schema.Array(Schema.String),
  repoName: Schema.optional(Schema.String),
});
export type SettingsValidation = typeof SettingsValidation.Type;
