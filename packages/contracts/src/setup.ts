import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";
import { FrameworkId } from "./settings.ts";

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
});
export type SetupSuggestions = typeof SetupSuggestions.Type;

export const CreateDesignsInput = Schema.Struct({
  designsDir: RepoRelativePath,
  /**
   * Link the anchor's `node_modules` into the designs directory, so editors and `tsc` resolve
   * what the screens import. The preview does not need it.
   */
  linkDependencies: Schema.Boolean,
  repoPath: Schema.String,
  resolveFrom: Schema.optional(RepoRelativePath),
});
export type CreateDesignsInput = typeof CreateDesignsInput.Type;

export const CreateDesignsResult = Schema.Struct({
  /** Repo-relative paths of what was created; empty when everything was already there. */
  created: Schema.Array(Schema.String),
});
export type CreateDesignsResult = typeof CreateDesignsResult.Type;
