import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";
import { DEFAULT_DESIGNS_DIR, type Settings } from "./settings.ts";
import { StyleSystemId } from "./tokens.ts";

/** A package of the repository that holds the application: a hint for the agents that implement. */
const AnchorSuggestion = Schema.Struct({
  dir: RepoRelativePath,
  name: Schema.String,
  /** Why it is suggested, in words the setup can show. */
  reason: Schema.String,
});

/** A package of the repository that looks like a component library. */
export const LibrarySuggestion = Schema.Struct({
  dir: RepoRelativePath,
  name: Schema.String,
  /** Directory with the component sources: where the agents that implement look (ADR 0040). */
  sourceDir: RepoRelativePath,
});
export type LibrarySuggestion = typeof LibrarySuggestion.Type;

/**
 * What the first-run setup proposes for a repository. Everything is a suggestion the user
 * confirms; an empty list only means nothing was recognised.
 */
export const SetupSuggestions = Schema.Struct({
  anchors: Schema.Array(AnchorSuggestion),
  /** Stylesheets that set up the design system's CSS, relative to the repository. */
  cssEntries: Schema.Array(RepoRelativePath),
  /** Directories that already hold screens. */
  designsDirs: Schema.Array(RepoRelativePath),
  libraries: Schema.Array(LibrarySuggestion),
  repoName: Schema.String,
  /** The style system the stylesheets are written for, when one the tool reads is found. */
  styleSystem: Schema.optional(StyleSystemId),
  /**
   * Why the stylesheets are not read, in the style system's own words: when none is found. An
   * answer that still names a Tailwind version (`tailwind`) reads, and the version is dropped.
   */
  stylesNote: Schema.optional(Schema.String),
});
export type SetupSuggestions = typeof SetupSuggestions.Type;

export const CreateDesignsInput = Schema.Struct({
  designsDir: RepoRelativePath,
  repoPath: Schema.String,
});
export type CreateDesignsInput = typeof CreateDesignsInput.Type;

export const CreateDesignsResult = Schema.Struct({
  /** Repo-relative paths of what was created; empty when everything was already there. */
  created: Schema.Array(Schema.String),
});
export type CreateDesignsResult = typeof CreateDesignsResult.Type;

/**
 * What a new application starts with: `starter`, a component for each system component; `blank`, none,
 * and a theme that declares nothing (PLAN-desktop D11).
 */
export const ScaffoldTemplate = Schema.Literals(["starter", "blank"]);
export type ScaffoldTemplate = typeof ScaffoldTemplate.Type;

/** A new application, written where the repository has none (ADR 0025). */
export const ScaffoldInput = Schema.Struct({
  /** Where the pages go, repo-relative; `docs/designs` when absent. */
  designsDir: Schema.optional(RepoRelativePath),
  /** Repo-relative directory it goes in; `.` for the root. */
  dir: RepoRelativePath,
  /** Run the repository's package manager once the files are written. */
  install: Schema.Boolean,
  name: Schema.String,
  repoPath: Schema.String,
  /** `starter` when absent. */
  template: Schema.optional(ScaffoldTemplate),
});
export type ScaffoldInput = typeof ScaffoldInput.Type;

export const ScaffoldResult = Schema.Struct({
  /** Repo-relative paths of the files written. */
  created: Schema.Array(Schema.String),
  /** Whether the dependencies were installed. */
  installed: Schema.Boolean,
  /** The install's last lines, when it failed. */
  installLog: Schema.optional(Schema.String),
  /** The package manager it was installed with, or would be. */
  packageManager: Schema.String,
  /** Settings that point the tool at the new application, ready to apply. */
  settings: Schema.Struct({
    designsDir: RepoRelativePath,
    libraryDirs: Schema.Array(RepoRelativePath),
    resolveFrom: Schema.optional(RepoRelativePath),
    stylesheets: Schema.Array(Schema.String),
  }),
});
export type ScaffoldResult = typeof ScaffoldResult.Type;

/** The stylesheet detection proposes: one of the designs directory itself wins, it was written for the pages. */
const stylesheetIn = (found: SetupSuggestions, designsDir: string) =>
  found.cssEntries.find((file) => file.startsWith(`${designsDir}/`)) ??
  found.cssEntries[0];

/**
 * The settings the first-run setup proposes for a repository: an existing designs directory or
 * the default one, and the application's stylesheet, which is all it asks about. The best
 * anchor and the first component library are filled in too, as hints for the agents that
 * implement (ADR 0040). Every value stays editable in the settings.
 */
export const applySuggestions = (
  settings: Settings,
  found: SetupSuggestions
): Settings => {
  const designsDir = found.designsDirs[0] ?? DEFAULT_DESIGNS_DIR;
  const [anchor] = found.anchors;
  const [library] = found.libraries;
  const css = stylesheetIn(found, designsDir);
  return {
    ...settings,
    designsDir,
    ...(found.styleSystem && { styleSystem: found.styleSystem }),
    libraryDirs: library ? [library.sourceDir] : [],
    // A designs directory that is a package resolves its own imports.
    resolveFrom: anchor && anchor.dir !== designsDir ? anchor.dir : undefined,
    stylesheets: css ? [css] : [],
  };
};

/** What the form shows about a detection, in one sentence: where the pages and the stylesheet are. */
export const describeSuggestions = (found: SetupSuggestions): string => {
  const [designsDir] = found.designsDirs;
  const css = stylesheetIn(found, designsDir ?? DEFAULT_DESIGNS_DIR);
  const parts = [
    designsDir
      ? `pages in ${designsDir}`
      : `no designs directory yet, proposing ${DEFAULT_DESIGNS_DIR}`,
    css ? `the stylesheet ${css}` : "no stylesheet",
  ];
  return `Found in ${found.repoName}: ${parts.join("; ")}.`;
};
