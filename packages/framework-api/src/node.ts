import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type {
  UsageInventory,
  UsageKind,
  UsageLeft,
  UsageValue,
} from "@ultrapaint/contracts/design-system-setup";
import type { ClassWriter } from "@ultrapaint/contracts/node-style";
import type { Settings } from "@ultrapaint/contracts/settings";
import type { SetupSuggestions } from "@ultrapaint/contracts/setup";
import type {
  FileEdit,
  StyleSystemId,
  TokenChange,
  TokenSource,
} from "@ultrapaint/contracts/tokens";

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
   * A run's rewrite of files onto the design system where the mapping (keyed by `mappingKey`,
   * null for a value kept as it is) settles it and the rewrite is mechanical: classes, style
   * values and stylesheet declarations. Made once per run, so the design system is read once
   * for every file. Pure.
   */
  readonly rewriter: (
    ctx: UsageContext,
    mapping: ReadonlyMap<string, string | null>
  ) => (file: string, text: string) => UsageRewrite;
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

/** What a framework recognises in a repository; null when the repository is not its kind. */
export type Detect = (
  root: string
) => Omit<
  SetupSuggestions,
  "cssEntries" | "framework" | "repoName" | "styleSystem" | "tailwind"
> | null;

export interface Framework {
  /** Synchronous and read-only: it looks at manifests and file names, never runs anything. */
  readonly detect: Detect;
  readonly id: string;
  /** A new application to start from, for a repository that has none (phase 6 of the sync). */
  readonly scaffold?: Scaffold;
}

/** What a style system recognises: the stylesheets that set it up, and whether it is its kind. */
export interface StyleSuggestions {
  readonly cssEntries: readonly string[];
  /** Which Tailwind the stylesheets set up; only v4 is read. */
  readonly tailwind: "v4" | "v3" | "none";
}

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
  /** The stylesheets of the packages in `dirs` (absolute) that set the style system up. */
  readonly detect: (root: string, dirs: readonly string[]) => StyleSuggestions;
  readonly id: StyleSystemId;
  /**
   * How a node of a design is written in this style system's classes, its design system's
   * styles made once: the inspector's Code tab writes a node's JSX with it, as `codeRules` tells
   * agents to. Pure.
   */
  readonly nodeClasses: (designSystem: DesignSystem | null) => ClassWriter;
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

/**
 * What a new application starts with: `starter`, a set of components to design with; `blank`,
 * none, and a theme that declares nothing, for a design system defined from nothing.
 */
export type ScaffoldTemplate = "starter" | "blank";

export type Scaffold = (input: {
  /** Repo-relative directory the application goes in; `.` for the root. */
  readonly dir: string;
  /** The application's name, for its package.json. */
  readonly name: string;
  /** `starter` when absent. */
  readonly template?: ScaffoldTemplate;
  /** Tokens to start the theme with, by name; the template's own when empty. */
  readonly tokens: Readonly<Record<string, string>>;
}) => ScaffoldResult;
