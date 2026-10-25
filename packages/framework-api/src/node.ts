/**
 * What a framework and a style system give the server, on the Node side. A framework is the UI
 * library and its bundler: how components are catalogued and how the preview is built. A style
 * system is what the tokens and classes are written in (ADR 0024): how the tokens are read and
 * written back, what the code uses, and what the preview's stylesheet needs. The server knows
 * repositories, files, design documents and the editor's protocol; everything else comes
 * through these two interfaces, as a Storybook framework package (`@storybook/react-vite`)
 * does for Storybook's core.
 */
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  UsageInventory,
  UsageKind,
  UsageLeft,
  UsageValue,
} from "@ultrapaint/contracts/design-system-setup";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { SetupSuggestions } from "@ultrapaint/contracts/setup";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";
import type {
  ComponentStyle,
  DesignTokenValue,
  FileEdit,
  SourceToken,
  StyleSystemId,
  TokenChange,
  TokenSource,
} from "@ultrapaint/contracts/tokens";
import type { ClassWriter } from "@ultrapaint/design-document/code";

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
  /** What the style system puts in the preview's stylesheet, line by line. */
  readonly styles: readonly string[];
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
) => Omit<
  SetupSuggestions,
  "cssEntries" | "framework" | "repoName" | "styleSystem" | "tailwind"
> | null;

export interface Framework {
  readonly catalogue: CatalogueBuilder;
  /** Synchronous and read-only: it looks at manifests and file names, never runs anything. */
  readonly detect: Detect;
  readonly id: string;
  readonly preview: PreviewBuilder;
  /** A new application to start from, for a repository that has none (phase 6 of the sync). */
  readonly scaffold?: Scaffold;
}

/** What a style system recognises: the stylesheets that set it up, and whether it is its kind. */
export interface StyleSuggestions {
  readonly cssEntries: readonly string[];
  /** Which Tailwind the stylesheets set up; only v4 is read. */
  readonly tailwind: "v4" | "v3" | "none";
}

/** The preview's stylesheet is written into `dir`; its imports are relative to it. */
export interface PreviewStyleContext extends DesignSystemContext {
  /** The generated directory the preview is served from. Absolute. */
  readonly dir: string;
}

/** A component's `cva` classes as the catalogue reads them: the base, each member's, the defaults. */
export type ComponentStyles = NonNullable<ComponentMeta["styles"]>;

/** What a style system reads off a component's code into its spec (ADR 0029). */
export type SpecFromCode = Pick<
  ComponentSpec,
  "base" | "defaults" | "states" | "variants"
>;

/**
 * A style system (ADR 0024): Tailwind v4 today, StyleX or Emotion later. Synchronous and pure
 * apart from reading the repository's files; the server writes what it returns.
 */
export interface StyleSystem {
  /**
   * How a token and a page's fields become code in this style system, told to the agents that
   * implement a page.
   */
  readonly codeRules: string;
  /**
   * A component's classes read into the fields of its spec (ADR 0029): the root slot's style
   * fields in its base, in each variant member and in each state, tokens named as pages name
   * them where the classes name one of `tokens`.
   */
  readonly componentSpec: (
    styles: ComponentStyles,
    tokens: readonly SourceToken[]
  ) => SpecFromCode;
  /**
   * What a component's classes set in the state it starts in, as DESIGN.md's component tokens
   * hold it (ADR 0027), the code's tokens being `tokens`.
   */
  readonly componentStyle: (
    classes: string,
    tokens: readonly SourceToken[]
  ) => ComponentStyle;
  /** The stylesheets of the packages in `dirs` (absolute) that set the style system up. */
  readonly detect: (root: string, dirs: readonly string[]) => StyleSuggestions;
  readonly id: StyleSystemId;
  /**
   * How a node of a design is written in this style system's classes, its design system's
   * styles made once: the inspector's Code tab writes a node's JSX with it, as `codeRules` tells
   * agents to. Pure.
   */
  readonly nodeClasses: (designSystem: DesignSystem | null) => ClassWriter;
  /**
   * Lines of the preview's stylesheet: the repository's own stylesheets imported, and whatever
   * makes every token a custom property the preview can draw with.
   */
  readonly previewCss: (ctx: PreviewStyleContext) => readonly string[];
  /**
   * A stylesheet that gives the code's variables the design's values (ADR 0028): placed
   * unlayered after the code's CSS in the preview, the repository's components draw with
   * `tokens`. Plain CSS; empty when there is nothing to set.
   */
  readonly previewTokenCss: (
    ctx: DesignSystemContext,
    tokens: readonly DesignTokenValue[]
  ) => string;
  /** Every token the code declares, with where each value is written. */
  readonly readTokens: (ctx: DesignSystemContext) => TokenSource;
  /**
   * A first design system from the tokens, by fixed rules: the starting point `/init` hands an
   * agent, and all there is when no agent is used.
   */
  readonly scan: (ctx: DesignSystemContext) => DesignSystemScan;
  /** What the application's code uses, for the design-system setup (ADR 0023). */
  readonly usage: UsageReader;
  /**
   * The files as the changes leave them, only those that change. A change to a token that is
   * not declared adds it where new tokens go.
   */
  readonly writeTokens: (
    ctx: DesignSystemContext,
    changes: readonly TokenChange[]
  ) => readonly FileEdit[];
}

/** A new application's files, repo-relative, and what it needs installed. */
export interface ScaffoldResult {
  readonly files: Readonly<Record<string, string>>;
  /** The settings that point the tool at it, relative to the repository. */
  readonly settings: {
    readonly hostCss: string;
    readonly libraryDir: string;
    readonly resolveFrom: string;
  };
}

export type Scaffold = (input: {
  /** Repo-relative directory the application goes in; `.` for the root. */
  readonly dir: string;
  /** The application's name, for its package.json. */
  readonly name: string;
  /** Tokens to start the theme with, by name; the template's own when empty. */
  readonly tokens: Readonly<Record<string, string>>;
}) => ScaffoldResult;

/** Where a framework implementation came from; a repository may pin its own later on. */
export interface LocatedFramework {
  readonly framework: Framework;
  readonly origin: "bundled" | "installed";
}
