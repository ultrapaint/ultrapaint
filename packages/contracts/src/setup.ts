import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";
import { DEFAULT_DESIGNS_DIR, type Settings } from "./settings.ts";
import { StyleSystemId } from "./tokens.ts";

/** A package of the repository that holds the application: a hint for the agents that implement. */
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
});
export type CreateDesignsInput = typeof CreateDesignsInput.Type;

export const CreateDesignsResult = Schema.Struct({
  /** Repo-relative paths of what was created; empty when everything was already there. */
  created: Schema.Array(Schema.String),
});
export type CreateDesignsResult = typeof CreateDesignsResult.Type;

/** A new application, written where the repository has none (ADR 0025). */
/**
 * What a new application starts with: `starter`, a component for each system component; `blank`, none,
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

/** A stylesheet of the repository (`apps/web/src/app.css`) as the settings name it. */
export const hostCssFor = (designsDir: string, file: string): string =>
  relativePosix(`${designsDir}/${GENERATED_DIR}`, file);

/**
 * The file of the repository a stylesheet the settings name is (`hostCssFor` undone); a package's
 * stylesheet (`@acme/ui/styles.css`) is named as it is.
 */
export const stylesheetOf = (designsDir: string, spec: string): string => {
  if (!spec.startsWith(".")) {
    return spec;
  }
  const parts: string[] = [];
  for (const segment of `${designsDir}/${GENERATED_DIR}/${spec}`.split("/")) {
    if (segment === ".." && parts.length > 0) {
      parts.pop();
    } else if (segment !== "" && segment !== "." && segment !== "..") {
      parts.push(segment);
    }
  }
  return parts.join("/");
};

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
    hostCss: css ? [hostCssFor(designsDir, css)] : [],
    libraryDirs: library ? [library.sourceDir] : [],
    // A designs directory that is a package resolves its own imports.
    resolveFrom: anchor && anchor.dir !== designsDir ? anchor.dir : undefined,
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
