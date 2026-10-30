/**
 * The link between a design and the code that implements it (ADR 0030). `implementation.json` in
 * the designs directory says, per page and per component (ADR 0041), whether it is ready and which
 * files implement it, with the hashes of both sides when it was implemented; the design as it was
 * then is kept in `_implemented/`, so the next implementation is told what changed. The status is
 * worked out when it is asked for: the design's hash against the binding's, each file's against
 * its own. Code that changed is a flag, never read back into the design.
 */

import type { Comment } from "@ultrapaint/contracts/comments";
import {
  type ComponentFile,
  type ComponentNote,
  componentsIn,
} from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  BadRequest,
  type ForbiddenPath,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  type Binding,
  COMPONENT_TARGET_PREFIX,
  componentTarget,
  IMPLEMENTATION_FILE,
  type ImplementationChanges,
  type ImplementationEntry,
  ImplementationFile,
  type ImplementationItem,
  type ImplementationList,
  implementedFileOf,
  isComponentTarget,
} from "@ultrapaint/contracts/implementation";
import type { Page } from "@ultrapaint/contracts/pages";
import type { TokenDiff } from "@ultrapaint/contracts/sync";
import { describeDiff, diffTrees } from "@ultrapaint/design-document/diff";
import { serialise } from "@ultrapaint/design-document/factories";
import { tokensIn, tokensUsed } from "@ultrapaint/design-document/tokens";
import { plural } from "@ultrapaint/shared/text";
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
import { componentHash, hashContent, stableJson } from "../hash.ts";
import { CodeSide } from "./code-side.ts";
import { CommentsService } from "./comments.ts";
import { readComponents } from "./components.ts";
import { DesignSystemService } from "./design-system.ts";
import { DocumentService } from "./documents.ts";
import { type EditFailure, EditService, type EditTransaction } from "./edit.ts";
import { PagesService } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";
import { handoffCall } from "./threads/agent-ways.ts";

const decodeFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ImplementationFile)
);

/** A behaviour note as the design's hash and an implementation task carry it. */
export interface Note {
  readonly element: string | null;
  readonly id: string;
  readonly nodeId: string | null;
  readonly text: string;
}

/** A page's behaviour note, a comment pinned on it (ADR 0030). */
export const commentNote = (c: Comment): Note => ({
  element: c.element,
  id: c.id,
  nodeId: c.nodeId,
  text: c.text,
});

/** A page's open behaviour notes: the comments of its canvas pinned on it, a resolved one done. */
export const pageNotes = (page: Page, comments: readonly Comment[]): Note[] =>
  comments
    .filter(
      (c) => c.page === page.path && c.kind === "behaviour" && !c.resolved
    )
    .map(commentNote);

/** A component's behaviour note as a page's reads: its part where a node's name would be. */
export const componentNote = (n: ComponentNote): Note => ({
  element: n.slot ?? null,
  id: n.id,
  nodeId: null,
  text: n.text,
});

/**
 * A component's behaviour notes (ADR 0041), kept in its file. Deleted rather than resolved, so
 * every one is open.
 */
export const componentNotes = (component: ComponentFile): Note[] =>
  (component.notes ?? []).map(componentNote);

/** What a page was when it was implemented, or a component. */
export type Implemented =
  | {
      readonly kind: "page";
      readonly notes: readonly Note[];
      readonly root: DesignNode;
    }
  | { readonly kind: "component"; readonly component: ComponentFile };

/** A design as it is now: what it is, what it hashes to, and what is kept of it once implemented. */
export interface Current {
  readonly hash: string;
  readonly name: string;
  readonly page?: Page | undefined;
  readonly snapshot: Implemented;
  readonly target: string;
}

const emptyFile = (): ImplementationFile => ({ items: {}, version: 1 });

/** A change to one entry of `implementation.json`, and the snapshot written or taken with it. */
export interface EntryEdit {
  readonly snapshot?: {
    readonly rel: string;
    /** Null takes the snapshot away. */
    readonly text: string | null;
  };
  readonly target: string;
  readonly update: (entry: ImplementationEntry) => ImplementationEntry | null;
}

/** The entries with the edits made, in order of their keys: the file is committed. */
const withEdits = (
  items: Readonly<Record<string, ImplementationEntry>>,
  edits: readonly EntryEdit[]
): Record<string, ImplementationEntry> => {
  const next: Record<string, ImplementationEntry> = { ...items };
  for (const { target, update } of edits) {
    const entry = update(next[target] ?? {});
    delete next[target];
    if (entry !== null) {
      next[target] = entry;
    }
  }
  return Object.fromEntries(
    Object.entries(next).sort(([a], [b]) => a.localeCompare(b))
  );
};

/** What telling which tokens a design waits on needs, read once for a whole list. */
interface TokenContext {
  readonly components: readonly ComponentFile[];
  readonly designSystem: DesignSystem | null;
  /** The code comparison's tokens whose design value has not reached the code, by name. */
  readonly waiting: ReadonlyMap<string, readonly TokenDiff[]>;
}

/**
 * The tokens a design relies on (ADR 0028): a page's, with its text styles and the components it
 * places, or a component's, the components its tree places included.
 */
const usesOf = (snapshot: Implemented, ctx: TokenContext): Set<string> => {
  if (snapshot.kind === "page") {
    return tokensUsed(snapshot.root, ctx.designSystem, ctx.components);
  }
  const { component } = snapshot;
  return component.origin === "app"
    ? tokensUsed(component.tree, ctx.designSystem, ctx.components)
    : tokensIn(component);
};

/** The tokens a design relies on that wait for the code, sorted. */
const waitingOf = (snapshot: Implemented, ctx: TokenContext): string[] =>
  [...usesOf(snapshot, ctx)].filter((name) => ctx.waiting.has(name)).sort();

/** What changed between a design as it was implemented and as it is, a line each. */
const changedLines = (before: Implemented, now: Implemented): string[] => {
  if (before.kind === "page" && now.kind === "page") {
    const diff = describeDiff(diffTrees(before.root, now.root));
    return [
      ...(diff === "No changes." ? [] : diff.split("\n")),
      ...describeNoteChanges(before.notes, now.notes),
    ];
  }
  if (before.kind === "component" && now.kind === "component") {
    const { notes: _was, ...look } = before.component;
    const { notes: _is, ...after } = now.component;
    return [
      ...describeComponentChanges(look, after),
      ...describeNoteChanges(
        componentNotes(before.component),
        componentNotes(now.component)
      ),
    ];
  }
  return [];
};

/** Values by path, nested objects flattened: what a component's comparison goes through. */
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

/** What changed in a component's file, a line per field. */
const describeComponentChanges = (
  before: Omit<ComponentFile, "notes">,
  after: Omit<ComponentFile, "notes">
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
const describeNoteChanges = (
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
    /**
     * A design as it is now, for an implementation task, by its canonical target: a page's id
     * or `component:<Name>`. A name an agent or a user wrote is `DesignTargets.resolve`'s.
     */
    readonly current: (target: string) => Effect.Effect<Current, NotFound>;
    /** The design as it was implemented, and the binding, when it was. */
    readonly implemented: (target: string) => Effect.Effect<{
      readonly binding: Binding;
      readonly snapshot: Implemented | null;
    } | null>;
    readonly changes: (
      target: string
    ) => Effect.Effect<ImplementationChanges, NotFound>;
    /**
     * The design system's tokens whose value has not reached the code (ADR 0028): those the
     * design relies on, each with its comparison per theme, and how many others wait.
     */
    readonly tokens: (target: string) => Effect.Effect<
      {
        readonly others: number;
        readonly used: readonly TokenDiff[];
      },
      NotFound
    >;
    readonly setReady: (
      target: string,
      ready: boolean
    ) => Effect.Effect<ImplementationItem, NotFound | EditFailure>;
    /**
     * The design marked implemented by these files. `faithful` refuses while tokens the design
     * relies on wait for the code (ADR 0028): what an agent marks has to draw as designed.
     */
    readonly mark: (
      target: string,
      files: readonly string[],
      faithful?: boolean
    ) => Effect.Effect<
      ImplementationItem,
      NotFound | EditFailure | ForbiddenPath
    >;
    /** Several designs marked ready, or not, in one undo step; one implemented already is left. */
    readonly setReadyAll: (
      targets: readonly string[],
      ready: boolean
    ) => Effect.Effect<number, NotFound | EditFailure>;
    /** Several designs marked implemented by their files, in one undo step (ADR 0030). */
    readonly markAll: (
      marks: readonly {
        readonly files: readonly string[];
        readonly target: string;
      }[]
    ) => Effect.Effect<number, NotFound | EditFailure | ForbiddenPath>;
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
      const designSystems = yield* DesignSystemService;
      const code = yield* CodeSide;
      const fileAbs = path.join(paths.designsDir, IMPLEMENTATION_FILE);
      const fileRel = paths.relative(fileAbs);
      // The components as their files have them; read here, below `ComponentService`.
      const componentsNow = readComponents(paths.designsDir).pipe(
        Effect.map((l) => componentsIn(l.components)),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path)
      );

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
          Effect.map((pinned) => pageNotes(page, pinned.comments)),
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
        const open = yield* notes(page);
        const snapshot: Implemented = { kind: "page", notes: open, root };
        const found: Current = {
          hash: hashContent(stableJson({ notes: open, root })),
          name: pageName(page),
          page,
          snapshot,
          target: page.id,
        };
        return found;
      });

      const componentCurrent = (component: ComponentFile): Current => ({
        hash: componentHash(component),
        name: component.name,
        snapshot: { component, kind: "component" },
        target: componentTarget(component.name),
      });

      /** Every design there is to implement, as it is now. */
      const everything = Effect.gen(function* () {
        const { pages: all } = yield* pages.list;
        const fromPages = yield* Effect.forEach(all, pageCurrent);
        const components = yield* componentsNow;
        return [
          ...fromPages.filter((c): c is Current => c !== null),
          ...components.map(componentCurrent),
        ];
      });

      const current = Effect.fn("ImplementationService.current")(function* (
        target: string
      ) {
        if (isComponentTarget(target)) {
          const name = target.slice(COMPONENT_TARGET_PREFIX.length);
          const component = (yield* componentsNow).find((c) => c.name === name);
          if (!component) {
            return yield* new NotFound({ message: `no component ${name}` });
          }
          return componentCurrent(component);
        }
        const { pages: all } = yield* pages.list;
        const page = all.find((p) => p.id === target);
        const found = page ? yield* pageCurrent(page) : null;
        if (!found) {
          return yield* new NotFound({
            message: `no page ${target}: name a page by its id, or a component as component:<Name>`,
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

      /** The design system, the components and what waits for the code, for a list of designs. */
      const tokenContext: Effect.Effect<TokenContext> = Effect.gen(
        function* () {
          const { designSystem } = yield* designSystems.get;
          const comparison = designSystem
            ? yield* code.comparison(designSystem)
            : null;
          const waiting = new Map<string, TokenDiff[]>();
          // No stylesheet read: nothing can be said to be missing from it.
          for (const d of comparison?.read ? comparison.diffs : []) {
            if (d.outcome === "source-behind" || d.outcome === "conflict") {
              waiting.set(d.name, [...(waiting.get(d.name) ?? []), d]);
            }
          }
          return {
            components: yield* componentsNow,
            designSystem,
            waiting,
          };
        }
      );

      const itemOf = Effect.fnUntraced(function* (
        found: Current,
        entry: ImplementationEntry | undefined,
        ctx: TokenContext
      ) {
        const binding = entry?.implemented;
        const ready = entry?.ready ?? false;
        const kind = isComponentTarget(found.target) ? "component" : "page";
        const waiting = waitingOf(found.snapshot, ctx);
        const tokens = waiting.length > 0 ? { tokens: waiting } : {};
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
            ...tokens,
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
          ...tokens,
        } satisfies ImplementationItem;
      });

      const list: Effect.Effect<ImplementationList> = Effect.gen(function* () {
        const file = yield* readFile;
        const all = yield* everything;
        const ctx = yield* tokenContext;
        const items = yield* Effect.forEach(all, (found) =>
          itemOf(found, file.items[found.target], ctx)
        );
        return { items };
      }).pipe(Effect.withSpan("ImplementationService.list"));

      const item = Effect.fn("ImplementationService.item")(function* (
        target: string
      ) {
        const found = yield* current(target);
        const file = yield* readFile;
        return yield* itemOf(
          found,
          file.items[found.target],
          yield* tokenContext
        );
      });

      const tokens = Effect.fn("ImplementationService.tokens")(function* (
        target: string
      ) {
        const found = yield* current(target);
        const ctx = yield* tokenContext;
        const used = new Set(waitingOf(found.snapshot, ctx));
        return {
          others: [...ctx.waiting.keys()].filter((name) => !used.has(name))
            .length,
          used: [...used].flatMap((name) => ctx.waiting.get(name) ?? []),
        };
      });

      const publish = Effect.flatMap(list, (l) =>
        events.publish("implementation", l)
      );

      /** `implementation.json` with entries changed inside an action, read in it. */
      const editIn = Effect.fnUntraced(function* (
        tx: EditTransaction,
        editsOf: (
          items: Readonly<Record<string, ImplementationEntry>>
        ) => readonly EntryEdit[]
      ) {
        // Read in the action, so a change made meanwhile is kept.
        const file = yield* readFile;
        const edits = editsOf(file.items);
        if (edits.length === 0) {
          return;
        }
        yield* tx.write(
          fileRel,
          serialise({ items: withEdits(file.items, edits), version: 1 })
        );
        for (const { snapshot } of edits) {
          if (snapshot) {
            yield* snapshot.text === null
              ? tx.remove(snapshot.rel)
              : tx.write(snapshot.rel, snapshot.text);
          }
        }
      });

      /** `implementation.json` with entries changed, and the files to write with them: one undo step. */
      const writeEntries = Effect.fnUntraced(function* (
        label: string,
        edits: readonly EntryEdit[]
      ) {
        yield* edit.transaction(label, (tx) => editIn(tx, () => edits));
        yield* publish;
      });

      /** `implementation.json` with one entry changed, and the files to write with it. */
      const writeEntry = (
        target: string,
        label: string,
        update: (entry: ImplementationEntry) => ImplementationEntry | null,
        snapshot?: { readonly rel: string; readonly text: string | null }
      ) =>
        writeEntries(label, [
          { target, update, ...(snapshot !== undefined && { snapshot }) },
        ]);

      /** A design ready, or not, as an entry has it. */
      const readyIn =
        (ready: boolean) =>
        (entry: ImplementationEntry): ImplementationEntry | null => {
          const { ready: _ready, ...rest } = entry;
          const next = ready ? { ...rest, ready: true } : rest;
          return Object.keys(next).length === 0 ? null : next;
        };

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
          readyIn(ready)
        );
        return yield* item(found.target);
      });

      const setReadyAll = Effect.fn("ImplementationService.setReadyAll")(
        function* (targets: readonly string[], ready: boolean) {
          const found = yield* Effect.forEach(targets, current);
          const file = yield* readFile;
          // A design implemented already is past being ready.
          const open = found.filter(
            (f) => file.items[f.target]?.implemented === undefined
          );
          if (open.length === 0) {
            return 0;
          }
          yield* writeEntries(
            ready
              ? `Mark ${plural(open.length, "design")} ready to implement`
              : `Mark ${plural(open.length, "design")} not ready`,
            open.map((f) => ({ target: f.target, update: readyIn(ready) }))
          );
          return open.length;
        }
      );

      /** A design's binding to these files as it is now, checked: the files are there. */
      const bindingFor = Effect.fnUntraced(function* (
        found: Current,
        files: readonly string[],
        faithful: boolean,
        ctx: TokenContext | null
      ) {
        if (files.length === 0) {
          return yield* new BadRequest({
            message:
              "name the files that implement it, repository-relative: src/routes/orders.tsx",
          });
        }
        const waiting = faithful && ctx ? waitingOf(found.snapshot, ctx) : [];
        if (waiting.length > 0) {
          return yield* new BadRequest({
            message: `${found.name} uses tokens whose design value has not reached the code: ${waiting.join(", ")}. Bring them over first (${handoffCall("export", "tokens, their names")}; where both sides changed one, ask the user which value to keep), then mark it.`,
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
        return {
          snapshot: {
            rel: snapshotRel(found.target),
            text: serialise(found.snapshot),
          },
          target: found.target,
          update: (entry: ImplementationEntry): ImplementationEntry => {
            const { ready: _ready, ...rest } = entry;
            return { ...rest, implemented: binding };
          },
        };
      });

      const mark = Effect.fn("ImplementationService.mark")(function* (
        target: string,
        files: readonly string[],
        faithful = false
      ) {
        const found = yield* current(target);
        const change = yield* bindingFor(
          found,
          files,
          faithful,
          faithful ? yield* tokenContext : null
        );
        yield* writeEntries(`Mark ${found.name} implemented`, [change]);
        return yield* item(found.target);
      });

      const markAll = Effect.fn("ImplementationService.markAll")(function* (
        marks: readonly {
          readonly files: readonly string[];
          readonly target: string;
        }[]
      ) {
        const changes = yield* Effect.forEach(marks, ({ files, target }) =>
          Effect.flatMap(current(target), (found) =>
            bindingFor(found, files, false, null)
          )
        );
        if (changes.length > 0) {
          yield* writeEntries(
            `Link ${plural(changes.length, "design")} to their code`,
            changes
          );
        }
        return changes.length;
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

      // What the status reads changed: the file, a page, a component, a comment.
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
          poke(events.subscribe("components")),
          poke(events.subscribe("comments")),
          // A token exported, or changed in the design: what waits for the code moved.
          poke(events.subscribe("designSystem")),
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
        markAll,
        setReady,
        setReadyAll,
        tokens,
        unbind,
      });
    })
  );
}
