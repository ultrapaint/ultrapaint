/**
 * What a framework gives the server, on the Node side: how components are catalogued, how the
 * repository's design system is read, and how the preview is built. The server knows
 * repositories, files, design documents and the editor's protocol; everything that depends on
 * the UI framework, its bundler or its styling comes through this interface, as a Storybook
 * framework package (`@storybook/react-vite`) does for Storybook's core.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { SetupSuggestions } from "@ultrapaint/contracts/setup";

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

export interface DesignSystemContext {
  /** Package the pages resolve their imports from. Absolute. */
  readonly anchorDir: string;
  /** Repository root. Absolute. */
  readonly root: string;
  readonly settings: Settings;
}

export interface DesignSystemScan {
  readonly designSystem: DesignSystem;
  /** The stylesheets that were read, repo-relative. */
  readonly files: readonly string[];
  /** What the scan could not make sense of, in words an agent can follow up on. */
  readonly notes: readonly string[];
}

export interface DesignSystemReader {
  /**
   * Reads the tokens the repository's stylesheets define, by fixed rules: the `@theme` blocks
   * of Tailwind v4 and the custom properties they refer to. Synchronous and read-only.
   */
  readonly scan: (ctx: DesignSystemContext) => DesignSystemScan;
}

export interface PreviewInput {
  /** Package the pages resolve their imports from. Absolute. */
  readonly anchorDir: string;
  /** Specifiers of the component modules the preview must be able to import. */
  readonly components: readonly string[];
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
   * The module listing the component modules instances import, rewritten into `input.dir`
   * under `file` whenever the list grows; the preview picks it up without a reload.
   */
  readonly components: {
    readonly file: string;
    readonly render: (specifiers: readonly string[]) => string;
  };
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
  readonly designSystem: DesignSystemReader;
  /** Synchronous and read-only: it looks at manifests and file names, never runs anything. */
  readonly detect: Detect;
  readonly id: string;
  readonly preview: PreviewBuilder;
}

/** Where a framework implementation came from; a repository may pin its own later on. */
export interface LocatedFramework {
  readonly framework: Framework;
  readonly origin: "bundled" | "installed";
}
