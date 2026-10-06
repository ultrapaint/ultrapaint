/**
 * The design-system setup (ADR 0023): five steps, in order, each ending at a gate. This service
 * keeps where each step is, reads the code (the inventory, and the audits against the saved
 * design system), keeps the mapping and the migration's batches, and takes a snapshot of the
 * working tree when a step or a batch starts and ends, so that redoing a step or reverting a batch
 * can put back what it changed. Threads are the RPC handlers' to open and cancel: the commands
 * that expand a step's task read this service, and the thread service is built on those commands.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import {
  type DefineMode,
  DesignSystemSetup,
  emptySetup,
  type MappingChange,
  type MigrationBatch,
  type RestoreEntry,
  SETUP_STEPS,
  type SetupStep,
  type SetupStepId,
  setupStepOf,
  UsageInventory,
  type UsageLeft,
  UsageMapping,
} from "@ultrapaint/contracts/design-system-setup";
import {
  BadRequest,
  type CommandFailed,
  type ForbiddenPath,
  type NotConfigured,
} from "@ultrapaint/contracts/errors";
import type { Framework, UsageContext } from "@ultrapaint/framework-api/node";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
} from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { EventBus } from "../events.ts";
import { hashContent, toPosix } from "../hash.ts";
import { ProjectManager } from "../project.ts";
import { CatalogueService } from "./catalogue.ts";
import { DesignSystemService } from "./design-system.ts";
import {
  applyChanges,
  batchesOf,
  inventorySummary,
  mappingCounts,
  mappingOf,
  mappingTable,
  plural,
  targetProblem,
  verifySummary,
} from "./design-system-setup-rules.ts";
import { ProjectFramework } from "./framework.ts";
import { GitService } from "./git.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Storage } from "./storage.ts";

export type SetupFailure =
  | NotConfigured
  | BadRequest
  | CommandFailed
  | ForbiddenPath;

/** What `next_batch` hands an agent: the batch, what the rules did, and what is left. */
export interface NextBatch {
  readonly batch: MigrationBatch;
  readonly files: readonly {
    readonly changes: number;
    readonly file: string;
    readonly left: readonly UsageLeft[];
  }[];
  /** Batches still to do after this one. */
  readonly remaining: number;
}

const SetupJson = Schema.fromJsonString(DesignSystemSetup);
const decodeSetup = Schema.decodeUnknownEffect(SetupJson);
const encodeSetup = Schema.encodeEffect(SetupJson);

/** Each snapshot is kept by a ref named after its tree: `refs/ultrapaint/setup/<tree>`. */
const REF_PREFIX = "refs/ultrapaint/setup";
const TRAILING_SLASH_RE = /\/+$/;

/** What the inventory is read against when there is neither a design system nor a theme. */
const emptyTheme: DesignSystem = {
  colors: [],
  radius: [],
  shadows: [],
  spacing: { base: "0.25rem" },
  typography: { fonts: [], sizes: [], styles: [], weights: [] },
  version: 1,
};

/** Bigger than this, a source file is generated or bundled, not written. */
const MAX_SOURCE_BYTES = 512 * 1024;
/** Files read between two yields, so the server keeps answering while the code is read. */
const FILES_PER_YIELD = 25;
/** An audit lists every value off the system, not the inventory's first sixty a kind. */
const AUDIT_PER_GROUP = 5000;

/** A repo-relative file's directory; `.` for one at the root. */
const dirOf = (file: string) => {
  const cut = file.lastIndexOf("/");
  return cut === -1 ? "." : file.slice(0, cut);
};

const titleOf = (id: SetupStepId) => setupStepOf(id)?.title ?? id;
const indexOf = (id: SetupStepId) => SETUP_STEPS.findIndex((s) => s.id === id);

/** A setup with every step there is, in order, whatever an older file had. */
const normalise = (setup: DesignSystemSetup): DesignSystemSetup => ({
  ...setup,
  steps: SETUP_STEPS.map(
    (s) =>
      setup.steps.find((step) => step.id === s.id) ?? {
        id: s.id,
        status: "todo" as const,
      }
  ),
});

/** Every snapshot a step keeps, its batches' included. */
const treesOf = (step: SetupStep): string[] =>
  [
    step.before,
    step.after,
    ...(step.batches ?? []).flatMap((b) => [b.before, b.after]),
  ].filter((t) => t !== undefined);

/** What the code is read with: the design system, the framework's reader, and the files. */
interface Codebase {
  readonly ctx: UsageContext;
  /** Application source files, repo-relative. */
  readonly files: readonly string[];
  readonly framework: Framework;
  readonly read: (file: string) => Effect.Effect<string | null>;
  readonly write: (file: string, text: string) => Effect.Effect<void>;
}

export class DesignSystemSetupService extends Context.Service<
  DesignSystemSetupService,
  {
    /** The code read against the saved design system, by Map and Verify. */
    readonly audit: Effect.Effect<UsageInventory | null, NotConfigured>;
    /** What reverting a batch would put back. */
    readonly batchPreview: (
      batchId: string
    ) => Effect.Effect<readonly RestoreEntry[], SetupFailure>;
    /** The user goes on past a step: the working tree is what it leaves. */
    readonly complete: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** An agent says its step is finished; it waits for the user in review. */
    readonly finish: (
      threadId: string,
      summary: string
    ) => Effect.Effect<SetupStep, SetupFailure>;
    /** The agent of Migrate says its batch is done. */
    readonly finishBatch: (
      threadId: string,
      summary: string
    ) => Effect.Effect<
      { readonly batch: MigrationBatch; readonly remaining: number },
      SetupFailure
    >;
    readonly get: Effect.Effect<DesignSystemSetup, NotConfigured>;
    readonly inventory: Effect.Effect<UsageInventory | null, NotConfigured>;
    /** What each value off the system becomes, once Map has started. */
    readonly mapping: Effect.Effect<UsageMapping | null, NotConfigured>;
    /**
     * The batch the agent of Migrate works on: the one under way, or the next, which the rules
     * rewrite first. Null when none is left.
     */
    readonly nextBatch: (
      threadId: string
    ) => Effect.Effect<NextBatch | null, SetupFailure>;
    /**
     * Puts back every file this step and the later ones changed, as it was when this step began,
     * and takes them back to todo. Their threads are left to the caller to stop first.
     */
    readonly redo: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** What `redo` would put back. */
    readonly redoPreview: (
      step: SetupStepId
    ) => Effect.Effect<readonly RestoreEntry[], SetupFailure>;
    /** A stopped step, or one in review, under way again in its thread. */
    readonly resume: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** Puts back what a batch changed and takes it back to todo. */
    readonly revertBatch: (
      batchId: string
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** Decisions on the mapping, by the agent or the user; what could not be taken says why. */
    readonly setMapping: (
      changes: readonly MappingChange[],
      by: "agent" | "user"
    ) => Effect.Effect<
      {
        readonly applied: number;
        readonly mapping: UsageMapping;
        readonly problems: readonly string[];
      },
      SetupFailure
    >;
    /**
     * Starts a step once the ones before it are done. Inventory and Verify run there and then;
     * a step an agent does is given the thread it runs in.
     */
    readonly start: (
      step: SetupStepId,
      options: { readonly mode?: DefineMode; readonly threadId?: string }
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
    /** The step a thread runs, if it runs one. */
    readonly stepOf: (
      threadId: string
    ) => Effect.Effect<SetupStep | null, NotConfigured>;
    /** Stops a step, keeping what it did. Its thread is the caller's to cancel. */
    readonly stop: (
      step: SetupStepId
    ) => Effect.Effect<DesignSystemSetup, SetupFailure>;
  }
>()("ultrapaint/server/DesignSystemSetupService") {
  static readonly layer = Layer.effect(
    DesignSystemSetupService,
    Effect.gen(function* () {
      const project = yield* ProjectManager;
      const storage = yield* Storage;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      // One change at a time: every change reads the state, snapshots and writes it back.
      const lock = yield* Semaphore.make(1);

      /** The open project's own directory in the state: one setup per repository. */
      const dir = project.use(
        Effect.gen(function* () {
          const { root } = yield* RepoPaths;
          return path.join(
            yield* storage.stateDir,
            "design-system-setup",
            hashContent(root)
          );
        })
      );

      /** A JSON file of the setup's directory; null when it is not there or no longer reads. */
      const stored = <A, I>(name: string, schema: Schema.Codec<A, I>) => {
        const json = Schema.fromJsonString(schema);
        const decode = Schema.decodeUnknownEffect(json);
        const encode = Schema.encodeEffect(json);
        return {
          read: Effect.gen(function* () {
            const file = path.join(yield* dir, name);
            return yield* fs.readFileString(file).pipe(
              Effect.flatMap(decode),
              Effect.map((found): A | null => found),
              // Not written yet, or written by a version that no longer reads.
              Effect.orElseSucceed(() => null)
            );
          }),
          write: Effect.fnUntraced(function* (value: A | null) {
            const file = path.join(yield* dir, name);
            if (value === null) {
              yield* Effect.ignore(fs.remove(file));
              return;
            }
            yield* Effect.orDie(
              Effect.flatMap(encode(value), (text) => writeAtomic(file, text))
            );
          }),
        };
      };
      const inventoryFile = stored("inventory.json", UsageInventory);
      const auditFile = stored("audit.json", UsageInventory);
      const mappingFile = stored("mapping.json", UsageMapping);

      const saveMapping = Effect.fnUntraced(function* (
        mapping: UsageMapping | null
      ) {
        yield* mappingFile.write(mapping);
        yield* events.publish("dsSetupMapping", mapping);
      });

      const get = Effect.gen(function* () {
        const file = path.join(yield* dir, "state.json");
        const now = yield* Clock.currentTimeMillis;
        return yield* fs.readFileString(file).pipe(
          Effect.flatMap(decodeSetup),
          Effect.map(normalise),
          // Never started, or written by a version that no longer reads: it starts over.
          Effect.orElseSucceed(() => emptySetup(now))
        );
      }).pipe(Effect.withSpan("DesignSystemSetupService.get"));

      const save = Effect.fnUntraced(function* (setup: DesignSystemSetup) {
        const next = { ...setup, updatedAt: yield* Clock.currentTimeMillis };
        const file = path.join(yield* dir, "state.json");
        yield* Effect.orDie(
          Effect.flatMap(encodeSetup(next), (text) => writeAtomic(file, text))
        );
        yield* events.publish("dsSetup", next);
        return next;
      });

      const git = <A, E>(
        f: (g: GitService["Service"]) => Effect.Effect<A, E>
      ) => project.use(Effect.flatMap(GitService, f));

      /** The working tree as it is, as a git tree kept by a ref named after it. */
      const snapshot = git((g) => g.snapshotTree(REF_PREFIX)).pipe(
        Effect.mapError((error) =>
          error._tag === "CommandFailed"
            ? new BadRequest({
                message: `The setup keeps each step as a git snapshot, and git could not take one: ${error.message}`,
              })
            : error
        )
      );

      const refuse = (message: string) =>
        Effect.fail(new BadRequest({ message }));

      /**
       * The code as the setup reads it: against the saved design system, or the theme's scan
       * when there is none yet and `saved` is not required.
       */
      const codebase = (required: boolean, perGroup?: number) =>
        project
          .use(
            Effect.gen(function* () {
              const paths = yield* RepoPaths;
              const repo = yield* GitService;
              const framework = yield* ProjectFramework;
              const designSystem = yield* DesignSystemService;
              const catalogue = yield* CatalogueService;
              const saved = (yield* designSystem.get).designSystem;
              if (required && !saved) {
                return yield* refuse(
                  "There is no design system saved: Define writes design-system.json first."
                );
              }
              const theme = saved ? null : yield* designSystem.scan;
              const components = yield* catalogue.get(false).pipe(
                Effect.map((c) =>
                  c.components.map((component) => component.name)
                ),
                // A catalogue that cannot be built only means plain elements are not reported.
                Effect.orElseSucceed((): string[] => [])
              );
              const designs = paths.relative(paths.designsDir);
              const files = (yield* repo.files).filter(
                (file) =>
                  framework.usage.includes(file) &&
                  file !== designs &&
                  !file.startsWith(`${designs}/`)
              );
              const ctx: UsageContext = {
                components,
                designSystem: saved ?? theme?.designSystem ?? emptyTheme,
                libraryDirs: paths.settings.libraryDirs.map((d) =>
                  toPosix(d).replace(TRAILING_SLASH_RE, "")
                ),
                ownTokens: theme ? theme.ownTokens : null,
                ...(perGroup !== undefined && { perGroup }),
              };
              const read = (file: string) =>
                fs.readFileString(path.join(paths.root, file)).pipe(
                  Effect.map((text): string | null =>
                    text.length <= MAX_SOURCE_BYTES ? text : null
                  ),
                  // Listed by git and deleted since: there is nothing to read.
                  Effect.orElseSucceed(() => null)
                );
              const write = (file: string, text: string) =>
                Effect.orDie(writeAtomic(path.join(paths.root, file), text));
              return { ctx, files, framework, read, write } satisfies Codebase;
            })
          )
          .pipe(
            Effect.mapError((error) =>
              error._tag === "CommandFailed"
                ? new BadRequest({
                    message: `The setup lists the files with git, and git failed: ${error.message}`,
                  })
                : error
            )
          );

      /** Every source file, read and handed to `f`, yielding now and then. */
      const eachSource = <A>(
        code: Codebase,
        f: (file: string, text: string) => A
      ) =>
        Effect.gen(function* () {
          const out: A[] = [];
          for (const [i, file] of code.files.entries()) {
            if (i % FILES_PER_YIELD === 0) {
              yield* Effect.yieldNow;
            }
            const text = yield* code.read(file);
            if (text !== null) {
              out.push(f(file, text));
            }
          }
          return out;
        });

      /** The code read and summed up against the design system the codebase holds. */
      const readCode = Effect.fnUntraced(function* (code: Codebase) {
        const scanned = yield* eachSource(code, (file, text) => ({
          file,
          uses: code.framework.usage.scanFile(file, text),
        }));
        return code.framework.usage.summarise(
          scanned,
          code.ctx,
          yield* Clock.currentTimeMillis
        );
      });

      const stepIn = (setup: DesignSystemSetup, id: SetupStepId): SetupStep =>
        setup.steps.find((s) => s.id === id) ?? { id, status: "todo" };

      const withStep = (
        setup: DesignSystemSetup,
        id: SetupStepId,
        change: (step: SetupStep) => SetupStep
      ): DesignSystemSetup => ({
        ...setup,
        steps: setup.steps.map((s) => (s.id === id ? change(s) : s)),
      });

      /** What a step leaves when it starts: what it found, or the work it hands its agent. */
      const begin = Effect.fnUntraced(function* (
        id: SetupStepId,
        options: { readonly mode?: DefineMode }
      ): Effect.fn.Return<Partial<SetupStep>, SetupFailure> {
        if (id === "inventory") {
          const found = yield* readCode(yield* codebase(false));
          yield* inventoryFile.write(found);
          return {
            finishedAt: found.at,
            status: "review",
            summary: inventorySummary(found),
          };
        }
        if (id === "define") {
          const found = yield* inventoryFile.read;
          return {
            mode: options.mode ?? found?.recommendation.mode ?? "adopt",
          };
        }
        if (id === "map") {
          const code = yield* codebase(true, AUDIT_PER_GROUP);
          const audit = yield* readCode(code);
          yield* auditFile.write(audit);
          const mapping = mappingOf(
            audit,
            code.framework.usage.suggest(audit.values, code.ctx.designSystem),
            audit.at
          );
          yield* saveMapping(mapping);
          const counts = mappingCounts(mapping);
          return {
            summary: `${plural(mapping.entries.length, "value")} off the system; the rules settled ${counts.byRule}.`,
          };
        }
        if (id === "migrate") {
          const mapping = yield* mappingFile.read;
          if (!mapping) {
            return yield* refuse("There is no mapping: Map makes it first.");
          }
          const code = yield* codebase(true);
          const table = mappingTable(mapping);
          const touched = yield* eachSource(code, (file, text) => {
            const out = code.framework.usage.rewrite(
              file,
              text,
              code.ctx,
              table
            );
            const settled =
              out.changes > 0 || out.left.some((l) => l.target !== undefined);
            return settled ? file : null;
          });
          const batches = batchesOf(
            touched.filter((f) => f !== null),
            dirOf
          );
          const files = batches.reduce((sum, b) => sum + b.files.length, 0);
          return batches.length === 0
            ? {
                batches,
                status: "review",
                summary: "Nothing the mapping settles is left in the code.",
              }
            : {
                batches,
                summary: `${plural(batches.length, "batch", "batches")}, ${plural(files, "file")}.`,
              };
        }
        const code = yield* codebase(true, AUDIT_PER_GROUP);
        const audit = yield* readCode(code);
        yield* auditFile.write(audit);
        return {
          finishedAt: audit.at,
          status: "review",
          summary: verifySummary(audit, yield* mappingFile.read),
        };
      });

      const start = Effect.fn("DesignSystemSetupService.start")(function* (
        id: SetupStepId,
        options: { readonly mode?: DefineMode; readonly threadId?: string }
      ) {
        const setup = yield* get;
        const waiting = setup.steps
          .slice(0, indexOf(id))
          .find((s) => s.status !== "done");
        if (waiting) {
          return yield* refuse(
            `${titleOf(waiting.id)} comes first: go on past it before ${titleOf(id)}.`
          );
        }
        if (stepIn(setup, id).status !== "todo") {
          return yield* refuse(
            `${titleOf(id)} has started already: resume it, or redo it to start again.`
          );
        }
        if (setupStepOf(id)?.agent && options.threadId === undefined) {
          return yield* refuse(`${titleOf(id)} runs in a thread.`);
        }
        const before = yield* snapshot;
        const startedAt = yield* Clock.currentTimeMillis;
        const begun = yield* begin(id, options);
        const step: SetupStep = {
          before,
          id,
          startedAt,
          status: "active",
          ...(options.threadId !== undefined && { threadId: options.threadId }),
          ...begun,
        };
        // A step that finished as it started changed nothing: it ends where it began.
        return yield* save(
          withStep(setup, id, () =>
            step.status === "review" ? { ...step, after: before } : step
          )
        );
      }, lock.withPermits(1));

      const stepOf = (threadId: string) =>
        Effect.map(
          get,
          (setup) =>
            setup.steps.find(
              (s) => s.threadId === threadId && s.status !== "todo"
            ) ?? null
        );

      const finish = Effect.fn("DesignSystemSetupService.finish")(function* (
        threadId: string,
        summary: string
      ) {
        const setup = yield* get;
        const step = setup.steps.find((s) => s.threadId === threadId);
        if (!step || step.status === "todo") {
          return yield* refuse(
            "This thread does not run a step of the design-system setup."
          );
        }
        if (step.status === "done") {
          return yield* refuse(
            `The user has gone on past ${titleOf(step.id)} already.`
          );
        }
        const after = yield* snapshot;
        const finishedAt = yield* Clock.currentTimeMillis;
        const next = yield* save(
          withStep(setup, step.id, (s) => ({
            ...s,
            after,
            finishedAt,
            status: "review",
            summary: summary.trim(),
          }))
        );
        return stepIn(next, step.id);
      }, lock.withPermits(1));

      /** A step moved from one of `from` to `to`, its end snapshot taken or dropped. */
      const move = (
        name: string,
        from: readonly SetupStep["status"][],
        to: SetupStep["status"],
        why: (step: SetupStep) => string
      ) =>
        Effect.fn(name)(function* (id: SetupStepId) {
          const setup = yield* get;
          const step = stepIn(setup, id);
          if (!from.includes(step.status)) {
            return yield* refuse(why(step));
          }
          const finishedAt = yield* Clock.currentTimeMillis;
          const after = to === "active" ? undefined : yield* snapshot;
          return yield* save(
            withStep(setup, id, (s) => {
              const { after: _dropped, ...rest } = s;
              return after === undefined
                ? { ...rest, status: to }
                : { ...rest, after, finishedAt, status: to };
            })
          );
        }, lock.withPermits(1));

      const stop = move(
        "DesignSystemSetupService.stop",
        ["active", "review"],
        "stopped",
        (s) => `${titleOf(s.id)} is not under way.`
      );
      const resume = move(
        "DesignSystemSetupService.resume",
        ["stopped", "review"],
        "active",
        (s) =>
          s.status === "active"
            ? `${titleOf(s.id)} is under way already.`
            : `${titleOf(s.id)} cannot be resumed: redo it to start again.`
      );
      const complete = move(
        "DesignSystemSetupService.complete",
        ["active", "review", "stopped"],
        "done",
        (s) =>
          s.status === "done"
            ? `${titleOf(s.id)} is done already.`
            : `${titleOf(s.id)} has not started.`
      );

      /** Lets go of the refs of snapshots nothing keeps; steps and batches often share one. */
      const release = Effect.fnUntraced(function* (
        setup: DesignSystemSetup,
        trees: Iterable<string>
      ) {
        const kept = new Set(setup.steps.flatMap(treesOf));
        for (const tree of new Set(trees)) {
          if (!kept.has(tree)) {
            // A ref already gone is what was wanted.
            yield* git((g) =>
              Effect.ignore(g.deleteRef(`${REF_PREFIX}/${tree}`))
            );
          }
        }
      });

      /**
       * What putting the working tree back to `base` touches: the files the ranges changed, as
       * the working tree has them now.
       */
      const restorePlan = Effect.fnUntraced(function* (
        base: string,
        ranges: readonly { readonly after?: string; readonly before?: string }[]
      ) {
        const now = yield* snapshot;
        const entries = yield* git((g) =>
          Effect.gen(function* () {
            const touched = new Set<string>();
            for (const range of ranges) {
              if (range.before !== undefined) {
                for (const change of yield* g.changedBetween(
                  range.before,
                  range.after ?? now
                )) {
                  touched.add(change.path);
                }
              }
            }
            const changes = yield* g.changedBetween(base, now);
            return changes
              .filter((c) => touched.has(c.path))
              .map(
                (c): RestoreEntry => ({
                  action: c.status === "A" ? "delete" : "restore",
                  path: c.path,
                })
              );
          })
        );
        return { entries, now };
      });

      /** What redoing a step puts back. */
      const restoreOf = Effect.fnUntraced(function* (
        setup: DesignSystemSetup,
        id: SetupStepId
      ) {
        const step = stepIn(setup, id);
        if (step.status === "todo" || step.before === undefined) {
          return yield* refuse(`${titleOf(id)} has not started.`);
        }
        const plan = yield* restorePlan(
          step.before,
          setup.steps.slice(indexOf(id))
        );
        return { ...plan, base: step.before };
      });

      const redoPreview = Effect.fn("DesignSystemSetupService.redoPreview")(
        function* (id: SetupStepId) {
          const setup = yield* get;
          const { entries, now } = yield* restoreOf(setup, id);
          yield* release(setup, [now]);
          return entries;
        },
        lock.withPermits(1)
      );

      const redo = Effect.fn("DesignSystemSetupService.redo")(function* (
        id: SetupStepId
      ) {
        const setup = yield* get;
        const { base, entries, now } = yield* restoreOf(setup, id);
        yield* git((g) => g.restoreFrom(base, entries));
        const from = indexOf(id);
        const next: DesignSystemSetup = {
          ...setup,
          steps: setup.steps.map((s, i) =>
            i >= from ? { id: s.id, status: "todo" as const } : s
          ),
        };
        yield* release(next, [
          now,
          ...setup.steps.slice(from).flatMap(treesOf),
        ]);
        if (from <= indexOf("inventory")) {
          yield* inventoryFile.write(null);
        }
        if (from <= indexOf("map")) {
          yield* auditFile.write(null);
          yield* saveMapping(null);
        }
        return yield* save(next);
      }, lock.withPermits(1));

      const setMapping = Effect.fn("DesignSystemSetupService.setMapping")(
        function* (changes: readonly MappingChange[], by: "agent" | "user") {
          const mapping = yield* mappingFile.read;
          if (!mapping) {
            return yield* refuse("There is no mapping: Map makes it first.");
          }
          const code = yield* codebase(true);
          const result = applyChanges(mapping, changes, by, (kind, target) =>
            targetProblem(
              kind,
              target,
              code.ctx.designSystem,
              code.ctx.components
            )
          );
          if (result.applied > 0) {
            yield* saveMapping(result.mapping);
          }
          return result;
        },
        lock.withPermits(1)
      );

      /** Migrate, as the thread asking for a batch runs it. */
      const migrateOf = Effect.fnUntraced(function* (threadId: string) {
        const setup = yield* get;
        const step = stepIn(setup, "migrate");
        if (step.threadId !== threadId) {
          return yield* refuse(
            "This thread does not run Migrate: the batches are its agent's."
          );
        }
        if (step.status !== "active") {
          return yield* refuse(
            step.status === "stopped"
              ? "Migrate is stopped: the user resumes it from the setup."
              : `Migrate is ${step.status}: there is no batch to work on.`
          );
        }
        return { setup, step };
      });

      /** A batch's files as the rules leave them: rewritten when `write`, else only read. */
      const rewriteBatch = Effect.fnUntraced(function* (
        code: Codebase,
        table: ReadonlyMap<string, string | null>,
        batch: MigrationBatch,
        write: boolean
      ) {
        const files: NextBatch["files"][number][] = [];
        for (const file of batch.files) {
          const text = yield* code.read(file);
          if (text === null) {
            continue;
          }
          const out = code.framework.usage.rewrite(file, text, code.ctx, table);
          if (write && out.changes > 0) {
            yield* code.write(file, out.text);
          }
          files.push({
            changes: write ? out.changes : 0,
            file,
            left: out.left,
          });
        }
        return files;
      });

      const nextBatch = Effect.fn("DesignSystemSetupService.nextBatch")(
        function* (threadId: string) {
          const { setup, step } = yield* migrateOf(threadId);
          const batches = step.batches ?? [];
          const current =
            batches.find((b) => b.status === "active") ??
            batches.find((b) => b.status === "todo");
          if (!current) {
            return null;
          }
          const mapping = yield* mappingFile.read;
          if (!mapping) {
            return yield* refuse("There is no mapping: Map makes it first.");
          }
          const code = yield* codebase(true);
          // A batch under way was rewritten when it was taken; what is left is read again.
          const taking = current.status === "todo";
          const before = taking ? yield* snapshot : current.before;
          const files = yield* rewriteBatch(
            code,
            mappingTable(mapping),
            current,
            taking
          );
          const batch: MigrationBatch = taking
            ? {
                ...current,
                changes: files.reduce((sum, f) => sum + f.changes, 0),
                status: "active",
                ...(before !== undefined && { before }),
              }
            : current;
          yield* save(
            withStep(setup, "migrate", (s) => ({
              ...s,
              batches: batches.map((b) => (b.id === batch.id ? batch : b)),
            }))
          );
          return {
            batch,
            files,
            remaining: batches.filter(
              (b) => b.status === "todo" && b.id !== batch.id
            ).length,
          } satisfies NextBatch;
        },
        lock.withPermits(1)
      );

      const finishBatch = Effect.fn("DesignSystemSetupService.finishBatch")(
        function* (threadId: string, summary: string) {
          const { setup, step } = yield* migrateOf(threadId);
          const batches = step.batches ?? [];
          const current = batches.find((b) => b.status === "active");
          if (!current) {
            return yield* refuse(
              "No batch is under way: next_batch takes the next one."
            );
          }
          const batch: MigrationBatch = {
            ...current,
            after: yield* snapshot,
            status: "done",
            summary: summary.trim(),
          };
          yield* save(
            withStep(setup, "migrate", (s) => ({
              ...s,
              batches: batches.map((b) => (b.id === batch.id ? batch : b)),
            }))
          );
          return {
            batch,
            remaining: batches.filter((b) => b.status === "todo").length,
          };
        },
        lock.withPermits(1)
      );

      /** A batch of Migrate that has started, and the setup it is in. */
      const batchOf = Effect.fnUntraced(function* (batchId: string) {
        const setup = yield* get;
        const batch = stepIn(setup, "migrate").batches?.find(
          (b) => b.id === batchId
        );
        if (!batch) {
          return yield* refuse(`Migrate has no batch ${batchId}.`);
        }
        if (batch.status === "todo" || batch.before === undefined) {
          return yield* refuse(`${batch.dir} has not been migrated yet.`);
        }
        return { base: batch.before, batch, setup };
      });

      const batchPreview = Effect.fn("DesignSystemSetupService.batchPreview")(
        function* (batchId: string) {
          const { base, batch, setup } = yield* batchOf(batchId);
          const { entries, now } = yield* restorePlan(base, [batch]);
          yield* release(setup, [now]);
          return entries;
        },
        lock.withPermits(1)
      );

      const revertBatch = Effect.fn("DesignSystemSetupService.revertBatch")(
        function* (batchId: string) {
          const { base, batch, setup } = yield* batchOf(batchId);
          const { entries, now } = yield* restorePlan(base, [batch]);
          yield* git((g) => g.restoreFrom(base, entries));
          const reset: MigrationBatch = {
            dir: batch.dir,
            files: batch.files,
            id: batch.id,
            status: "todo",
          };
          const next = withStep(setup, "migrate", (s) => ({
            ...s,
            batches: (s.batches ?? []).map((b) =>
              b.id === batch.id ? reset : b
            ),
          }));
          yield* release(next, [
            now,
            base,
            ...(batch.after ? [batch.after] : []),
          ]);
          return yield* save(next);
        },
        lock.withPermits(1)
      );

      return DesignSystemSetupService.of({
        audit: auditFile.read,
        batchPreview,
        complete,
        finish,
        finishBatch,
        get,
        inventory: inventoryFile.read,
        mapping: mappingFile.read,
        nextBatch,
        redo,
        redoPreview,
        resume,
        revertBatch,
        setMapping,
        start,
        stepOf,
        stop,
      });
    })
  );
}
