/**
 * The link between a design and the code that implements it (ADR 0030). `implementation.json` in
 * the designs directory says, per page and per component spec, whether it is ready and which
 * files implement it, with the hashes of both sides when it was implemented; the design as it was
 * then is kept in `_implemented/`, so the next implementation is told what changed. The status is
 * worked out when it is asked for: the design's hash against the binding's, each file's against
 * its own. Code that changed is a flag, never read back into the design.
 */

import type { Comment } from "@ultrapaint/contracts/comments";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  BadRequest,
  type ForbiddenPath,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  type Binding,
  IMPLEMENTATION_FILE,
  type ImplementationChanges,
  type ImplementationEntry,
  ImplementationFile,
  type ImplementationItem,
  type ImplementationList,
  implementedFileOf,
  isSpecTarget,
  SPEC_TARGET_PREFIX,
  specTarget,
} from "@ultrapaint/contracts/implementation";
import type { Page } from "@ultrapaint/contracts/pages";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";
import { describeDiff, diffTrees } from "@ultrapaint/design-document/diff";
import { serialise } from "@ultrapaint/design-document/factories";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Stream,
} from "effect";
import { EventBus } from "../events.ts";
import { hashContent } from "../hash.ts";
import { CommentsService } from "./comments.ts";
import { DocumentService } from "./documents.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { PagesService } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";
import { SpecService } from "./specs.ts";

const decodeFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ImplementationFile)
);

/** JSON with every object's keys in order: the same design always hashes the same. */
export const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b)
          )
        )
      : v
  );

/** A behaviour note as the design's hash and an implementation task carry it. */
export interface Note {
  readonly element: string | null;
  readonly id: string;
  readonly nodeId: string | null;
  readonly text: string;
}

const noteOf = (c: Comment): Note => ({
  element: c.element,
  id: c.id,
  nodeId: c.nodeId,
  text: c.text,
});

/** What a page was when it was implemented, or a spec. */
export type Implemented =
  | {
      readonly kind: "page";
      readonly notes: readonly Note[];
      readonly root: DesignNode;
    }
  | { readonly kind: "spec"; readonly spec: ComponentSpec };

/** A design as it is now: what it is, what it hashes to, and what is kept of it once implemented. */
export interface Current {
  readonly hash: string;
  readonly name: string;
  readonly page?: Page | undefined;
  readonly snapshot: Implemented;
  readonly target: string;
}

const emptyFile = (): ImplementationFile => ({ items: {}, version: 1 });

/** What changed between a design as it was implemented and as it is, a line each. */
const changedLines = (before: Implemented, now: Implemented): string[] => {
  if (before.kind === "page" && now.kind === "page") {
    const diff = describeDiff(diffTrees(before.root, now.root));
    return [
      ...(diff === "No changes." ? [] : diff.split("\n")),
      ...describeNoteChanges(before.notes, now.notes),
    ];
  }
  if (before.kind === "spec" && now.kind === "spec") {
    return describeSpecChanges(before.spec, now.spec);
  }
  return [];
};

/** Values by path, nested objects flattened: what a spec's comparison goes through. */
const flatten = (
  value: unknown,
  prefix = "",
  into: Record<string, unknown> = {}
): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value)) {
      flatten(v, prefix ? `${prefix}.${key}` : key, into);
    }
  } else {
    into[prefix] = value;
  }
  return into;
};

/** What changed in a spec, a line per field. */
export const describeSpecChanges = (
  before: ComponentSpec,
  after: ComponentSpec
): string[] => {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const shown = (v: unknown) =>
    v === undefined ? "(none)" : JSON.stringify(v);
  return keys
    .filter((k) => stableJson(a[k]) !== stableJson(b[k]))
    .map((k) => `- ${k}: ${shown(a[k])} → ${shown(b[k])}`);
};

/** What changed in the behaviour notes, a line per note. */
export const describeNoteChanges = (
  before: readonly Note[],
  after: readonly Note[]
): string[] => {
  const was = new Map(before.map((n) => [n.id, n]));
  const now = new Map(after.map((n) => [n.id, n]));
  const where = (n: Note) =>
    n.element ? ` on ${n.element}${n.nodeId ? ` (${n.nodeId})` : ""}` : "";
  return [
    ...after.flatMap((n) => {
      const old = was.get(n.id);
      if (!old) {
        return [`- new behaviour note${where(n)}: ${n.text}`];
      }
      return old.text === n.text
        ? []
        : [`- behaviour note${where(n)} now says: ${n.text}`];
    }),
    ...before
      .filter((n) => !now.has(n.id))
      .map((n) => `- behaviour note${where(n)} taken away: ${n.text}`),
  ];
};

export class ImplementationService extends Context.Service<
  ImplementationService,
  {
    readonly list: Effect.Effect<ImplementationList>;
    readonly item: (
      target: string
    ) => Effect.Effect<ImplementationItem, NotFound>;
    /** A design as it is now, for an implementation task. */
    readonly current: (target: string) => Effect.Effect<Current, NotFound>;
    /** The design as it was implemented, and the binding, when it was. */
    readonly implemented: (target: string) => Effect.Effect<{
      readonly binding: Binding;
      readonly snapshot: Implemented | null;
    } | null>;
    readonly changes: (
      target: string
    ) => Effect.Effect<ImplementationChanges, NotFound>;
    /** The open behaviour notes of a page (ADR 0030). */
    readonly notes: (page: Page) => Effect.Effect<readonly Note[]>;
    readonly setReady: (
      target: string,
      ready: boolean
    ) => Effect.Effect<ImplementationItem, NotFound | EditFailure>;
    readonly mark: (
      target: string,
      files: readonly string[]
    ) => Effect.Effect<
      ImplementationItem,
      NotFound | EditFailure | ForbiddenPath
    >;
    readonly unbind: (
      target: string
    ) => Effect.Effect<void, NotFound | EditFailure>;
  }
>()("ultrapaint/server/ImplementationService") {
  static readonly layer = Layer.effect(
    ImplementationService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const pages = yield* PagesService;
      const documents = yield* DocumentService;
      const comments = yield* CommentsService;
      const specService = yield* SpecService;
      const fileAbs = path.join(paths.designsDir, IMPLEMENTATION_FILE);
      const fileRel = paths.relative(fileAbs);

      const readFile = fs.readFileString(fileAbs).pipe(
        Effect.flatMap(decodeFile),
        // None yet, or one that does not read: nothing is bound. A broken file is not
        // overwritten until something is marked, which writes it whole.
        Effect.orElseSucceed(emptyFile)
      );

      /** Where the design as it was implemented is kept, repository-relative. */
      const snapshotRel = (target: string) =>
        paths.relative(path.join(paths.designsDir, implementedFileOf(target)));

      const notes = (page: Page) =>
        comments.list(page.canvas).pipe(
          Effect.map((pinned) =>
            pinned.comments
              .filter(
                (comment) =>
                  comment.page === page.path &&
                  comment.kind === "behaviour" &&
                  !comment.resolved
              )
              .map(noteOf)
          ),
          Effect.orElseSucceed((): Note[] => [])
        );

      const pageName = (page: Page) =>
        [page.name, page.variant ?? page.state].filter(Boolean).join(" · ");

      const pageCurrent = Effect.fnUntraced(function* (
        page: Page
      ): Effect.fn.Return<Current | null> {
        const state = yield* documents
          .get(page.id)
          .pipe(Effect.orElseSucceed(() => null));
        const root = state?.root ?? null;
        if (!root) {
          return null;
        }
        const pageNotes = yield* notes(page);
        const snapshot: Implemented = { kind: "page", notes: pageNotes, root };
        const found: Current = {
          hash: hashContent(stableJson({ notes: pageNotes, root })),
          name: pageName(page),
          page,
          snapshot,
          target: page.id,
        };
        return found;
      });

      const specCurrent = (spec: ComponentSpec): Current => ({
        hash: hashContent(stableJson(spec)),
        name: spec.component,
        snapshot: { kind: "spec", spec },
        target: specTarget(spec.component),
      });

      /** Every design there is to implement, as it is now. */
      const everything = Effect.gen(function* () {
        const { pages: all } = yield* pages.list;
        const fromPages = yield* Effect.forEach(all, pageCurrent);
        const specs = yield* specService.specs;
        return [
          ...fromPages.filter((c): c is Current => c !== null),
          ...specs.map(specCurrent),
        ];
      });

      const current = Effect.fn("ImplementationService.current")(function* (
        target: string
      ) {
        if (isSpecTarget(target)) {
          const name = target.slice(SPEC_TARGET_PREFIX.length);
          const spec = (yield* specService.specs).find(
            (s) => s.component === name
          );
          if (!spec) {
            return yield* new NotFound({ message: `no spec for ${name}` });
          }
          return specCurrent(spec);
        }
        const { pages: all } = yield* pages.list;
        const page = all.find((p) => p.id === target || p.file === target);
        const found = page ? yield* pageCurrent(page) : null;
        if (!found) {
          return yield* new NotFound({
            message: `no page ${target}: name a page by its id, or a spec as spec:<Component>`,
          });
        }
        return found;
      });

      const hashFiles = (files: readonly string[]) =>
        Effect.forEach(files, (file) =>
          fs.readFileString(path.resolve(paths.root, file)).pipe(
            Effect.map((text) => [file, hashContent(text)] as const),
            Effect.orElseSucceed(() => [file, null] as const)
          )
        );

      const itemOf = Effect.fnUntraced(function* (
        found: Current,
        entry: ImplementationEntry | undefined
      ) {
        const binding = entry?.implemented;
        const ready = entry?.ready ?? false;
        const kind = isSpecTarget(found.target) ? "spec" : "page";
        if (!binding) {
          return {
            changedFiles: [],
            codeChanged: false,
            designChanged: false,
            files: [],
            kind,
            name: found.name,
            ready,
            status: ready ? "ready" : "draft",
            target: found.target,
          } satisfies ImplementationItem;
        }
        const hashes = yield* hashFiles(binding.files);
        const changedFiles = hashes
          .filter(
            ([file, hash]) => hash === null || binding.code[file] !== hash
          )
          .map(([file]) => file);
        const designChanged = binding.design !== found.hash;
        const codeChanged = changedFiles.length > 0;
        return {
          at: binding.at,
          changedFiles,
          codeChanged,
          designChanged,
          files: [...binding.files],
          kind,
          name: found.name,
          ready,
          status: designChanged || codeChanged ? "changed" : "implemented",
          target: found.target,
        } satisfies ImplementationItem;
      });

      const list: Effect.Effect<ImplementationList> = Effect.gen(function* () {
        const file = yield* readFile;
        const all = yield* everything;
        const items = yield* Effect.forEach(all, (found) =>
          itemOf(found, file.items[found.target])
        );
        return { items };
      }).pipe(Effect.withSpan("ImplementationService.list"));

      const item = Effect.fn("ImplementationService.item")(function* (
        target: string
      ) {
        const found = yield* current(target);
        const file = yield* readFile;
        return yield* itemOf(found, file.items[found.target]);
      });

      const publish = Effect.flatMap(list, (l) =>
        events.publish("implementation", l)
      );

      /** `implementation.json` with one entry changed, and the files to write with it. */
      const writeEntry = Effect.fnUntraced(function* (
        target: string,
        label: string,
        update: (entry: ImplementationEntry) => ImplementationEntry | null,
        snapshot?: { readonly rel: string; readonly text: string | null }
      ) {
        yield* edit.transaction(label, (tx) =>
          Effect.gen(function* () {
            // Read in the action, so a change made meanwhile is kept.
            const file = yield* readFile;
            const next = update(file.items[target] ?? {});
            const { [target]: _old, ...rest } = file.items;
            const items = next === null ? rest : { ...rest, [target]: next };
            const sorted = Object.fromEntries(
              Object.entries(items).sort(([a], [b]) => a.localeCompare(b))
            );
            yield* tx.write(fileRel, serialise({ items: sorted, version: 1 }));
            if (snapshot) {
              if (snapshot.text === null) {
                yield* tx.remove(snapshot.rel);
              } else {
                yield* tx.write(snapshot.rel, snapshot.text);
              }
            }
          })
        );
        yield* publish;
      });

      const setReady = Effect.fn("ImplementationService.setReady")(function* (
        target: string,
        ready: boolean
      ) {
        const found = yield* current(target);
        yield* writeEntry(
          found.target,
          ready
            ? `Mark ${found.name} ready to implement`
            : `Mark ${found.name} not ready`,
          (entry) => {
            const { ready: _ready, ...rest } = entry;
            const next = ready ? { ...rest, ready: true } : rest;
            return Object.keys(next).length === 0 ? null : next;
          }
        );
        return yield* item(found.target);
      });

      const mark = Effect.fn("ImplementationService.mark")(function* (
        target: string,
        files: readonly string[]
      ) {
        const found = yield* current(target);
        if (files.length === 0) {
          return yield* new BadRequest({
            message:
              "name the files that implement it, repository-relative: src/routes/orders.tsx",
          });
        }
        const checked = yield* Effect.forEach(files, (file) =>
          Effect.map(paths.resolve(file), (abs) => paths.relative(abs))
        );
        const unique = [...new Set(checked)].sort();
        const hashes = yield* hashFiles(unique);
        const missing = hashes.filter(([, h]) => h === null).map(([f]) => f);
        if (missing.length > 0) {
          return yield* new BadRequest({
            message: `not in the repository: ${missing.join(", ")}`,
          });
        }
        const binding: Binding = {
          at: yield* Clock.currentTimeMillis,
          code: Object.fromEntries(
            hashes.flatMap(([f, h]) => (h === null ? [] : [[f, h] as const]))
          ),
          design: found.hash,
          files: unique,
        };
        yield* writeEntry(
          found.target,
          `Mark ${found.name} implemented`,
          (entry) => {
            const { ready: _ready, ...rest } = entry;
            return { ...rest, implemented: binding };
          },
          { rel: snapshotRel(found.target), text: serialise(found.snapshot) }
        );
        return yield* item(found.target);
      });

      const unbind = Effect.fn("ImplementationService.unbind")(function* (
        target: string
      ) {
        const found = yield* current(target);
        const file = yield* readFile;
        if (!file.items[found.target]) {
          return;
        }
        const rel = snapshotRel(found.target);
        const kept = yield* fs
          .exists(path.resolve(paths.root, rel))
          .pipe(Effect.orElseSucceed(() => false));
        yield* writeEntry(
          found.target,
          `Unlink ${found.name} from its code`,
          () => null,
          kept ? { rel, text: null } : undefined
        );
      });

      const implemented = (target: string) =>
        Effect.gen(function* () {
          const file = yield* readFile;
          const binding = file.items[target]?.implemented;
          if (!binding) {
            return null;
          }
          const snapshot = yield* fs
            .readFileString(path.resolve(paths.root, snapshotRel(target)))
            .pipe(
              Effect.map((text) => JSON.parse(text) as Implemented),
              // A snapshot taken away or not readable: the binding still holds, the diff not.
              Effect.orElseSucceed(() => null)
            );
          return { binding, snapshot };
        });

      const changes = Effect.fn("ImplementationService.changes")(function* (
        target: string
      ) {
        const found = yield* current(target);
        const was = yield* implemented(found.target);
        if (!was) {
          return {
            empty: false,
            implemented: false,
            text: `${found.name} has not been implemented yet.`,
          } satisfies ImplementationChanges;
        }
        if (was.binding.design === found.hash) {
          return {
            empty: true,
            implemented: true,
            text: "No changes.",
          } satisfies ImplementationChanges;
        }
        const now = found.snapshot;
        const before = was.snapshot;
        if (!before || before.kind !== now.kind) {
          return {
            empty: false,
            implemented: true,
            text: "The design changed, and how it was when it was implemented is not kept: implement it as it is now.",
          } satisfies ImplementationChanges;
        }
        const lines = changedLines(before, now);
        return {
          empty: lines.length === 0,
          implemented: true,
          text: lines.length === 0 ? "No changes." : lines.join("\n"),
        } satisfies ImplementationChanges;
      });

      // What the status reads changed: the file, a page, a spec, a comment.
      const poke = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
        Stream.map(stream, () => undefined);
      yield* Stream.mergeAll(
        [
          poke(
            events
              .subscribe("file.changed")
              .pipe(Stream.filter(({ file }) => file === fileRel))
          ),
          poke(events.subscribe("document")),
          poke(events.subscribe("pages")),
          poke(events.subscribe("specs")),
          poke(events.subscribe("comments")),
        ],
        { concurrency: "unbounded" }
      ).pipe(
        Stream.debounce("300 millis"),
        Stream.runForEach(() => Effect.ignore(publish, { log: true })),
        Effect.forkScoped
      );

      return ImplementationService.of({
        changes,
        current,
        implemented,
        item,
        list,
        mark,
        notes,
        setReady,
        unbind,
      });
    })
  );
}
