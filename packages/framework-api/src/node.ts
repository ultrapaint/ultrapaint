/**
 * What a framework gives the server, on the Node side: how screens are written, how their
 * source is edited, how components are catalogued and how the preview is built. The server
 * knows repositories, files and the editor's protocol; everything that depends on the UI
 * framework or its bundler comes through this interface, as a Storybook framework package
 * (`@storybook/react-vite`) does for Storybook's core.
 */
import type { SourceLocation } from "@ultrapaint/contracts/base";
import type { EditOp, ElementSource } from "@ultrapaint/contracts/edit";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { SetupSuggestions } from "@ultrapaint/contracts/setup";

/** Result of one source edit, before the target repository's formatter runs. */
export interface EditOutcome {
  code: string;
  /** Pre-order index of the element to track after formatting, or null. */
  trackIndex: number | null;
  warnings: string[];
}

/**
 * A source edit that cannot be carried out: the element is gone (`not_found`) or the source
 * is in a shape the edit does not apply to (`conflict`). Anything else a framework throws means
 * the file could not be parsed.
 */
export class SourceEditError extends Error {
  readonly code: "not_found" | "conflict";

  constructor(code: "not_found" | "conflict", message: string) {
    super(message);
    this.code = code;
    this.name = "SourceEditError";
  }
}

/** Pure and synchronous: these throw, and the server turns that into wire errors. */
export interface SourceEditor {
  readonly apply: (op: EditOp, code: string) => EditOutcome;
  readonly elementSource: (
    code: string,
    file: string,
    location: SourceLocation,
    editable: boolean
  ) => ElementSource | null;
  /** Where the element with this pre-order index is, in the formatted code. */
  readonly locate: (
    code: string,
    file: string,
    trackIndex: number
  ) => SourceLocation | null;
}

export interface ScreenFiles {
  /** A copy of a screen under a new file name: the component is renamed with the file. */
  readonly duplicate: (content: string, from: string, to: string) => string;
  /** File extension of a screen, with the dot. */
  readonly extension: string;
  /** File name for what the user typed: `Sign in` becomes `sign-in.tsx`. */
  readonly fileName: (name: string) => string;
  readonly isScreenFile: (fileName: string) => boolean;
  readonly render: (templateId: string, fileName: string) => string;
  readonly templates: readonly { readonly id: string; readonly name: string }[];
}

/** Plain data, so the whole context can be handed to a worker thread. */
export interface CatalogueContext {
  readonly componentPackages: readonly string[];
  /** Absolute paths, already checked to be inside the repository. */
  readonly libraryDirs: readonly string[];
  /** Repository root; component files are reported relative to it. */
  readonly root: string;
}

export interface CatalogueBuilder {
  /** Changes whenever the result could: the files, their timestamps, the extractor's version. */
  readonly cacheKey: (
    ctx: CatalogueContext,
    files: readonly string[]
  ) => string;
  readonly sourceFiles: (ctx: CatalogueContext) => string[];
  /**
   * Module run on a worker thread with `{ ctx, files }` as its worker data; it posts the
   * `Catalogue`. Extraction takes seconds on a real design system.
   */
  readonly workerUrl: URL;
}

export interface PreviewInput {
  /** Package the screens resolve their imports from. Absolute. */
  readonly anchorDir: string;
  /** Absolute. */
  readonly designsDir: string;
  /** The generated, git-ignored directory the preview is served from. Absolute. */
  readonly dir: string;
  /** Repository root. Absolute. */
  readonly root: string;
  readonly settings: Settings;
}

export interface PreviewBuilder {
  /**
   * Files to write into `input.dir`, and the Node script that serves the preview: it is run
   * from the anchor package with `args` followed by the port to listen on.
   */
  readonly generate: (input: PreviewInput) => Promise<{
    readonly files: Record<string, string>;
    readonly serve: {
      readonly args: readonly string[];
      readonly script: string;
    };
  }>;
}

/** What a framework recognises in a repository; null when the repository is not its kind. */
export type Detect = (
  root: string
) => Omit<SetupSuggestions, "framework" | "repoName"> | null;

export interface Framework {
  readonly catalogue: CatalogueBuilder;
  /** Synchronous and read-only: it looks at manifests and file names, never runs anything. */
  readonly detect: Detect;
  readonly id: string;
  readonly preview: PreviewBuilder;
  readonly screens: ScreenFiles;
  readonly source: SourceEditor;
}

/** Where a framework implementation came from; a repository may pin its own later on. */
export interface LocatedFramework {
  readonly framework: Framework;
  readonly origin: "bundled" | "installed";
}
