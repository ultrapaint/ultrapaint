/**
 * DESIGN.md (ADR 0027): the design system in the open format, at the root of the repository, or
 * in the designs directory where it was before, until Sync moves it. Its front matter mirrors
 * the design system's tokens: when they change, the values the design system changed alone are
 * written into the document, outside the undo history, and what the document changed is held
 * for Sync (`@ultrapaint/design-md/merge`). What the two agree on is its baseline (`designMd` in
 * `design-system.json`), moved here; the format's linter says what the document gets wrong.
 *
 * The design system service reads and writes the document through this one; Sync's adapter for
 * DESIGN.md is in `sync-sides.ts`.
 */

import { lint } from "@google/design.md/linter";
import { COMPONENTS_DIR } from "@ultrapaint/contracts/component-names";
import {
  componentsIn,
  systemComponentsIn,
} from "@ultrapaint/contracts/components";
import {
  DESIGN_MD_FILE,
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
  type DesignDocument,
  type DesignFinding,
  type DesignSystem,
  type DocumentBaseline,
  type DocumentMatch,
} from "@ultrapaint/contracts/design-system";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { sameValue } from "@ultrapaint/contracts/token-value";
import type { TokenGroups } from "@ultrapaint/design-md/format";
import {
  mergeMirror,
  resolvedValues,
  valuesOf,
} from "@ultrapaint/design-md/merge";
import { componentEntries, mirrorOf } from "@ultrapaint/design-md/mirror";
import { parse } from "@ultrapaint/design-md/parse";
import { create, withMirror, withSection } from "@ultrapaint/design-md/write";
import { looksOf } from "@ultrapaint/system-components/defaults";
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
import { makeStampedCache } from "../file-stamp.ts";
import { readComponents } from "./components.ts";
import { DesignFiles } from "./design-files.ts";
import { agreeOn, baselineMover } from "./design-system-files.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";
import { TOOLS } from "./threads/agent-ways.ts";

/** The document taken away between its reading and its rewriting: nothing follows into it. */
class DocumentGone extends Schema.TaggedError<DocumentGone>()("DocumentGone", {
  message: Schema.String,
}) {}

/**
 * What the format's own linter (`@google/design.md`, ADR 0027) says about a DESIGN.md: broken
 * references, contrast of component pairs, section order, tokens it cannot type. What the
 * file's reading finds (a section twice, YAML that does not read) comes first, as errors: the
 * linter does not report a section given twice, which the format calls an error.
 */
const lintDocument = (text: string): readonly DesignFinding[] => {
  const read: DesignFinding[] = parse(text).problems.map((message) => ({
    message,
    severity: "error",
  }));
  let found: DesignFinding[] = [];
  try {
    found = lint(text).findings.map(
      (f): DesignFinding => ({
        message: f.message,
        ...(f.path !== undefined && { path: f.path }),
        severity: f.severity,
      })
    );
  } catch {
    // The linter gives up on a file it cannot read at all; the reading says why.
  }
  return [...read, ...found];
};

/** DESIGN.md as it was found: at the root, or in the designs directory (`legacy`). */
interface Found {
  readonly legacy: boolean;
  /** Repository-relative. */
  readonly path: string;
  readonly text: string;
}

/**
 * DESIGN.md's baseline moved (ADR 0027): what it and the design system agree on from `at`, and
 * the matches it keeps, the previous ones unless others are given; `matches: null` forgets
 * them, once the document is written in the design system's names. Matches saved before a
 * document's tokens are taken are no agreement yet: `at` stays 0.
 */
export const documentBaseline = (
  previous: DocumentBaseline | null | undefined,
  change: {
    readonly agreed?: Readonly<Record<string, string>>;
    readonly at?: number;
    readonly matches?: Readonly<Record<string, DocumentMatch>> | null;
  }
): DocumentBaseline => {
  const matches =
    change.matches === undefined ? previous?.matches : change.matches;
  return {
    agreed: change.agreed ?? previous?.agreed ?? {},
    at: change.at ?? previous?.at ?? 0,
    ...(matches && { matches }),
  };
};

/**
 * What DESIGN.md and the design system agreed on, or null before anything was: matches saved
 * before a document's tokens are taken leave `at` at 0.
 */
const agreedOf = (ds: DesignSystem) =>
  ds.designMd && ds.designMd.at > 0 ? ds.designMd.agreed : null;

/** The document's mirrored values the writer gave that the design system has otherwise. */
const putBack = (text: string, mirror: TokenGroups) => {
  const given = resolvedValues(parse(text));
  const ours = valuesOf(mirror);
  return Object.entries(given)
    .filter(([key, value]) => !sameValue(String(value), ours[key]))
    .map(
      ([key, value]): DesignFinding => ({
        message:
          ours[key] === undefined
            ? `${key} (${String(value)}) is not a token of the design system, and was left out: the token groups are filled in from the design system.`
            : `${key} was given as ${String(value)}; the design system's ${String(ours[key])} is kept. Change values in the design system (${TOOLS.write_design_system}), not in DESIGN.md's front matter.`,
        path: key,
        severity: "warning",
      })
    );
};

export class DesignMd extends Context.Service<
  DesignMd,
  {
    /** DESIGN.md at the root of the repository, repository-relative: where it is written. */
    readonly file: string;
    /**
     * The document as the editor shows it, with what Sync has to settle against `ds`: the
     * root's, or the designs directory's while the root has none; null with neither.
     */
    readonly document: (
      ds: DesignSystem | null
    ) => Effect.Effect<DesignDocument | null>;
    /**
     * The front matter a design system comes to (ADR 0027, 0028): its tokens and their values in
     * the format, and the component tokens of the system components whose look the project
     * owns, read from their files (ADR 0041).
     */
    readonly mirror: (ds: DesignSystem) => Effect.Effect<TokenGroups>;
    /**
     * What a writer's DESIGN.md is saved as beside `ds`: its token groups the design system's,
     * filled in whatever it says, and the baseline it moves to. `findings` are what the format's
     * linter says and what was put back; a linter error refuses it.
     */
    readonly toWrite: (
      text: string,
      ds: DesignSystem
    ) => Effect.Effect<
      {
        readonly designMd: DocumentBaseline;
        readonly findings: readonly DesignFinding[];
        readonly text: string;
      },
      BadRequest
    >;
    /**
     * The front matter brought up to the design system: the values it changed alone written
     * in, the baseline moved with them, both outside the undo history (ADR 0027, 0028). A
     * document in the designs directory waits for Sync to move it; one with values of its own
     * keeps them for Sync to offer; one the design system agrees on nothing with yet is left
     * to Sync. `read` gives the design system once DESIGN.md's turn comes, after whatever
     * placed or edited it: a design system read before a baseline was placed never moves it.
     */
    readonly follow: (
      read: Effect.Effect<DesignSystem | null>
    ) => Effect.Effect<void>;
    /**
     * Puts DESIGN.md at the root of the repository, in one undo step: the designs directory's
     * moved there, or a first one made from `ds`, its front matter filled in; the baseline from
     * every value they share.
     */
    readonly place: (
      ds: DesignSystem | null
    ) => Effect.Effect<{ readonly path: string }, EditFailure>;
    /**
     * One `##` section given its text, or added where the format orders it: what the Design
     * system panel's Edit writes. One undo step.
     */
    readonly setSection: (
      name: string,
      text: string
    ) => Effect.Effect<void, EditFailure>;
    /** Each time the document may have changed, whoever changed it. */
    readonly changes: Stream.Stream<void>;
  }
>()("ultrapaint/server/DesignMd") {
  static readonly layer = Layer.effect(
    DesignMd,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rootFile = path.join(paths.root, DESIGN_MD_FILE);
      const file = paths.relative(rootFile);
      const legacyCandidate = path.join(paths.designsDir, DESIGN_NOTES_FILE);
      // A designs directory at the root of the repository has one DESIGN.md, not two.
      const legacyFile = legacyCandidate === rootFile ? null : legacyCandidate;
      const moveBaseline = baselineMover(
        edit,
        paths.relative(path.join(paths.designsDir, DESIGN_SYSTEM_FILE))
      );
      // Whatever writes DESIGN.md or its baseline, one at a time.
      const serially = (yield* Semaphore.make(1)).withPermits(1);

      const readOptional = (abs: string) =>
        Effect.orElseSucceed(
          Effect.map(fs.readFileString(abs), (text): string | null => text),
          () => null
        );

      /** The root's DESIGN.md, or the designs directory's while the root has none. */
      const cache = makeStampedCache(
        fs,
        Effect.gen(function* () {
          const [root, legacy] = yield* Effect.all([
            readOptional(rootFile),
            legacyFile === null
              ? Effect.succeed(null)
              : readOptional(legacyFile),
          ]);
          let found: Found | null = null;
          if (root !== null) {
            found = { legacy: false, path: file, text: root };
          } else if (legacy !== null && legacyFile !== null) {
            found = {
              legacy: true,
              path: paths.relative(legacyFile),
              text: legacy,
            };
          }
          return {
            files: [rootFile, ...(legacyFile ? [legacyFile] : [])],
            value: found,
          };
        })
      );
      const current = cache.get;

      /** The linter's findings for the last text it read: a get reads the same file again. */
      let linted: {
        readonly findings: readonly DesignFinding[];
        readonly text: string;
      } | null = null;
      const lintOf = (text: string) =>
        Effect.sync(() => {
          if (linted?.text !== text) {
            linted = { findings: lintDocument(text), text };
          }
          return linted.findings;
        });

      /**
       * The component tokens of the system components whose look the project owns, read from
       * their files: kept until the components directory or one of its files changes, so a get
       * or a mirror does not read every component again.
       */
      const componentsDir = path.join(paths.designsDir, COMPONENTS_DIR);
      const lookEntries = makeStampedCache(
        fs,
        Effect.map(
          readComponents(paths.designsDir).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path)
          ),
          (list) => ({
            files: [
              componentsDir,
              ...list.components.map((c) =>
                path.join(paths.designsDir, c.file)
              ),
            ],
            value: componentEntries(
              looksOf(systemComponentsIn(componentsIn(list.components)))
            ),
          })
        )
      );

      /** The last front matter worked out, kept while the design system and the looks are the same. */
      let mirrored: {
        readonly ds: DesignSystem;
        readonly entries: Effect.Success<typeof lookEntries.get>;
        readonly groups: TokenGroups;
      } | null = null;
      const mirror = Effect.fnUntraced(function* (ds: DesignSystem) {
        const entries = yield* lookEntries.get;
        if (!(mirrored?.ds === ds && mirrored.entries === entries)) {
          mirrored = { ds, entries, groups: mirrorOf(ds, entries).groups };
        }
        return mirrored.groups;
      });

      const document = Effect.fnUntraced(function* (ds: DesignSystem | null) {
        const found = yield* current;
        if (found === null) {
          return null;
        }
        const doc = parse(found.text);
        const held =
          ds && !found.legacy
            ? mergeMirror(doc, yield* mirror(ds), agreedOf(ds)).held
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

      const toWrite = Effect.fnUntraced(function* (
        text: string,
        ds: DesignSystem
      ) {
        const groups = yield* mirror(ds);
        const written = withMirror(text, groups);
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
          designMd: documentBaseline(ds.designMd, {
            agreed: valuesOf(groups),
            at: yield* Clock.currentTimeMillis,
          }),
          findings: [
            ...putBack(text, groups),
            ...findings.filter((f) => f.severity === "warning"),
          ],
          text: written.text,
        };
      });

      const follow = Effect.fnUntraced(
        function* (read: Effect.Effect<DesignSystem | null>) {
          const ds = yield* read;
          const found = yield* current;
          if (!(ds && found && !found.legacy)) {
            return;
          }
          const groups = yield* mirror(ds);
          const agreed = agreedOf(ds);
          const rewrite = (content: string) => {
            const next = withMirror(
              content,
              mergeMirror(parse(content), groups, agreed).groups
            );
            return "problem" in next ? content : next.text;
          };
          // A document taken away meanwhile stays away.
          yield* edit.amend(file, (content) =>
            content === null
              ? Effect.fail(new DocumentGone({ message: `${file} is gone` }))
              : Effect.succeed([rewrite(content), null] as const)
          );
          const after = mergeMirror(parse(found.text), groups, agreed).agreed;
          if (agreed === null && Object.keys(after).length === 0) {
            // Nothing agreed yet, and nothing now: Sync matches the document first.
            return;
          }
          // The baseline beside it, unless the file does not read (reading it says why).
          yield* moveBaseline(
            "designMd",
            agreeOn(after, yield* Clock.currentTimeMillis)
          );
        },
        serially,
        Effect.ignore({ log: true }),
        Effect.withSpan("DesignMd.follow")
      );

      /**
       * The document placed at the root: the designs directory's with the design system's
       * tokens in its front matter, or a first one; null with neither to write it from.
       */
      const placedText = (
        legacy: string | null,
        groups: TokenGroups | null
      ): string | null => {
        if (groups === null) {
          return legacy;
        }
        if (legacy === null) {
          return create(groups, { name: path.basename(paths.root) });
        }
        const next = withMirror(
          legacy,
          mergeMirror(parse(legacy), groups, null).groups
        );
        return "problem" in next ? legacy : next.text;
      };

      const place = Effect.fn("DesignMd.place")(function* (
        ds: DesignSystem | null
      ) {
        const legacy = yield* current;
        if (legacy && !legacy.legacy) {
          return { path: legacy.path };
        }
        const groups = ds ? yield* mirror(ds) : null;
        const text = placedText(legacy?.text ?? null, groups);
        if (text === null) {
          return yield* new BadRequest({
            message:
              "There is no design system to write DESIGN.md from yet: define it first.",
          });
        }
        // What the document and the design system agree on from now: every value they share.
        const agreed = groups && mergeMirror(parse(text), groups, {}).agreed;
        yield* edit.transaction(
          legacy ? "Move DESIGN.md to the repository root" : "Write DESIGN.md",
          (tx) =>
            Effect.gen(function* () {
              if (legacy) {
                yield* tx.move(legacy.path, file);
              }
              yield* tx.write(file, text);
            })
        );
        // The baseline beside it, outside the undo history as every baseline moves, unless
        // `design-system.json` does not read (reading it says why).
        if (agreed) {
          yield* Effect.ignore(
            moveBaseline(
              "designMd",
              agreeOn(agreed, yield* Clock.currentTimeMillis)
            )
          );
        }
        return { path: file };
      }, serially);

      const setSection = Effect.fn("DesignMd.setSection")(function* (
        name: string,
        text: string
      ) {
        const found = yield* current;
        if (!found) {
          return yield* new BadRequest({
            message: "There is no DESIGN.md to write in yet: Sync writes one.",
          });
        }
        yield* edit.transaction(`Edit DESIGN.md's ${name}`, (tx) =>
          tx.write(found.path, withSection(found.text, name, text))
        );
      }, serially);

      const names = new Set([
        file,
        ...(legacyFile ? [paths.relative(legacyFile)] : []),
      ]);
      // The root's DESIGN.md is outside the designs directory the pages watcher watches.
      const rootChanges = fs.watch(paths.root).pipe(
        Stream.filter((event) => path.basename(event.path) === DESIGN_MD_FILE),
        // A root that cannot be watched only means its changes are seen later.
        Stream.catch(() => Stream.empty)
      );
      const changes = Stream.merge(
        (yield* DesignFiles)
          .changes(["notes"])
          .pipe(Stream.filter((changed) => names.has(changed.file))),
        rootChanges
      ).pipe(Stream.as(undefined));

      return DesignMd.of({
        changes,
        document,
        file,
        follow,
        mirror,
        place,
        setSection,
        toWrite,
      });
    })
  );
}
