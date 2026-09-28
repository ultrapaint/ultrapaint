import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";
import { SkillsConfig } from "./skills.ts";

/** Which renderer, builder and source tooling the target repository is driven with. */
export const FrameworkId = Schema.Literals(["react-vite"]);
export type FrameworkId = typeof FrameworkId.Type;
export const defaultFramework: FrameworkId = "react-vite";

export const Theme = Schema.Literals(["light", "dark"]);

const common = {
  /** Renderer and builder for the preview; `react-vite` when absent. */
  framework: Schema.optional(FrameworkId),
  /** Optional module (relative to designsDir) whose default export wraps every screen. */
  providersModule: Schema.optional(Schema.String),
  /**
   * Package (relative to the repository) the screens resolve their imports from, as if they
   * were files of it. Absent means the designs directory is itself a package.
   */
  resolveFrom: Schema.optional(RepoRelativePath),
  /** Which design skills agents are not told; all of them apply when absent. */
  skills: Schema.optional(SkillsConfig),
  /** Running Storybook for the design system, used for palette previews. */
  storybookUrl: Schema.optional(Schema.String),
};

/** The settings the server runs with and the editor edits. Every path is resolved. */
export const Settings = Schema.Struct({
  ...common,
  /** Package names whose exports form the component palette. */
  componentPackages: Schema.Array(Schema.String),
  /** Directory holding the screens, relative to the repository. */
  designsDir: RepoRelativePath,
  /** CSS imports for the preview host entry, resolved from the designs directory. */
  hostCss: Schema.Array(Schema.String),
  /** Directories (relative to repo) whose JSX is stamped with source locations and catalogued. */
  libraryDirs: Schema.Array(RepoRelativePath),
  /** Absolute path of the target repository. */
  repoPath: Schema.String,
  /** Value written to `data-theme` on the host document. */
  theme: Theme,
});
export type Settings = typeof Settings.Type;

/**
 * The same settings as they are written to disk: `ultrapaint.json` in a repository, or the
 * `settings.json` of a home directory. A file that lives in the repository is shared, so its
 * `repoPath` is relative to the file's directory and may be left out when it is that directory.
 * Everything with an obvious default may be left out of a hand-written file.
 */
export const ProjectConfig = Schema.Struct({
  ...common,
  $schema: Schema.optional(Schema.String),
  componentPackages: Schema.optional(Schema.Array(Schema.String)),
  designsDir: RepoRelativePath,
  hostCss: Schema.optional(Schema.Array(Schema.String)),
  libraryDirs: Schema.optional(Schema.Array(RepoRelativePath)),
  repoPath: Schema.optional(Schema.String),
  theme: Schema.optional(Theme),
});
export type ProjectConfig = typeof ProjectConfig.Type;

/** File name looked for from the working directory upwards when no `--config` is given. */
export const CONFIG_FILE_NAME = "ultrapaint.json";

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

/**
 * Where the server keeps what it knows.
 * - `managed`: a home directory (`--home`) with its own settings file and state.
 * - `file`: a configuration file the user passed or that was found in the repository; the
 *   other state sits in a `.ultrapaint` directory next to it.
 * - `ephemeral`: started without a configuration; nothing outlives the process.
 */
export const StorageMode = Schema.Literals(["managed", "file", "ephemeral"]);
export type StorageMode = typeof StorageMode.Type;

export const StorageInfo = Schema.Struct({
  /** File the settings are read from and written to; absent when nothing is saved. */
  configPath: Schema.optional(Schema.String),
  /** Repository the first-run setup should propose: the config's directory or the git root. */
  defaultRepoPath: Schema.optional(Schema.String),
  mode: StorageMode,
});
export type StorageInfo = typeof StorageInfo.Type;

export const PersistInput = Schema.Struct({
  /** Absolute path of the configuration file to create. */
  configPath: Schema.String,
  /** Replace a file that is already there. */
  overwrite: Schema.optional(Schema.Boolean),
  settings: Settings,
});
export type PersistInput = typeof PersistInput.Type;

export const PersistResult = Schema.Struct({
  /** How to start the tool against the saved file next time. */
  command: Schema.optional(Schema.String),
  configPath: Schema.optional(Schema.String),
  validation: SettingsValidation,
});
export type PersistResult = typeof PersistResult.Type;
