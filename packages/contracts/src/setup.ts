import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";
import { DEFAULT_DESIGNS_DIR, FrameworkId, type Settings } from "./settings.ts";
import { StyleSystemId } from "./tokens.ts";

/** A package of the repository the screens could resolve their imports from. */
export const AnchorSuggestion = Schema.Struct({
  dir: RepoRelativePath,
  name: Schema.String,
  /** Why it is suggested, in words the setup can show. */
  reason: Schema.String,
});
export type AnchorSuggestion = typeof AnchorSuggestion.Type;

/** A package of the repository that looks like a component library. */
export const LibrarySuggestion = Schema.Struct({
  dir: RepoRelativePath,
  /**
   * The components are a directory of the application itself (`front/src/components`), not a
   * package of their own: nothing imports them by a package name.
   */
  inApp: Schema.optional(Schema.Boolean),
  name: Schema.String,
  /** Directory with the component sources, to stamp and catalogue. */
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
  framework: FrameworkId,
  libraries: Schema.Array(LibrarySuggestion),
  repoName: Schema.String,
  /** The repository's root has a package.json: a new application goes in a directory of it. */
  rootManifest: Schema.optional(Schema.Boolean),
  /** The style system the stylesheets are written for, when one the tool reads is found. */
  styleSystem: Schema.optional(StyleSystemId),
  /**
   * Which Tailwind the stylesheets set up. Only v4 is supported: its `@theme` is where the
   * design system's tokens are read from.
   */
  tailwind: Schema.Literals(["v4", "v3", "none"]),
});
export type SetupSuggestions = typeof SetupSuggestions.Type;

export const CreateDesignsInput = Schema.Struct({
  designsDir: RepoRelativePath,
  repoPath: Schema.String,
  resolveFrom: Schema.optional(RepoRelativePath),
});
export type CreateDesignsInput = typeof CreateDesignsInput.Type;

export const CreateDesignsResult = Schema.Struct({
  /** Repo-relative paths of what was created; empty when everything was already there. */
  created: Schema.Array(Schema.String),
});
export type CreateDesignsResult = typeof CreateDesignsResult.Type;

/** A new application, written where the repository has none (ADR 0025). */
/**
 * What a new application starts with: `starter`, ten components to design with; `blank`, none,
 * and a theme that declares nothing (PLAN-desktop D11).
 */
export const ScaffoldTemplate = Schema.Literals(["starter", "blank"]);
export type ScaffoldTemplate = typeof ScaffoldTemplate.Type;

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
    hostCss: Schema.Array(Schema.String),
    libraryDirs: Schema.Array(RepoRelativePath),
    resolveFrom: Schema.optional(RepoRelativePath),
  }),
});
export type ScaffoldResult = typeof ScaffoldResult.Type;

/** Directory the preview is generated into; host CSS imports are written relative to it. */
const GENERATED_DIR = ".ultrapaint";

/** Relative posix path from a directory to a file, both relative to the same root. */
export const relativePosix = (fromDir: string, toFile: string): string => {
  const from = fromDir.split("/").filter((s) => s && s !== ".");
  const to = toFile.split("/").filter((s) => s && s !== ".");
  let shared = 0;
  while (
    shared < from.length &&
    shared < to.length - 1 &&
    from[shared] === to[shared]
  ) {
    shared += 1;
  }
  return [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/");
};

/**
 * The settings the first-run setup proposes for a repository: an existing designs directory or
 * the default one, the best anchor, the first component library and its stylesheet. Every
 * value stays editable in the form.
 */
export const applySuggestions = (
  settings: Settings,
  found: SetupSuggestions
): Settings => {
  const designsDir = found.designsDirs[0] ?? DEFAULT_DESIGNS_DIR;
  const [anchor] = found.anchors;
  const [library] = found.libraries;
  // A stylesheet of the designs directory itself wins: it was written for the pages.
  const css =
    found.cssEntries.find((file) => file.startsWith(`${designsDir}/`)) ??
    found.cssEntries[0];
  return {
    ...settings,
    componentPackages: library && !library.inApp ? [library.name] : [],
    designsDir,
    framework: found.framework,
    ...(found.styleSystem && { styleSystem: found.styleSystem }),
    hostCss: css ? [relativePosix(`${designsDir}/${GENERATED_DIR}`, css)] : [],
    libraryDirs: library ? [library.sourceDir] : [],
    // A designs directory that is a package resolves its own imports.
    resolveFrom: anchor && anchor.dir !== designsDir ? anchor.dir : undefined,
  };
};

/** What the form shows about a detection, in one sentence. */
export const describeSuggestions = (found: SetupSuggestions): string => {
  const [anchor] = found.anchors;
  const [library] = found.libraries;
  if (!(anchor || library)) {
    return `Nothing in ${found.repoName} looks like a React package. Fill the fields in by hand.`;
  }
  const parts = [
    library?.inApp ? `components in ${library.sourceDir}` : null,
    library && !library.inApp ? `component library ${library.name}` : null,
    anchor ? `imports resolved from ${anchor.name} (${anchor.reason})` : null,
    found.designsDirs[0]
      ? `pages in ${found.designsDirs[0]}`
      : `no designs directory yet, proposing ${DEFAULT_DESIGNS_DIR}`,
  ].filter(Boolean);
  return `Found in ${found.repoName}: ${parts.join("; ")}.`;
};
