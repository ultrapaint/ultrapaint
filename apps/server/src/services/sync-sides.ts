/**
 * The sync's sides (ADR 0025, 0027, 0028): the code, the newest Figma import and DESIGN.md, each
 * read and compared with the design system, and written once the user has picked. A side says
 * where its tokens and its baseline come from and where they go; the engine (`sync-engine.ts`)
 * works out the outcomes, the changes and where the two agree after, the same for every side.
 *
 * - The code (`CodeSide`) is matched by name, and its baseline (`codeSync`) is moved whenever
 *   either is written.
 *
 * What a side gives the design system is the editor's operations (`editsOf`), checked as an edit
 * is and written by the design system's one write path, which tells the code with `codeTokens:
 * auto`. A baseline moves by `moveBaseline`, outside the undo history.
 * - Figma is never written: its baseline (`sync`, or `FigmaBaseline`'s while there is no design
 *   system) keeps both sides' values and the matches, by Figma's id, for one file.
 * - DESIGN.md (`DesignMd`) is rewritten in the design system's names with its values, and its
 *   baseline (`designMd`) is what its mirror agrees on.
 */
import type { DocumentMatch } from "@ultrapaint/contracts/design-system";
import { BadRequest } from "@ultrapaint/contracts/errors";
import type {
  FigmaMatch,
  SyncBaseline,
  TokenComparison,
  TokenDiff,
  TokenSourceKind,
} from "@ultrapaint/contracts/sync";
import {
  applyEdits,
  editsOf,
} from "@ultrapaint/design-document/design-system-edits";
import type { TokenGroups } from "@ultrapaint/design-md/format";
import { emptyGroups } from "@ultrapaint/design-md/format";
import { mergeMirror } from "@ultrapaint/design-md/merge";
import { parse } from "@ultrapaint/design-md/parse";
import {
  documentPathOf,
  documentTokens,
  groupsOf,
} from "@ultrapaint/design-md/tokens";
import { renameRefs, withMirror } from "@ultrapaint/design-md/write";
import { plural } from "@ultrapaint/shared/text";
import { Clock, Effect } from "effect";
import { sortedByKey } from "../hash.ts";
import type { ProjectServices } from "../project.ts";
import { CodeSide } from "./code-side.ts";
import { DesignMd, documentBaseline } from "./design-md.ts";
import { DesignSystemService } from "./design-system.ts";
import { FigmaBaseline } from "./figma-baseline.ts";
import { FigmaImportService } from "./figma-import.ts";
import {
  compareSide,
  type GivenMatch,
  type SideChanges,
  type SideToken,
} from "./sync-engine.ts";
import {
  compareDocument,
  compareFigma,
  designTokensOf,
  documentSideTokens,
  figmaBaselineAfter,
  figmaSide,
  matchKeyOf,
} from "./sync-readings.ts";

interface Written {
  readonly files: readonly string[];
  readonly written: number;
}

/** A side read and compared, with what writing it and keeping its matches come to. */
interface SideReading {
  readonly comparison: TokenComparison;
  /**
   * Its matches, for a side matched by the rules and the user: the side's tokens, what they are
   * called in a problem, and the matches given kept in its baseline, coming to a new comparison.
   */
  readonly matching: {
    readonly save: (
      set: ReadonlyMap<string, GivenMatch>
    ) => Effect.Effect<readonly TokenDiff[], BadRequest, ProjectServices>;
    readonly tokens: readonly SideToken[];
    readonly what: string;
  } | null;
  /**
   * Writes what the user's picks come to (`changes`) and moves the side's baseline forward,
   * `settled` naming the values the sync settled.
   */
  readonly write: (
    changes: SideChanges,
    settled: ReadonlySet<string>
  ) => Effect.Effect<Written, BadRequest, ProjectServices>;
}

/** A side adapter: how one side is read, matched and kept. */
interface SideAdapter {
  /** Matched by name, so there is nothing to match. */
  readonly byName: boolean;
  /** Why nothing can be taken or matched, when there is no such side. */
  readonly missing: (doing: "match" | "take") => string;
  /** The side compared; null when there is none. */
  readonly read: Effect.Effect<SideReading | null, BadRequest, ProjectServices>;
}

const nothing: readonly string[] = [];

/** A baseline or document that could not be written, as the caller hears it. */
const unsaved =
  (what: string) =>
  (error: { readonly message: string }): BadRequest =>
    new BadRequest({ message: `${what}: ${error.message}` });

/**
 * The tokens a side is compared with, and is matched to: the design system's (ADR 0028), or the
 * code's own while there is no design system yet, which is then made from the code. A style
 * system's default the code does not declare is none of them.
 */
export const targetTokens = Effect.gen(function* () {
  const { designSystem: ds } = yield* (yield* DesignSystemService).get;
  if (ds) {
    return designTokensOf(ds);
  }
  const { tokens } = yield* (yield* CodeSide).tokens;
  return tokens.filter((t) => t.own);
});

/** The code (ADR 0028): what it changed taken into the design system, the design's written to it. */
const codeAdapter: SideAdapter = {
  byName: true,
  missing: () =>
    "There is no design system yet to compare the code with: Sync makes one.",
  read: Effect.gen(function* () {
    const service = yield* DesignSystemService;
    const code = yield* CodeSide;
    const { designSystem: ds } = yield* service.get;
    if (!ds) {
      return null;
    }
    const { read: _read, ...comparison } = yield* code.comparison(ds);
    return {
      comparison,
      matching: null,
      // `codeSync` moves with every write, of either side.
      write: ({ toDesign, toSource }) =>
        Effect.gen(function* () {
          const taken =
            toDesign.length > 0
              ? yield* service.edit(
                  editsOf(ds, toDesign),
                  "Take the code's tokens"
                )
              : { files: nothing };
          const written =
            toSource.length > 0
              ? yield* code.write(toSource, (yield* service.get).designSystem)
              : { files: nothing };
          return {
            files: [...new Set([...taken.files, ...written.files])],
            written: toSource.length + toDesign.length,
          };
        }),
    } satisfies SideReading;
  }),
};

/**
 * What the last sync with a Figma file agreed on: the design system's baseline, or the one
 * waiting for a design system. A baseline from another Figma file says nothing about this one.
 */
export const figmaBaselineOf = (file: string) =>
  Effect.gen(function* () {
    const { designSystem } = yield* (yield* DesignSystemService).get;
    const stored =
      designSystem?.sync ?? (yield* (yield* FigmaBaseline).pending);
    return stored?.file === file ? stored : null;
  });

/**
 * Keeps a sync's baseline with Figma: in `design-system.json` when there is one, else until
 * there is.
 */
const saveFigmaBaseline = Effect.fnUntraced(function* (next: SyncBaseline) {
  const service = yield* DesignSystemService;
  const waiting = yield* FigmaBaseline;
  const { designSystem } = yield* service.get;
  if (!designSystem) {
    return yield* waiting.wait(next);
  }
  yield* service.moveBaseline("sync", () => next);
  yield* waiting.clear;
});

/**
 * The newest Figma import (ADR 0025): what it changed taken into the design system, or into the
 * code while there is no design system yet, which is then made from the code. Figma is not
 * written.
 */
const figmaAdapter: SideAdapter = {
  byName: false,
  missing: (doing) => `There is no Figma import to ${doing} tokens from.`,
  read: Effect.gen(function* () {
    const newest = yield* (yield* FigmaImportService).latestTokens;
    if (!newest) {
      return null;
    }
    const { file: latest, tokens: figma } = newest;
    const design = yield* targetTokens;
    const service = yield* DesignSystemService;
    const baseline = yield* figmaBaselineOf(latest.name);
    const side = figmaSide(figma.tokens, design, baseline);
    const diffs = compareSide(side, design);
    const file = latest.name;
    return {
      comparison: {
        // Matches saved before any value was taken are no earlier sync to compare with.
        baseline: baseline !== null && Object.keys(baseline.figma).length > 0,
        diffs,
        file,
        importId: latest.id,
        notes: [...figma.notes],
        source: "figma",
        targets: design
          .filter((t) => t.own)
          .map((t) => ({ kind: t.kind, name: t.name })),
      },
      matching: {
        save: (set) =>
          Effect.gen(function* () {
            const matches: Record<string, FigmaMatch> = {
              ...baseline?.matches,
            };
            for (const [variable, { match, token }] of set) {
              const key = matchKeyOf(token);
              if (match) {
                matches[key] = { ...match, figma: variable };
              } else {
                delete matches[key];
              }
            }
            const next: SyncBaseline = {
              ...(baseline ?? { at: 0, code: {}, figma: {} }),
              file,
              matches: sortedByKey(matches),
            };
            const after = compareFigma(figma.tokens, design, next);
            // A match that leaves something to write puts the step back in front of the user.
            const pending = after.some(
              (d) => d.outcome === "to-design" || d.outcome === "conflict"
            );
            yield* saveFigmaBaseline(pending ? { ...next, at: 0 } : next).pipe(
              Effect.mapError(unsaved("the matches could not be saved"))
            );
            return after;
          }),
        tokens: figma.tokens,
        what: `a variable or style of ${file}`,
      },
      write: ({ toDesign }, settled) =>
        Effect.gen(function* () {
          const { designSystem: ds } = yield* service.get;
          let files = nothing;
          if (toDesign.length > 0) {
            ({ files } = ds
              ? yield* service.edit(
                  editsOf(ds, toDesign),
                  `Take ${file}'s tokens`
                )
              : yield* (yield* CodeSide).write(toDesign, null));
          }
          // Where Figma and the design system stand now, for the next sync to compare with.
          yield* saveFigmaBaseline(
            figmaBaselineAfter({
              at: yield* Clock.currentTimeMillis,
              baseline,
              design: yield* targetTokens,
              diffs,
              file,
              settled,
              side,
            })
          ).pipe(Effect.mapError(unsaved("the baseline could not be saved")));
          return { files, written: toDesign.length };
        }),
    } satisfies SideReading;
  }),
};

/**
 * DESIGN.md once its tokens are taken (ADR 0027): every matched token under the design system's
 * name, its references renamed; the colours, radii and spacing the design system's, with its
 * values; what is still unmatched kept as the document has it; its text styles as they are, for
 * the agent. Null when its YAML does not read.
 */
const documentAfter = (
  text: string,
  diffs: readonly TokenDiff[],
  mirror: TokenGroups
): string | null => {
  const renames = new Map<string, string>();
  for (const d of diffs) {
    if (d.outcome === "unmatched" || d.outcome === "ignored") {
      continue;
    }
    const to = documentPathOf(d.name);
    if (to !== null && to !== d.variable) {
      renames.set(d.variable, to);
    }
  }
  const renamed = renameRefs(text, renames);
  const unmatched = new Set(
    diffs.filter((d) => d.outcome === "unmatched").map((d) => d.variable)
  );
  const own = groupsOf(parse(renamed)).groups;
  const kept = <A>(group: "colors" | "rounded" | "spacing") =>
    Object.fromEntries(
      Object.entries(own[group]).filter(([key]) =>
        unmatched.has(`${group}.${key}`)
      )
    ) as Record<string, A>;
  const written = withMirror(renamed, {
    ...emptyGroups(),
    colors: { ...mirror.colors, ...kept<string>("colors") },
    components: mirror.components,
    rounded: { ...mirror.rounded, ...kept<string>("rounded") },
    spacing: { ...mirror.spacing, ...kept<number | string>("spacing") },
    typography: own.typography,
  });
  return "problem" in written ? null : written.text;
};

/** What a few of a document's settings are, in a note: four of them, then how many more. */
const someOf = (paths: readonly string[]) =>
  `${paths.slice(0, 4).join(", ")}${paths.length > 4 ? ", …" : ""}`;

/** What the document holds that tokens cannot say: its text styles, its components' looks. */
const documentNotes = (
  path: string,
  held: readonly { readonly path: string }[]
) => {
  const typography = held
    .filter((h) => h.path.startsWith("typography."))
    .map((h) => h.path);
  const components = held
    .filter((h) => h.path.startsWith("components."))
    .map((h) => h.path);
  return [
    ...(typography.length > 0
      ? [
          `${plural(typography.length, "text style setting")} of ${path} differ from the design system's (${someOf(typography)}): a text style is several tokens, so /sync design settles them with you.`,
        ]
      : []),
    ...(components.length > 0
      ? [
          `${plural(components.length, "component setting")} of ${path} differ from the components' looks (${someOf(components)}). A system component's look is its file's, edited on its board: taking the document's tokens puts the look's back; change the look to change them.`,
        ]
      : []),
  ];
};

const noDocument =
  "There is no DESIGN.md at the root of the repository, beside a design system, to take tokens from.";

/**
 * DESIGN.md's front matter (ADR 0027): the design system takes what the document changed alone
 * and the conflicts given to it, listing the tokens new to it; the document is rewritten in the
 * design system's names, its references with it, what was left out taken out of it, and what is
 * still unmatched kept. With `codeTokens: auto` the code follows, as it follows every write.
 */
const designMdAdapter: SideAdapter = {
  byName: false,
  missing: () => noDocument,
  read: Effect.gen(function* () {
    const service = yield* DesignSystemService;
    const { designSystem: ds, document } = yield* service.get;
    if (!(ds && document) || document.legacy) {
      return null;
    }
    const design = designTokensOf(ds);
    const { problems, tokens: found } = documentTokens(parse(document.text));
    const tokens = documentSideTokens(found);
    const baseline = ds.designMd ?? null;
    const diffs = compareDocument(tokens, design, baseline);
    return {
      comparison: {
        baseline: baseline !== null && baseline.at > 0,
        diffs,
        file: document.path,
        notes: [...problems, ...documentNotes(document.path, document.held)],
        source: "designMd",
        targets: design.map((t) => ({ kind: t.kind, name: t.name })),
      },
      matching: {
        save: (set) =>
          Effect.gen(function* () {
            const matches: Record<string, DocumentMatch> = {
              ...baseline?.matches,
            };
            for (const [variable, { match }] of set) {
              if (match) {
                matches[variable] = match;
              } else {
                delete matches[variable];
              }
            }
            const next = documentBaseline(baseline, {
              matches: sortedByKey(matches),
            });
            yield* service
              .moveBaseline("designMd", (previous) =>
                documentBaseline(previous, { matches: sortedByKey(matches) })
              )
              .pipe(Effect.mapError(unsaved("the matches could not be saved")));
            return compareDocument(tokens, design, next);
          }),
        tokens,
        what: `a token of ${document.path}`,
      },
      write: ({ toDesign }) =>
        Effect.gen(function* () {
          const after = yield* service.get;
          const base = after.designSystem ?? ds;
          const listed = applyEdits(base, editsOf(base, toDesign));
          if ("problem" in listed) {
            return yield* new BadRequest({ message: listed.problem });
          }
          const current = after.document;
          if (!current) {
            return yield* new BadRequest({ message: noDocument });
          }
          const mirror = yield* (yield* DesignMd).mirror(listed);
          const text = documentAfter(current.text, diffs, mirror);
          if (text === null) {
            return yield* new BadRequest({
              message: `${current.path}'s YAML does not read, so it cannot be rewritten.`,
            });
          }
          // What the rewritten document and the design system now agree on, by the mirror's
          // rule: a text style is the agent's to settle, so what was agreed on one stays.
          const { agreed } = mergeMirror(
            parse(text),
            mirror,
            listed.designMd?.agreed ?? {}
          );
          // Its matches were by the document's names, which are the design system's now.
          const { files } = yield* service
            .replace(
              {
                ...listed,
                designMd: documentBaseline(listed.designMd, {
                  agreed,
                  at: yield* Clock.currentTimeMillis,
                  matches: null,
                }),
              },
              text,
              `Take ${current.path}'s tokens into the design system`
            )
            .pipe(
              Effect.mapError(unsaved(`${current.path} could not be written`))
            );
          return {
            files: [current.path, ...files.filter((f) => f !== current.path)],
            written: toDesign.length,
          };
        }),
    } satisfies SideReading;
  }),
};

/** Each side by the name callers give it. */
export const syncSides: Readonly<Record<TokenSourceKind, SideAdapter>> = {
  code: codeAdapter,
  designMd: designMdAdapter,
  figma: figmaAdapter,
};
