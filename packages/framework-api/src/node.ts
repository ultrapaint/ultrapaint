/**
 * What a framework gives the server, on the Node side: how components are catalogued, how the
 * repository's design system is read, and how the preview is built. The server knows
 * repositories, files, design documents and the editor's protocol; everything that depends on
 * the UI framework, its bundler or its styling comes through this interface, as a Storybook
 * framework package (`@storybook/react-vite`) does for Storybook's core.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  UsageInventory,
  UsageKind,
  UsageLeft,
  UsageValue,
} from "@ultrapaint/contracts/design-system-setup";
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
  /** The tokens the repository's own theme declares, as opposed to the framework's defaults. */
  readonly ownTokens: readonly string[];
}

export interface DesignSystemReader {
  /**
   * Reads the tokens the repository's stylesheets define, by fixed rules: the `@theme` blocks
   * of Tailwind v4 and the custom properties they refer to. Synchronous and read-only.
   */
  readonly scan: (ctx: DesignSystemContext) => DesignSystemScan;
}

/** One use of a value in a source file, as written, before it is held against a design system. */
export interface UsageOccurrence {
  /** Where `raw` ends in the file, for a rewrite; absent when it cannot be rewritten in place. */
  readonly end?: number;
  readonly line: number;
  /** A number in a style object, `padding: 12`, which a rewrite turns into a string. */
  readonly numeric?: boolean;
  /** As written, with its variants: `hover:bg-blue-500/50`, `style padding: 13`. */
  readonly raw: string;
  /** Where `raw` starts in the file; for a style or a declaration, where its value does. */
  readonly start?: number;
  /** What uses it: a utility (`bg`, `p`, `text`), `style:<property>`, `css:<property>`, `literal`, `element`. */
  readonly use: string;
  /** What is used: `blue-500`, `[#3b82f6]`, `13px`, `button`. */
  readonly value: string;
}

export interface UsageContext {
  /** The components of the catalogue, whose plain counterparts are reported. */
  readonly components: readonly string[];
  readonly designSystem: DesignSystem;
  /** Repo-relative directories of the component library: its own plain elements are its business. */
  readonly libraryDirs: readonly string[];
  /**
   * The tokens the repository's theme declares, when the design system is the theme's scan and
   * not one saved: the rest of its tokens are the framework's defaults. Null for a saved one.
   */
  readonly ownTokens: readonly string[] | null;
  /** Values listed per kind and status; 60 when left out. */
  readonly perGroup?: number;
}

/** What a value becomes by a rule, and why. */
export interface UsageSuggestion {
  readonly kind: UsageKind;
  readonly note: string;
  readonly target: string;
  readonly value: string;
}

export interface UsageRewrite {
  /** The rewrites made. */
  readonly changes: number;
  /** The uses off the system the rules could not rewrite, for an agent. */
  readonly left: readonly UsageLeft[];
  readonly text: string;
}

export interface UsageReader {
  /** Whether a repo-relative file is application source to read. */
  readonly includes: (file: string) => boolean;
  /**
   * One file rewritten onto the design system where the mapping (keyed by `mappingKey`, null for
   * a value kept as it is) settles it and the rewrite is mechanical: classes, style values and
   * stylesheet declarations. Pure.
   */
  readonly rewrite: (
    file: string,
    text: string,
    ctx: UsageContext,
    mapping: ReadonlyMap<string, string | null>
  ) => UsageRewrite;
  /** Every use in one file. Synchronous and pure: the server reads the file. */
  readonly scanFile: (file: string, text: string) => readonly UsageOccurrence[];
  /** What the values off the system become where a rule settles it: an exact match. */
  readonly suggest: (
    values: readonly UsageValue[],
    designSystem: DesignSystem
  ) => readonly UsageSuggestion[];
  /** The uses of every file, held against the design system. */
  readonly summarise: (
    files: readonly {
      readonly file: string;
      readonly uses: readonly UsageOccurrence[];
    }[],
    ctx: UsageContext,
    at: number
  ) => UsageInventory;
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
  /** What the application's code uses, for the design-system setup (ADR 0023). */
  readonly usage: UsageReader;
}

/** Where a framework implementation came from; a repository may pin its own later on. */
export interface LocatedFramework {
  readonly framework: Framework;
  readonly origin: "bundled" | "installed";
}
