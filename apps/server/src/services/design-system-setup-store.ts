/**
 * Where the design-system setup keeps its state: `state.json` with where each step is, and the
 * inventory, the audit and the mapping beside it, in the open project's own directory of the
 * server's state. And the pure helpers every part of the setup reads and changes a step with.
 */
import {
  DesignSystemSetup,
  emptySetup,
  SETUP_STEPS,
  type SetupStep,
  type SetupStepId,
  UsageInventory,
  UsageMapping,
} from "@ultrapaint/contracts/design-system-setup";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { Clock, Effect, FileSystem, Path, Predicate, Schema } from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { EventBus } from "../events.ts";
import { hashContent } from "../hash.ts";
import { OpenProject } from "../project.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Storage } from "./storage.ts";

const SetupJson = Schema.fromJsonString(DesignSystemSetup);
const decodeSetup = Schema.decodeUnknownEffect(SetupJson);
const encodeSetup = Schema.encodeEffect(SetupJson);

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

/**
 * A file's JSON without the plain elements an older inventory or mapping listed: the setup no
 * longer reads them (the editor's components are not the repository's library), and the rest of
 * what was found and decided still reads.
 */
const withoutElements = (json: unknown): unknown => {
  if (!Predicate.isObject(json) || Array.isArray(json)) {
    return json;
  }
  const kept = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((e) => !(Predicate.isObject(e) && e.kind === "element"))
      : list;
  const record = json as Record<string, unknown>;
  return {
    ...record,
    ...("values" in record && { values: kept(record.values) }),
    ...("totals" in record && { totals: kept(record.totals) }),
    ...("entries" in record && { entries: kept(record.entries) }),
  };
};

export const refuse = (message: string) =>
  Effect.fail(new BadRequest({ message }));

export const stepIn = (setup: DesignSystemSetup, id: SetupStepId): SetupStep =>
  setup.steps.find((s) => s.id === id) ?? { id, status: "todo" };

export const withStep = (
  setup: DesignSystemSetup,
  id: SetupStepId,
  change: (step: SetupStep) => SetupStep
): DesignSystemSetup => ({
  ...setup,
  steps: setup.steps.map((s) => (s.id === id ? change(s) : s)),
});

export const makeSetupStore = Effect.gen(function* () {
  const project = yield* OpenProject;
  const storage = yield* Storage;
  const events = yield* EventBus;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const writeAtomic = makeWriteAtomic(fs, path);

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
  const stored = <A, I>(
    name: string,
    schema: Schema.Codec<A, I, never, never>
  ) => {
    const json = Schema.fromJsonString(schema);
    const decode = (text: string) =>
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text),
        (found) => Schema.decodeUnknownEffect(schema)(withoutElements(found))
      );
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
          // A file already gone is what was wanted.
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

  return { auditFile, get, inventoryFile, mappingFile, save, saveMapping };
});
