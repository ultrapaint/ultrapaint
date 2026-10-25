import {
  DESIGN_MD_FILE,
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
  type DesignDocument,
  type DesignFinding,
  DesignSystem,
  type DesignSystemState,
  type DocumentBaseline,
  mapTokenRecords,
  mapTokens,
} from "@ultrapaint/contracts/design-system";
import { BadRequest } from "@ultrapaint/contracts/errors";
import {
  baselineKey,
  SyncBaseline,
  type TokenComparison,
} from "@ultrapaint/contracts/sync";
import type {
  DesignTokenValue,
  SourceToken,
  TokenChange,
} from "@ultrapaint/contracts/tokens";
import { serialise } from "@ultrapaint/design-document/factories";
import type { TokenGroups } from "@ultrapaint/design-md/format";
import {
  mergeMirror,
  resolvedValues,
  sameValue,
  valuesOf,
} from "@ultrapaint/design-md/merge";
import {
  type ComponentClasses,
  componentEntries,
  mirrorOf,
} from "@ultrapaint/design-md/mirror";
import { parse } from "@ultrapaint/design-md/parse";
import { groupsOf } from "@ultrapaint/design-md/tokens";
import { create, withMirror, withSection } from "@ultrapaint/design-md/write";
import type { DesignSystemScan } from "@ultrapaint/framework-api/node";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { EventBus } from "../events.ts";
import { makeStampedCache } from "../file-stamp.ts";
import { hashContent } from "../hash.ts";
import { CatalogueService } from "./catalogue.ts";
import { DesignMdLint } from "./design-md-lint.ts";
import {
  compareCode,
  designTokensOf,
  valuesByKey,
  withTokenChanges,
} from "./design-system-sync-rules.ts";
import {
  DESIGN_TOKENS_FILE,
  readDesignTokens,
  serialiseDesignTokens,
} from "./dtcg.ts";
import { type EditFailure, EditService, type EditTransaction } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Storage } from "./storage.ts";
import { ProjectStyleSystem } from "./style-system.ts";
import { sameValue as sameTokenValue } from "./token-values.ts";

const decodeDesignSystem = Schema.decodeUnknownEffect(DesignSystem);

/** Whether two sets of values by key say the same, however each value is written. */
const sameValues = (
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>
) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(
    ([key, value]) => b[key] !== undefined && sameTokenValue(value, b[key])
  );

/** Values by key in order, as a committed baseline keeps them. */
const sortedValues = (values: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
  );
const BaselineJson = Schema.fromJsonString(SyncBaseline);
const decodeBaseline = Schema.decodeUnknownEffect(BaselineJson);
const encodeBaseline = Schema.encodeEffect(BaselineJson);

/**
 * The design system as the project records it: `design-system.json` at the root of the designs
 * directory and `DESIGN.md` at the root of the repository (ADR 0027), the designs directory's
 * read while there is none there. `/init` has an agent write them through `write`, which
 * validates; `detect` writes what the fixed-rule scan finds, for a project without an agent.
 * Both are one undo step, and the editor hears about every change, whoever made it.
 *
 * `DESIGN.md`'s front matter mirrors the design system's values: when they change, the values
 * changed alone are written into the document, outside the undo history; what the document
 * changed is held for Sync (`@ultrapaint/design-md/merge`).
 *
 * A token's value is the design's (ADR 0028): the file keeps every value, and editing one is an
 * undo step in the designs directory. The code is a side, compared against `codeSync`; a value
 * reaches it on export, or at once with `codeTokens: auto`. A file written before that leaves
 * out the values the code declared: those are read from the code until the file is written again.
 * `design.tokens.json` is written beside it, in the Design Tokens format, with every change.
 */
export class DesignSystemService extends Context.Service<
  DesignSystemService,
  {
    readonly detect: Effect.Effect<DesignSystem, EditFailure>;
    readonly get: Effect.Effect<DesignSystemState>;
    /**
     * The state read again, the stylesheets from scratch: after a change to them that the files
     * read last time would not show, such as a stylesheet that was not there.
     */
    readonly refresh: Effect.Effect<DesignSystemState>;
    /** What the stylesheets say, with the catalogue's categories for the components. */
    readonly scan: Effect.Effect<DesignSystemScan>;
    /**
     * A token's value set in the design system, added when it does not list it yet, or taken out
     * (ADR 0028); one undo step. With `codeTokens: auto` the code is written too. Returns the
     * files written and the value before, for an undo.
     */
    readonly setToken: (change: TokenChange) => Effect.Effect<
      {
        readonly files: readonly string[];
        readonly previous: string | null;
      },
      BadRequest
    >;
    /** Several token changes to the design system at once, in one undo step. */
    readonly setTokens: (
      changes: readonly TokenChange[],
      label?: string
    ) => Effect.Effect<{ readonly files: readonly string[] }, BadRequest>;
    /**
     * Token changes written to the code where the style system declares them (the export, ADR
     * 0028), and what the code and the design system agree on moved with them.
     */
    readonly writeCode: (
      changes: readonly TokenChange[]
    ) => Effect.Effect<{ readonly files: readonly string[] }, BadRequest>;
    /** The tokens the code declares now, through the style system. */
    readonly codeTokens: Effect.Effect<readonly SourceToken[]>;
    /**
     * The code's tokens against the design system's (ADR 0028), against what the two last agreed
     * on; null without a design system. `read` says whether any stylesheet was read: without one
     * every token would wait for the code.
     */
    readonly codeComparison: Effect.Effect<
      (TokenComparison & { readonly read: boolean }) | null
    >;
    /**
     * `design.tokens.json` against the design system (ADR 0028), against the values the editor
     * last wrote into it: what another tool changed in it waits here. Null without a design
     * system, or without the file.
     */
    readonly designTokensComparison: Effect.Effect<TokenComparison | null>;
    /**
     * Token changes taken from `design.tokens.json` into the design system, and the file written
     * again from it with the baseline moved, whatever it held: one undo step. With
     * `codeTokens: auto` the code follows.
     */
    readonly takeDesignTokens: (
      changes: readonly TokenChange[]
    ) => Effect.Effect<{ readonly files: readonly string[] }, BadRequest>;
    /**
     * What the last sync with Figma agreed on: the design system's, or the one waiting in the
     * state directory for a design system to be written.
     */
    readonly baseline: Effect.Effect<SyncBaseline | null>;
    /** Keeps a sync's baseline: in `design-system.json` when there is one, else until there is. */
    readonly saveBaseline: (
      baseline: SyncBaseline
    ) => Effect.Effect<void, EditFailure>;
    /**
     * Puts `DESIGN.md` at the root of the repository: the designs directory's moved there, or a
     * first one made from the design system, its front matter filled in (ADR 0027).
     */
    readonly placeDocument: Effect.Effect<
      { readonly path: string },
      EditFailure
    >;
    /**
     * The front matter a design system comes to (ADR 0027, 0028): its tokens and their values in
     * the format, its components' tokens read from their classes. `document` stands in for the
     * components while the catalogue has not been read.
     */
    readonly mirror: (
      designSystem: DesignSystem,
      document: string | null
    ) => Effect.Effect<TokenGroups>;
    /**
     * One `##` section of `DESIGN.md` given its text, or added where the format orders it: what
     * the Design system panel's Edit writes. One undo step.
     */
    readonly setSection: (
      name: string,
      text: string
    ) => Effect.Effect<void, EditFailure>;
    /**
     * Saves the design system and `DESIGN.md` as given, in one undo step: for Sync, which has
     * merged them itself (ADR 0027).
     */
    readonly replace: (
      designSystem: DesignSystem,
      document: string,
      label: string
    ) => Effect.Effect<void, EditFailure>;
    /**
     * Validates and saves; `document` replaces `DESIGN.md` when given, at the root. Its mirrored
     * token groups are the design system's, filled in whatever it says; `findings` are what the
     * format's linter says and what was put back. A linter error refuses the whole write.
     */
    readonly write: (
      designSystem: unknown,
      document?: string
    ) => Effect.Effect<
      {
        readonly designSystem: DesignSystem;
        readonly findings: readonly DesignFinding[];
      },
      EditFailure
    >;
  }
>()("ultrapaint/server/DesignSystemService") {
  static readonly layer = Layer.effect(
    DesignSystemService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const styleSystem = yield* ProjectStyleSystem;
      const catalogue = yield* CatalogueService;
      const events = yield* EventBus;
      const storage = yield* Storage;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const linter = yield* DesignMdLint;
      const systemFile = path.join(paths.designsDir, DESIGN_SYSTEM_FILE);
      const documentFile = path.join(paths.root, DESIGN_MD_FILE);
      const legacyCandidate = path.join(paths.designsDir, DESIGN_NOTES_FILE);
      // A designs directory at the root of the repository has one DESIGN.md, not two.
      const legacyFile =
        legacyCandidate === documentFile ? null : legacyCandidate;
      const documentRel = paths.relative(documentFile);
      const tokenWrites = yield* Semaphore.make(1);
      const mirrorWrites = yield* Semaphore.make(1);

      const readOptional = (file: string) =>
        Effect.orElseSucceed(
          Effect.map(fs.readFileString(file), (text): string | null => text),
          () => null
        );

      /**
       * The tokens the code declares, by name, with the stylesheets they were read from and what
       * could not be read: kept until a stylesheet they come from changes.
       */
      const codeCache = makeStampedCache(
        fs,
        Effect.try(() => {
          const source = styleSystem.readTokens({
            anchorDir: paths.anchorDir,
            root: paths.root,
            settings: paths.settings,
          });
          return {
            files: source.files.map((file) => path.resolve(paths.root, file)),
            value: {
              byName: new Map<string, SourceToken>(
                source.tokens.map((t) => [t.name, t])
              ),
              files: source.files,
              notes: source.notes,
            },
          };
        })
      );
      const codeRead = codeCache.get.pipe(
        // A stylesheet that cannot be read leaves the file's own values in force.
        Effect.orElseSucceed(() => ({
          byName: new Map<string, SourceToken>(),
          files: [] as readonly string[],
          notes: [] as readonly string[],
        }))
      );
      const codeTokensByName = Effect.map(codeRead, (read) => read.byName);

      /**
       * The code's value where the design system has none: a file written before ADR 0028 left
       * out the values of the tokens the code declared, and an agent may leave one out of a write.
       */
      const fillFromCode = (
        ds: DesignSystem,
        code: ReadonlyMap<string, SourceToken>
      ): DesignSystem => {
        const merged = mapTokens(ds, (t) => {
          const found = code.get(t.name);
          if (t.value !== "" || !found) {
            return t;
          }
          return {
            ...t,
            value: found.value,
            ...(found.values && !t.values && { values: found.values }),
          };
        });
        const base = code.get("spacing")?.value;
        return merged.spacing.base === "" && base !== undefined
          ? { ...merged, spacing: { ...merged.spacing, base } }
          : merged;
      };

      /** A design system's JSON with a value left out given as empty, for `fillFromCode`. */
      const withEmptyValues = (json: unknown) =>
        mapTokenRecords(json, (t) => ("value" in t ? t : { ...t, value: "" }));

      /**
       * What the design system and the code agree on (ADR 0028): the last agreement, with every
       * value they now share taken as agreed, and what neither has any more dropped.
       */
      const settle = (
        ds: DesignSystem,
        code: ReadonlyMap<string, SourceToken>
      ): DocumentBaseline => {
        const ours = valuesByKey(designTokensOf(ds));
        const theirs = valuesByKey([...code.values()]);
        const agreed: Record<string, string> = {};
        for (const [key, value] of Object.entries(ds.codeSync?.agreed ?? {})) {
          if (key in ours || key in theirs) {
            agreed[key] = value;
          }
        }
        for (const [key, value] of Object.entries(ours)) {
          const other = theirs[key];
          if (other !== undefined && sameValue(value, other)) {
            agreed[key] = other;
          }
        }
        return {
          agreed: Object.fromEntries(
            Object.entries(agreed).sort(([a], [b]) => a.localeCompare(b))
          ),
          at: ds.codeSync?.at ?? 0,
          ...(ds.codeSync?.matches && { matches: ds.codeSync.matches }),
        };
      };

      /** The design tokens file beside the design system, absolute and repository-relative. */
      const tokensAbs = path.join(paths.designsDir, DESIGN_TOKENS_FILE);
      const tokensRel = paths.relative(tokensAbs);

      /**
       * What `design.tokens.json` is written as for a design system, and what the two agree on
       * then (ADR 0028): the values the file reads back as, the baseline kept as it was while they
       * do not move. The file is left as it is while it holds values of its own that the design
       * system has not taken — another tool changed it since the editor last wrote it — so they
       * wait in Sync instead of being written over; `force`, once Sync has taken them, writes it.
       */
      const tokensFileFor = Effect.fnUntraced(function* (
        ds: DesignSystem,
        force: boolean
      ) {
        const text = serialiseDesignTokens(ds);
        const ours = readDesignTokens(text);
        const values = "problem" in ours ? {} : valuesByKey(ours.tokens);
        const onDisk = (yield* get).designSystem;
        const previous = ds.designTokens ?? onDisk?.designTokens;
        const baseline: DocumentBaseline =
          previous && sameValues(previous.agreed, values)
            ? previous
            : {
                agreed: sortedValues(values),
                at: yield* Clock.currentTimeMillis,
              };
        if (force) {
          return { baseline, text };
        }
        const current = yield* readOptional(tokensAbs);
        if (current === null || current === text) {
          return { baseline, text };
        }
        // Without a baseline yet, what the editor would have written last stands for it.
        const agreed =
          previous?.agreed ??
          (onDisk ? valuesByKey(designTokensOf(onDisk)) : null);
        const theirs = readDesignTokens(current);
        const held =
          "problem" in theirs ||
          (agreed !== null && !sameValues(valuesByKey(theirs.tokens), agreed));
        return held ? { baseline: previous, text: null } : { baseline, text };
      });

      /**
       * What `design-system.json` and `design.tokens.json` say for a design system: the tokens
       * file null while it holds another tool's changes, which wait for Sync.
       */
      const filesFor = Effect.fnUntraced(function* (
        ds: DesignSystem,
        force = false
      ) {
        const tokens = yield* tokensFileFor(ds, force);
        return {
          system: serialise(
            tokens.baseline ? { ...ds, designTokens: tokens.baseline } : ds
          ),
          tokens: tokens.text,
        };
      });

      /** Writes what `filesFor` says, the tokens file only when it is to be written. */
      const writeFiles = Effect.fnUntraced(function* (
        tx: EditTransaction,
        ds: DesignSystem,
        force = false
      ) {
        const files = yield* filesFor(ds, force);
        yield* tx.write(paths.relative(systemFile), files.system);
        if (files.tokens !== null) {
          yield* tx.write(tokensRel, files.tokens);
        }
      });

      /** Where a baseline waits for a design system to be written: the state, per repository. */
      const pendingFile = Effect.map(storage.stateDir, (state) =>
        path.join(
          state,
          "design-system-sync",
          hashContent(paths.root),
          "baseline.json"
        )
      );

      /** The baseline waiting in the state directory, if one is. */
      const pending = Effect.gen(function* () {
        const text = yield* fs.readFileString(yield* pendingFile);
        return yield* decodeBaseline(text);
      }).pipe(
        Effect.map((found): SyncBaseline | null => found),
        // None waiting, or one written by a version that no longer reads it.
        Effect.orElseSucceed(() => null)
      );

      /** The root's DESIGN.md, or the designs directory's while the root has none. */
      const documentFound = (
        rootDocument: string | null,
        legacyDocument: string | null
      ) => {
        if (rootDocument !== null) {
          return { legacy: false, path: documentRel, text: rootDocument };
        }
        if (legacyDocument === null || legacyFile === null) {
          return null;
        }
        return {
          legacy: true,
          path: paths.relative(legacyFile),
          text: legacyDocument,
        };
      };

      /** The files as they read, the design system decoded: kept until one of them changes. */
      const filesCache = makeStampedCache(
        fs,
        Effect.gen(function* () {
          const [text, rootDocument, legacyDocument] = yield* Effect.all([
            readOptional(systemFile),
            readOptional(documentFile),
            legacyFile === null
              ? Effect.succeed(null)
              : readOptional(legacyFile),
          ]);
          const decoded =
            text === null
              ? null
              : yield* Effect.result(
                  Effect.flatMap(
                    Effect.try({
                      catch: (error) =>
                        new BadRequest({
                          message: `not JSON: ${String(error)}`,
                        }),
                      // A value the file leaves out is the code's, filled in below.
                      try: () => withEmptyValues(JSON.parse(text) as unknown),
                    }),
                    decodeDesignSystem
                  )
                );
          const document = documentFound(rootDocument, legacyDocument);
          return {
            files: [
              systemFile,
              documentFile,
              ...(legacyFile ? [legacyFile] : []),
            ],
            value: { decoded, document },
          };
        })
      );

      /** The linter's findings for the last text it read: a get reads the same file again. */
      let linted: {
        readonly findings: readonly DesignFinding[];
        readonly text: string;
      } | null = null;
      const lintOf = Effect.fnUntraced(function* (text: string) {
        if (linted?.text === text) {
          return linted.findings;
        }
        const findings = yield* linter.lint(text);
        linted = { findings, text };
        return findings;
      });

      /**
       * What DESIGN.md and the design system agreed on, or null before anything was: matches
       * saved before a document's tokens are taken leave `at` at 0 (ADR 0027).
       */
      const agreedOf = (ds: DesignSystem) =>
        ds.designMd && ds.designMd.at > 0 ? ds.designMd.agreed : null;

      /**
       * The catalogue's components, once it has been read: their classes are what DESIGN.md's
       * component tokens come from. Read in the background, and again on a refresh; until then
       * the document's own component tokens stand.
       */
      let catalogued: readonly ComponentClasses[] | null = null;
      const loadComponents = Effect.map(
        Effect.option(catalogue.get(false)),
        (found) => {
          if (found._tag === "Some") {
            catalogued = found.value.components;
          }
        }
      );

      /** The front matter a design system comes to, its values and its components' tokens. */
      const mirrorFor = Effect.fnUntraced(function* (
        ds: DesignSystem,
        document: string | null
      ) {
        const known = catalogued;
        if (known === null) {
          const own = document
            ? groupsOf(parse(document)).groups.components
            : {};
          return mirrorOf(ds, own);
        }
        const tokens = [...(yield* codeTokensByName).values()];
        return mirrorOf(
          ds,
          componentEntries(
            known,
            new Set(Object.keys(ds.components ?? {})),
            (classes) =>
              Object.fromEntries(
                Object.entries(
                  styleSystem.componentStyle(classes, tokens)
                ).filter(
                  (entry): entry is [string, string] => entry[1] !== undefined
                )
              )
          )
        );
      });

      /** `DESIGN.md` as the editor shows it, with what Sync has to settle when it mirrors. */
      const documentOf = Effect.fnUntraced(function* (
        found: {
          readonly legacy: boolean;
          readonly path: string;
          readonly text: string;
        },
        ds: DesignSystem | null
      ) {
        const doc = parse(found.text);
        const held =
          ds && !found.legacy
            ? mergeMirror(
                doc,
                (yield* mirrorFor(ds, found.text)).groups,
                agreedOf(ds)
              ).held
            : [];
        return {
          body: found.text.slice(doc.body),
          findings: yield* lintOf(found.text),
          held,
          legacy: found.legacy,
          path: found.path,
          sections: doc.sections.map((section) => ({
            heading: section.heading,
            section: section.section,
            text: section.text,
          })),
          text: found.text,
        } satisfies DesignDocument;
      });

      /**
       * The stylesheet that gives the code's variables the design's values in the preview, for
       * the tokens where they differ (ADR 0028); kept until what it is made from changes.
       */
      let previewMemo: { readonly key: string; readonly css: string } | null =
        null;
      const previewCssOf = (
        ds: DesignSystem,
        code: ReadonlyMap<string, SourceToken>
      ) => {
        const declared = valuesByKey([...code.values()]);
        const differing: DesignTokenValue[] = [];
        for (const t of designTokensOf(ds)) {
          const themes: [string, string][] = [
            ["", t.value],
            ...Object.entries(t.values ?? {}),
          ];
          for (const [theme, value] of themes) {
            const theirs = declared[baselineKey(t.name, theme || undefined)];
            if (theirs === undefined || !sameValue(value, theirs)) {
              differing.push({
                name: t.name,
                ...(theme && { theme }),
                value,
              });
            }
          }
        }
        const key = JSON.stringify(differing);
        if (previewMemo?.key === key) {
          return Effect.succeed(previewMemo.css);
        }
        return Effect.try(() =>
          differing.length === 0
            ? ""
            : styleSystem.previewTokenCss(
                {
                  anchorDir: paths.anchorDir,
                  root: paths.root,
                  settings: paths.settings,
                },
                differing
              )
        ).pipe(
          Effect.tap((css) =>
            Effect.sync(() => {
              previewMemo = { css, key };
            })
          ),
          // Stylesheets that cannot be read draw the code's values, which is what they say.
          Effect.orElseSucceed(() => "")
        );
      };

      const get: Effect.Effect<DesignSystemState> = Effect.gen(function* () {
        const { decoded, document: found } = yield* filesCache.get;
        const code = yield* codeTokensByName;
        const designSystem =
          decoded?._tag === "Success"
            ? fillFromCode(decoded.success, code)
            : null;
        const document = found ? yield* documentOf(found, designSystem) : null;
        if (decoded?._tag === "Failure") {
          return {
            designSystem: null,
            document,
            problem: `${DESIGN_SYSTEM_FILE} is not valid: ${decoded.failure.message}`,
          };
        }
        const previewCss = designSystem
          ? yield* previewCssOf(designSystem, code)
          : "";
        return {
          designSystem,
          document,
          ...(previewCss && { previewCss }),
        };
      }).pipe(Effect.withSpan("DesignSystemService.get"));

      const baseline = Effect.gen(function* () {
        const { designSystem } = yield* get;
        return designSystem?.sync ?? (yield* pending);
      });

      const designTokensComparison = Effect.gen(function* () {
        const { designSystem: ds } = yield* get;
        const text = ds ? yield* readOptional(tokensAbs) : null;
        if (!(ds && text !== null)) {
          return null;
        }
        const read = readDesignTokens(text);
        const design = designTokensOf(ds);
        return {
          baseline: ds.designTokens !== undefined,
          diffs: compareCode(
            "problem" in read ? [] : read.tokens,
            design,
            ds.designTokens ?? null,
            new Set(ds.omitted ?? [])
          ),
          file: tokensRel,
          notes: "problem" in read ? [read.problem] : [...read.notes],
          source: "dtcg",
          targets: design.map((t) => ({ kind: t.kind, name: t.name })),
        } satisfies TokenComparison;
      }).pipe(Effect.withSpan("DesignSystemService.designTokensComparison"));

      const codeComparison = Effect.gen(function* () {
        const { designSystem: ds } = yield* get;
        if (!ds) {
          return null;
        }
        const read = yield* codeRead;
        const design = designTokensOf(ds);
        const [only] = read.files;
        return {
          baseline: ds.codeSync !== undefined,
          diffs: compareCode(
            [...read.byName.values()],
            design,
            ds.codeSync ?? null,
            new Set(ds.omitted ?? [])
          ),
          file: read.files.length === 1 && only ? only : "the code",
          notes: [...read.notes],
          read: read.files.length > 0,
          source: "code",
          targets: design.map((t) => ({ kind: t.kind, name: t.name })),
        } satisfies TokenComparison & { readonly read: boolean };
      }).pipe(Effect.withSpan("DesignSystemService.codeComparison"));

      const scan = Effect.gen(function* () {
        const found = yield* Effect.sync(() =>
          styleSystem.scan({
            anchorDir: paths.anchorDir,
            root: paths.root,
            settings: paths.settings,
          })
        );
        // Categories are what the catalogue already knows; a catalogue not built yet only
        // leaves them to the agent.
        const components = yield* Effect.orElseSucceed(
          Effect.map(catalogue.get(false), (c) => c.components),
          () => []
        );
        if (components.length === 0) {
          return found;
        }
        return {
          ...found,
          designSystem: {
            ...found.designSystem,
            components: Object.fromEntries(
              components.map((c) => [
                c.name,
                {
                  category: c.category,
                  ...(c.description !== undefined && {
                    description: c.description,
                  }),
                },
              ])
            ),
          },
        } satisfies DesignSystemScan;
      }).pipe(Effect.withSpan("DesignSystemService.scan"));

      /** The document's mirrored values the writer gave that the design system has otherwise. */
      const putBack = (text: string, mirror: ReturnType<typeof mirrorOf>) => {
        const given = resolvedValues(parse(text));
        const ours = valuesOf(mirror.groups);
        return Object.entries(given)
          .filter(([key, value]) => !sameValue(value, ours[key]))
          .map(
            ([key, value]): DesignFinding => ({
              message:
                ours[key] === undefined
                  ? `${key} (${String(value)}) is not a token of the design system, and was left out: the token groups are filled in from the design system.`
                  : `${key} was given as ${String(value)}; the design system's ${String(ours[key])} is kept. Change values in the design system (write_design_system), not in DESIGN.md's front matter.`,
              path: key,
              severity: "warning",
            })
          );
      };

      /** What `write` saves of the document, and what it says about it. */
      const documentToWrite = Effect.fnUntraced(function* (
        text: string,
        merged: DesignSystem
      ) {
        const mirror = yield* mirrorFor(merged, text);
        const written = withMirror(text, mirror.groups);
        if ("problem" in written) {
          return yield* new BadRequest({
            message: `DESIGN.md: ${written.problem}`,
          });
        }
        const findings = yield* lintOf(written.text);
        const errors = findings.filter((f) => f.severity === "error");
        if (errors.length > 0) {
          return yield* new BadRequest({
            message: `DESIGN.md does not follow the format: ${errors
              .map((f) => (f.path ? `${f.path}: ${f.message}` : f.message))
              .join(" ")}`,
          });
        }
        return {
          agreed: valuesOf(mirror.groups),
          findings: [
            ...putBack(text, mirror),
            ...findings.filter((f) => f.severity === "warning"),
          ],
          text: written.text,
        };
      });

      /**
       * A design system the tool changed itself (a token, a sync) saved as it is, in one undo
       * step, with what it and the code agree on worked out again.
       */
      const save = Effect.fn("DesignSystemService.save")(function* (
        designSystem: DesignSystem,
        label: string,
        /** Write `design.tokens.json` even while it holds changes of its own: Sync took them. */
        force = false
      ) {
        const code = yield* codeTokensByName;
        const saved = { ...designSystem, codeSync: settle(designSystem, code) };
        yield* edit.transaction(label, (tx) => writeFiles(tx, saved, force));
        yield* Effect.ignore(mirrorDocument);
        yield* Effect.flatMap(get, (state) =>
          events.publish("designSystem", state)
        );
      });

      const write = Effect.fn("DesignSystemService.write")(function* (
        input: unknown,
        document?: string
      ) {
        const code = yield* codeTokensByName;
        const decoded = yield* decodeDesignSystem(withEmptyValues(input)).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the design system is not valid: ${error.message}`,
              })
          )
        );
        const before = yield* get;
        // A sync's baselines are the tool's, not the writer's: an agent rewriting the design
        // system without them keeps the ones there are, or the one waiting for a design system.
        const kept = decoded.sync ?? (yield* baseline) ?? undefined;
        const keptDocument = decoded.designMd ?? before.designSystem?.designMd;
        const keptCode = decoded.codeSync ?? before.designSystem?.codeSync;
        const filled = fillFromCode(decoded, code);
        const designSystem: DesignSystem = {
          ...filled,
          codeSync: settle(
            { ...filled, ...(keptCode && { codeSync: keptCode }) },
            code
          ),
        };
        const merged = designSystem;
        const written =
          document === undefined
            ? null
            : yield* documentToWrite(document, merged);
        const saved: DesignSystem = {
          ...designSystem,
          ...(kept && { sync: kept }),
          ...(written
            ? {
                designMd: {
                  agreed: written.agreed,
                  at: yield* Clock.currentTimeMillis,
                  ...(keptDocument?.matches && {
                    matches: keptDocument.matches,
                  }),
                },
              }
            : keptDocument && { designMd: keptDocument }),
        };
        yield* edit.transaction("Update the design system", (tx) =>
          Effect.gen(function* () {
            yield* writeFiles(tx, saved);
            if (written) {
              yield* tx.write(documentRel, written.text);
              // The designs directory's DESIGN.md is replaced by the root's.
              if (before.document?.legacy) {
                yield* tx.remove(before.document.path);
              }
            }
          })
        );
        yield* Effect.ignore(mirrorDocument);
        yield* Effect.flatMap(get, (state) =>
          events.publish("designSystem", state)
        );
        return { designSystem, findings: written?.findings ?? [] };
      });

      /**
       * `DESIGN.md`'s front matter brought up to the design system: the values the design system
       * changed alone written in, the agreement moved with them, both outside the undo history
       * (ADR 0027, 0028). A document in the designs directory waits for Sync to move it; one with
       * values of its own keeps them for Sync to offer.
       */
      const mirrorDocument = Effect.gen(function* () {
        const { decoded, document: found } = yield* filesCache.get;
        if (!(decoded?._tag === "Success" && found && !found.legacy)) {
          return;
        }
        const merged = fillFromCode(decoded.success, yield* codeTokensByName);
        const mirror = (yield* mirrorFor(merged, found.text)).groups;
        const agreed = agreedOf(decoded.success);
        const rewrite = (content: string) => {
          const next = withMirror(
            content,
            mergeMirror(parse(content), mirror, agreed).groups
          );
          return "problem" in next ? content : next.text;
        };
        const result = mergeMirror(parse(found.text), mirror, agreed);
        // A document taken away meanwhile stays away.
        yield* edit.amend(documentRel, (content) =>
          content === null
            ? Effect.fail("gone" as const)
            : Effect.succeed([rewrite(content), null] as const)
        );
        const same =
          agreed !== null &&
          Object.keys(agreed).length === Object.keys(result.agreed).length &&
          Object.entries(result.agreed).every(([k, v]) => agreed[k] === v);
        if (
          same ||
          (agreed === null && Object.keys(result.agreed).length === 0)
        ) {
          return;
        }
        const at = yield* Clock.currentTimeMillis;
        yield* edit.amend(paths.relative(systemFile), (content) =>
          Effect.try({
            catch: () => null,
            try: () => {
              if (content === null) {
                throw new Error("gone");
              }
              const json = JSON.parse(content) as Record<string, unknown>;
              const previous = json.designMd as
                | { readonly matches?: unknown }
                | undefined;
              return serialise({
                ...json,
                designMd: {
                  agreed: result.agreed,
                  at,
                  ...(previous?.matches !== undefined && {
                    matches: previous.matches,
                  }),
                },
              });
            },
          }).pipe(
            // A file that does not read is left alone: get says why.
            Effect.orElseSucceed(() => content),
            Effect.map((next) => [next ?? "", null] as const)
          )
        );
      }).pipe(
        mirrorWrites.withPermits(1),
        Effect.withSpan("DesignSystemService.mirrorDocument")
      );

      const setSection = Effect.fn("DesignSystemService.setSection")(function* (
        name: string,
        text: string
      ) {
        const { document } = yield* get;
        if (!document) {
          return yield* new BadRequest({
            message: "There is no DESIGN.md to write in yet: Sync writes one.",
          });
        }
        yield* edit.transaction(`Edit DESIGN.md's ${name}`, (tx) =>
          tx.write(document.path, withSection(document.text, name, text))
        );
        yield* Effect.flatMap(get, (state) =>
          events.publish("designSystem", state)
        );
      });

      const replace = Effect.fn("DesignSystemService.replace")(function* (
        designSystem: DesignSystem,
        document: string,
        label: string
      ) {
        const code = yield* codeTokensByName;
        const saved = {
          ...designSystem,
          codeSync: settle(designSystem, code),
        };
        yield* edit.transaction(label, (tx) =>
          Effect.gen(function* () {
            yield* writeFiles(tx, saved);
            yield* tx.write(documentRel, document);
          })
        );
        yield* Effect.ignore(mirrorDocument);
        yield* Effect.flatMap(get, (state) =>
          events.publish("designSystem", state)
        );
      });

      /**
       * The document placed at the root: the designs directory's with the design system's
       * tokens in its front matter, or a first one; null with neither to write it from.
       */
      const placedText = (
        legacy: string | null,
        mirror: ReturnType<typeof mirrorOf>["groups"] | null
      ): string | null => {
        if (mirror === null) {
          return legacy;
        }
        if (legacy === null) {
          return create(mirror, { name: path.basename(paths.root) });
        }
        const next = withMirror(
          legacy,
          mergeMirror(parse(legacy), mirror, null).groups
        );
        return "problem" in next ? legacy : next.text;
      };

      const placeDocument = Effect.gen(function* () {
        const state = yield* get;
        if (state.document && !state.document.legacy) {
          return { path: state.document.path };
        }
        const ds = state.designSystem;
        const legacy = state.document;
        const mirror = ds
          ? (yield* mirrorFor(ds, legacy?.text ?? null)).groups
          : null;
        const text = placedText(legacy?.text ?? null, mirror);
        if (text === null) {
          return yield* new BadRequest({
            message:
              "There is no design system to write DESIGN.md from yet: define it first.",
          });
        }
        // What the document and the design system agree on from now: every value they share.
        const designMd = ds &&
          mirror && {
            agreed: mergeMirror(parse(text), mirror, {}).agreed,
            at: yield* Clock.currentTimeMillis,
            ...(ds.designMd?.matches && { matches: ds.designMd.matches }),
          };
        yield* edit.transaction(
          legacy ? "Move DESIGN.md to the repository root" : "Write DESIGN.md",
          (tx) =>
            Effect.gen(function* () {
              if (legacy) {
                yield* tx.move(legacy.path, documentRel);
              }
              yield* tx.write(documentRel, text);
              if (ds && designMd) {
                yield* writeFiles(tx, { ...ds, designMd });
              }
            })
        );
        yield* Effect.ignore(mirrorDocument);
        yield* Effect.flatMap(get, (next) =>
          events.publish("designSystem", next)
        );
        return { path: documentRel };
      }).pipe(Effect.withSpan("DesignSystemService.placeDocument"));

      const detect = Effect.flatMap(scan, (found) =>
        Effect.map(write(found.designSystem), (w) => w.designSystem)
      );

      /**
       * Writes the files a list of token changes comes to, all inside the repository: all of
       * them or, when one cannot be written, none. The stylesheets are the code's, outside the
       * designs directory and its undo journal; a token change is taken back by setting the
       * value it replaced. Changes run one at a time, each reading the stylesheets the one
       * before it wrote.
       */
      const writeCodeFiles = Effect.fnUntraced(function* (
        changes: readonly TokenChange[]
      ) {
        const edits = yield* Effect.try({
          catch: (error) =>
            new BadRequest({
              message: `the stylesheets could not be written: ${String(error)}`,
            }),
          try: () =>
            styleSystem.writeTokens(
              {
                anchorDir: paths.anchorDir,
                root: paths.root,
                settings: paths.settings,
              },
              changes
            ),
        });
        const root = path.resolve(paths.root);
        const files: { readonly abs: string; readonly text: string }[] = [];
        for (const written of edits) {
          const abs = path.resolve(root, written.file);
          if (!abs.startsWith(root + path.sep)) {
            return yield* new BadRequest({
              message: `${written.file} is outside the repository`,
            });
          }
          files.push({ abs, text: written.text });
        }
        const before = yield* Effect.forEach(files, ({ abs }) =>
          readOptional(abs)
        );
        const done: number[] = [];
        yield* Effect.forEach(files, ({ abs, text }, i) =>
          writeAtomic(abs, text).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                done.push(i);
              })
            )
          )
        ).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the stylesheets could not be written: ${error.message}`,
              })
          ),
          // What was written already goes back, file by file, as far as it can.
          Effect.onError(() =>
            Effect.forEach(done.toReversed(), (i) => {
              const file = files[i];
              const content = before[i];
              if (file === undefined || content === undefined) {
                return Effect.void;
              }
              return (
                content === null
                  ? fs.remove(file.abs, { force: true })
                  : writeAtomic(file.abs, content)
              ).pipe(Effect.ignore({ log: true }));
            })
          )
        );
        if (edits.length > 0) {
          yield* codeCache.clear;
          yield* Effect.ignore(settleWithCode);
          yield* Effect.flatMap(get, (state) =>
            events.publish("designSystem", state)
          );
        }
        return { files: edits.map((e) => e.file) };
      });

      /**
       * What the design system and the code agree on, moved after the code was written: outside
       * the undo history, as the stylesheets are (ADR 0028).
       */
      const settleWithCode = Effect.gen(function* () {
        const { decoded } = yield* filesCache.get;
        if (decoded?._tag !== "Success") {
          return;
        }
        const code = yield* codeTokensByName;
        const ds = fillFromCode(decoded.success, code);
        const next = settle(ds, code);
        const before = ds.codeSync?.agreed ?? {};
        const same =
          Object.keys(before).length === Object.keys(next.agreed).length &&
          Object.entries(next.agreed).every(([k, v]) => before[k] === v);
        if (same) {
          return;
        }
        const at = yield* Clock.currentTimeMillis;
        yield* edit.amend(paths.relative(systemFile), (content) =>
          Effect.try({
            catch: () => null,
            try: () => {
              if (content === null) {
                throw new Error("gone");
              }
              const json = JSON.parse(content) as Record<string, unknown>;
              return serialise({ ...json, codeSync: { ...next, at } });
            },
          }).pipe(
            // A file that does not read is left alone: get says why.
            Effect.orElseSucceed(() => content),
            Effect.map((text) => [text ?? "", null] as const)
          )
        );
      }).pipe(Effect.withSpan("DesignSystemService.settleWithCode"));

      const writeCode = Effect.fn("DesignSystemService.writeCode")(
        (changes: readonly TokenChange[]) =>
          tokenWrites.withPermits(1)(writeCodeFiles(changes))
      );

      const noDesignSystem = new BadRequest({
        message:
          "There is no design system yet to change a token in: Sync makes one.",
      });

      const setTokens = Effect.fn("DesignSystemService.setTokens")(function* (
        changes: readonly TokenChange[],
        label = "Change tokens"
      ) {
        const { designSystem: ds } = yield* get;
        if (!ds) {
          return yield* noDesignSystem;
        }
        yield* save(withTokenChanges(ds, changes), label).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the design system could not be written: ${error.message}`,
              })
          )
        );
        const written = [paths.relative(systemFile), tokensRel];
        if (paths.settings.codeTokens !== "auto") {
          return { files: written };
        }
        const code = yield* writeCode(changes);
        return { files: [...written, ...code.files] };
      });

      const takeDesignTokens = Effect.fn(
        "DesignSystemService.takeDesignTokens"
      )(function* (changes: readonly TokenChange[]) {
        const { designSystem: ds } = yield* get;
        if (!ds) {
          return yield* noDesignSystem;
        }
        yield* save(
          withTokenChanges(ds, changes),
          `Take ${DESIGN_TOKENS_FILE}'s tokens`,
          true
        ).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the design system could not be written: ${error.message}`,
              })
          )
        );
        const written = [paths.relative(systemFile), tokensRel];
        if (changes.length === 0 || paths.settings.codeTokens !== "auto") {
          return { files: written };
        }
        const code = yield* writeCode(changes);
        return { files: [...written, ...code.files] };
      });

      const setToken = Effect.fn("DesignSystemService.setToken")(function* (
        change: TokenChange
      ) {
        const { designSystem: ds } = yield* get;
        if (!ds) {
          return yield* noDesignSystem;
        }
        const before = designTokensOf(ds).find((t) => t.name === change.name);
        const { files } = yield* setTokens(
          [change],
          `Change ${change.name}${change.theme ? ` in ${change.theme}` : ""}`
        );
        return {
          files,
          previous:
            (change.theme ? before?.values?.[change.theme] : before?.value) ??
            null,
        };
      });

      const saveBaseline = Effect.fn("DesignSystemService.saveBaseline")(
        function* (next: SyncBaseline) {
          const { designSystem } = yield* get;
          if (designSystem) {
            yield* write({ ...designSystem, sync: next });
            yield* Effect.ignore(fs.remove(yield* pendingFile));
            return;
          }
          const file = yield* pendingFile;
          yield* Effect.orDie(
            Effect.flatMap(encodeBaseline(next), (text) =>
              writeAtomic(file, text)
            )
          );
        }
      );

      // Whoever changes the files — an undo, an agent writing them by hand, a checkout.
      const names = new Set([
        paths.relative(systemFile),
        // Another tool writing the design tokens file: Sync offers what it changed.
        tokensRel,
        documentRel,
        ...(legacyFile ? [paths.relative(legacyFile)] : []),
      ]);
      // The root's DESIGN.md is outside the designs directory the pages watcher watches.
      const rootChanges = fs.watch(paths.root).pipe(
        Stream.filter((event) => path.basename(event.path) === DESIGN_MD_FILE),
        Stream.map(() => undefined),
        // A root that cannot be watched only means its changes are seen later.
        Stream.catch(() => Stream.empty)
      );
      yield* Stream.merge(
        events.subscribe("file.changed").pipe(
          Stream.filter(({ file }) => names.has(file)),
          Stream.map(() => undefined)
        ),
        rootChanges
      ).pipe(
        Stream.debounce("50 millis"),
        Stream.runForEach(() =>
          Effect.gen(function* () {
            yield* Effect.ignore(mirrorDocument, { log: true });
            yield* events.publish("designSystem", yield* get);
          })
        ),
        Effect.forkScoped
      );

      // The components' classes, as soon as the catalogue is read: DESIGN.md gets their tokens,
      // and the editor hears of it when the document is written.
      yield* loadComponents.pipe(
        Effect.andThen(Effect.ignore(mirrorDocument, { log: true })),
        Effect.forkScoped
      );

      return DesignSystemService.of({
        baseline,
        codeComparison,
        codeTokens: Effect.map(codeTokensByName, (code) => [...code.values()]),
        designTokensComparison,
        detect,
        get,
        mirror: (ds, document) =>
          Effect.map(mirrorFor(ds, document), (m) => m.groups),
        placeDocument,
        refresh: codeCache.clear.pipe(
          Effect.andThen(loadComponents),
          Effect.andThen(Effect.ignore(mirrorDocument, { log: true })),
          Effect.andThen(get)
        ),
        replace,
        saveBaseline,
        scan,
        setSection,
        setToken,
        setTokens,
        takeDesignTokens,
        write,
        writeCode,
      });
    })
  ).pipe(Layer.provide(DesignMdLint.layer));
}
