/**
 * The project's components (ADR 0041): `components/<Name>.component.json` in the designs
 * directory, one file per component. A system component's file is its look as the design says it
 * (ADR 0040); one without a file is drawn in its default look (`defaults.ts`), taking its look
 * over starts the file from that default, and removing the file goes back to it. An app
 * component's file is its tree, its properties and its slots, made from nodes of a page or written
 * by an agent. Every file is validated whoever writes it: an app component takes no system
 * component's name, names nodes its tree has, and places no app component that places it.
 *
 * Migrating brings what came before into this: instances of system components and drafts as
 * they were named, specs' files, their implementations' snapshots and targets, in one undo step.
 */

import {
  APP_FROM,
  type AppComponentFile,
  COMPONENT_EXTENSION,
  COMPONENTS_DIR,
  type ComponentEntry,
  ComponentFile,
  type ComponentList,
  type ComponentNote,
  componentFileOf,
  LEGACY_SPEC_EXTENSION,
  LEGACY_SPECS_DIR,
  LegacyComponentSpec,
  ROOT_SLOT,
  type SystemComponentFile,
} from "@ultrapaint/contracts/components";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import {
  BadRequest,
  type Conflict,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  COMPONENT_TARGET_PREFIX,
  IMPLEMENTATION_FILE,
  IMPLEMENTED_COMPONENTS,
  IMPLEMENTED_DIR,
  ImplementationFile,
  LEGACY_IMPLEMENTED_SPECS,
  LEGACY_SPEC_TARGET_PREFIX,
} from "@ultrapaint/contracts/implementation";
import { appComponentCycle } from "@ultrapaint/design-document/app-components";
import { serialise } from "@ultrapaint/design-document/factories";
import {
  childrenOf,
  findNode,
  findPath,
  idsOf,
} from "@ultrapaint/design-document/tree";
import {
  type SystemComponentMeta,
  systemComponentOf,
} from "@ultrapaint/system-components/catalogue";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { componentOfSpec } from "@ultrapaint/system-components/migrate";
import {
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
import { makeId } from "../ids.ts";
import { DocumentService } from "./documents.ts";
import { type EditFailure, EditService, type EditTransaction } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";

const decodeComponent = Schema.decodeUnknownEffect(ComponentFile);
const decodeSpec = Schema.decodeUnknownEffect(LegacyComponentSpec);
const decodeImplementation = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ImplementationFile)
);

const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const SPACED_WORD_RE = /\s+(\w)/g;
/** The fields an app component's instance takes over from the node it replaces: where it sits. */
const PLACEMENT_FIELDS = [
  "height",
  "hidden",
  "link",
  "locked",
  "margin",
  "maxHeight",
  "maxWidth",
  "minHeight",
  "minWidth",
  "slot",
  "width",
  "x",
  "y",
] as const;

/** What is wrong with an app component's tree, its slots and its properties, or nothing. */
const appProblemOf = (component: AppComponentFile): string | undefined => {
  const ids = idsOf(component.tree);
  for (const slot of component.slots) {
    const node = findNode(component.tree, slot.node);
    if (!node) {
      return `the slot ${slot.name} is node ${slot.node}, which the tree does not have`;
    }
    if (!("children" in node)) {
      return `the slot ${slot.name} is node ${slot.node}, which holds no nodes`;
    }
  }
  if (component.slots.filter((s) => s.default).length > 1) {
    return "only one slot is the default";
  }
  for (const property of component.properties) {
    const missing = (property.targets ?? []).find((t) => !ids.has(t.node));
    if (missing) {
      return `the property ${property.name} sets node ${missing.node}, which the tree does not have`;
    }
    const members = property.members ?? [];
    if (
      property.kind === "choice" &&
      !(
        typeof property.default === "string" &&
        members.includes(property.default)
      )
    ) {
      return `the choice ${property.name} starts in a member it has: ${members.join(", ") || "it has none"}`;
    }
  }
  return undefined;
};

/**
 * What is wrong with a system component's look against its catalogue entry, or nothing: it leaves
 * out only optional parts, gives content only to slots, and a template only to a Select's or a
 * Menu's items.
 */
const systemProblemOf = (
  component: SystemComponentFile,
  meta: SystemComponentMeta
): string | undefined => {
  const parts = new Map(meta.slots.map((s) => [s.name, s]));
  const fixed = (component.hidden ?? []).find((p) => !parts.get(p)?.optional);
  if (fixed !== undefined) {
    const optional = meta.slots.filter((s) => s.optional).map((s) => s.name);
    return `${component.name} cannot leave out ${fixed}: ${optional.length > 0 ? `its optional parts are ${optional.join(", ")}` : "it has no optional part"}`;
  }
  const notSlot = Object.keys(component.content ?? {}).find(
    (slot) => parts.get(slot)?.holds === undefined
  );
  if (notSlot !== undefined) {
    return `${component.name} has no slot ${notSlot} to give content: its slots are ${meta.slots.flatMap((s) => (s.holds ? [s.name] : [])).join(", ") || "none"}`;
  }
  const { item } = component;
  if (item && !meta.templatedItems) {
    return `${component.name} has no items to draw with a template: a Select's and a Menu's have`;
  }
  const ids = item ? idsOf(item.tree) : new Set<string>();
  const unbound = [item?.label, item?.image].find(
    (id) => id !== undefined && !ids.has(id)
  );
  return unbound === undefined
    ? undefined
    : `the item template shows the item in node ${unbound}, which its tree does not have`;
};

/** What is wrong with a component's file among the others, or nothing. */
export const problemOf = (
  component: ComponentFile,
  others: readonly ComponentFile[]
): string | undefined => {
  if (!COMPONENT_NAME_RE.test(component.name)) {
    return `a component is named in PascalCase, letters and digits: ${component.name}`;
  }
  const system = systemComponentOf(component.name);
  if (component.origin === "system") {
    return system
      ? systemProblemOf(component, system)
      : `${component.name} is no system component: an app component's file says origin "app"`;
  }
  if (system) {
    return `${component.name} is a system component's name: an app component takes another`;
  }
  const own = appProblemOf(component);
  if (own) {
    return own;
  }
  const apps = [
    ...others.filter(
      (c): c is AppComponentFile =>
        c.origin === "app" && c.name !== component.name
    ),
    component,
  ];
  const cycle = appComponentCycle(apps);
  return cycle?.includes(component.name)
    ? `${cycle.join(" places ")}: a component cannot place itself`
    : undefined;
};

/** The name a new app component takes from what was typed (`Hero title` is `HeroTitle`), or what is wrong with it. */
const appNameOf = (
  given: string,
  taken: readonly ComponentFile[]
): { readonly name: string } | { readonly problem: string } => {
  const name = given
    .trim()
    .replace(SPACED_WORD_RE, (_, c: string) => c.toUpperCase());
  if (!COMPONENT_NAME_RE.test(name)) {
    return {
      problem: `a component is named in PascalCase, letters and digits: ${given}`,
    };
  }
  if (systemComponentOf(name)) {
    return {
      problem: `${name} is a system component's name: an app component takes another`,
    };
  }
  return taken.some((c) => c.name === name)
    ? { problem: `there is a ${name} component already` }
    : { name };
};

/**
 * The nodes named, siblings, with their container and where the first of them is; null when the
 * first is not inside a container of the tree.
 */
const siblingsOf = (
  root: DesignNode,
  nodeIds: readonly string[]
):
  | {
      readonly index: number;
      readonly nodes: readonly DesignNode[];
      readonly parent: DesignNode;
    }
  | { readonly problem: string }
  | null => {
  const [first] = nodeIds;
  const parent =
    first === undefined || first === root.id
      ? undefined
      : findPath(root, first)?.at(-2);
  if (!parent) {
    return null;
  }
  const siblings = childrenOf(parent);
  const nodes = siblings.filter((c) => nodeIds.includes(c.id));
  if (nodes.length !== nodeIds.length) {
    return {
      problem: "the nodes of a component are siblings, in one container",
    };
  }
  const index = siblings.findIndex((c) => c.id === nodes[0]?.id);
  return { index, nodes, parent };
};

/** Where a node sits, which an instance that takes its place keeps. */
const placementOf = (node: DesignNode): Record<string, unknown> =>
  Object.fromEntries(
    PLACEMENT_FIELDS.flatMap((field) => {
      const value = (node as unknown as Record<string, unknown>)[field];
      return value === undefined ? [] : [[field, value] as const];
    })
  );

/** A node without where it sits: what an app component's tree keeps of it. */
const unplaced = (node: DesignNode): DesignNode =>
  Object.fromEntries(
    Object.entries(node).filter(
      ([key]) =>
        !(PLACEMENT_FIELDS as readonly string[]).includes(key) && key !== "name"
    )
  ) as unknown as DesignNode;

/**
 * The components in a designs directory, each read and validated, or the problem with it: the
 * one reading of the files, which the link to the code (ADR 0030) and DESIGN.md share with the
 * service.
 */
export const readComponents = (designsDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(designsDir, COMPONENTS_DIR);
    const readEntry = (name: string) =>
      Effect.gen(function* () {
        const file = `${COMPONENTS_DIR}/${name}`;
        const text = yield* fs.readFileString(path.join(dir, name));
        const json = yield* Effect.try({
          catch: (error) => `not JSON: ${String(error)}`,
          try: () => JSON.parse(text) as unknown,
        });
        const component = yield* decodeComponent(json).pipe(
          Effect.mapError((error) => error.message)
        );
        if (`${component.name}${COMPONENT_EXTENSION}` !== name) {
          return {
            file,
            problem: `the file of ${component.name} is ${componentFileOf(component.name)}`,
          } satisfies ComponentEntry;
        }
        return { component, file } satisfies ComponentEntry;
      }).pipe(
        Effect.catch((problem) =>
          Effect.succeed({
            file: `${COMPONENTS_DIR}/${name}`,
            problem: typeof problem === "string" ? problem : problem.message,
          } satisfies ComponentEntry)
        )
      );
    const names = yield* fs.readDirectory(dir).pipe(
      // No components yet: the directory comes with the first.
      Effect.orElseSucceed((): string[] => [])
    );
    const read: readonly ComponentEntry[] = yield* Effect.forEach(
      names.filter((n) => n.endsWith(COMPONENT_EXTENSION)).sort(),
      readEntry
    );
    const valid = read.flatMap((e) => (e.component ? [e.component] : []));
    // A file that reads can still be wrong among the others: a name, a slot, a cycle.
    const entries = read.map((entry): ComponentEntry => {
      const problem = entry.component && problemOf(entry.component, valid);
      return problem ? { file: entry.file, problem } : entry;
    });
    return { components: entries } satisfies ComponentList;
  });

/** The components of a list that read. */
export const componentsIn = (list: ComponentList): ComponentFile[] =>
  list.components.flatMap((e) => (e.component ? [e.component] : []));

/** What is left from before ADR 0041 to migrate. */
export interface Legacy {
  /** Instances drawn as now once migrated. */
  readonly drawn: number;
  /** Instances of the repository's components no system component is like. */
  readonly left: number;
  /** Specs' files, each a component's once migrated. */
  readonly specs: number;
}

export class ComponentService extends Context.Service<
  ComponentService,
  {
    readonly list: Effect.Effect<ComponentList>;
    /** The components that read: what the preview and the briefing use. */
    readonly components: Effect.Effect<readonly ComponentFile[]>;
    readonly write: (
      component: unknown
    ) => Effect.Effect<ComponentEntry, EditFailure>;
    /**
     * A system component's file started from its default look (ADR 0040), so the design edits
     * real values. One there was keeps its behaviour notes, which are not the look.
     */
    readonly fromDefault: (
      name: string
    ) => Effect.Effect<ComponentEntry, EditFailure | NotFound>;
    /** Removes a component's file: a system component is drawn in its default look again. */
    readonly remove: (
      name: string
    ) => Effect.Effect<void, EditFailure | NotFound>;
    /**
     * A behaviour note added to a component (ADR 0030), about a part of it or the whole: what
     * its code must do that the design cannot show. One undo step.
     */
    readonly addNote: (
      name: string,
      text: string,
      slot?: string
    ) => Effect.Effect<ComponentNote, EditFailure | NotFound>;
    /**
     * Nodes of a page, siblings, made an app component: they are its tree (several in a row or a
     * column, as their container lays them out), and an instance of it takes their place, where
     * the first of them was. One undo step.
     */
    readonly makeApp: (
      page: string,
      nodeIds: readonly string[],
      name: string
    ) => Effect.Effect<ComponentEntry, EditFailure | NotFound | Conflict>;
    /** What is left from before ADR 0041 to migrate. */
    readonly legacy: Effect.Effect<Legacy, EditFailure>;
    /**
     * Everything from before brought up to date, in one undo step: the instances (`migrate.ts`),
     * each spec's file as a component's, their implementations' snapshots and targets. Answers
     * with how many instances, in how many documents, and how many components.
     */
    readonly migrate: Effect.Effect<
      {
        readonly components: number;
        readonly documents: number;
        readonly drawn: number;
      },
      EditFailure | Conflict
    >;
  }
>()("ultrapaint/server/ComponentService") {
  static readonly layer = Layer.effect(
    ComponentService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const documents = yield* DocumentService;
      const dir = path.join(paths.designsDir, COMPONENTS_DIR);
      /** A path inside the designs directory as the repository has it. */
      const repoOf = (designs: string) =>
        paths.relative(path.join(paths.designsDir, designs));

      const list: Effect.Effect<ComponentList> = readComponents(
        paths.designsDir
      ).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.withSpan("ComponentService.list")
      );

      const components = Effect.map(list, componentsIn);

      const publish = Effect.flatMap(list, (l) =>
        events.publish("components", l)
      );

      /** A component checked among the others; what is wrong with it is refused. */
      const checked = Effect.fnUntraced(function* (component: ComponentFile) {
        const problem = problemOf(component, yield* components);
        if (problem) {
          return yield* new BadRequest({ message: problem });
        }
        return component;
      });

      const save = Effect.fnUntraced(function* (
        component: ComponentFile,
        label: string
      ) {
        const file = componentFileOf(component.name);
        yield* edit.transaction(label, (tx) =>
          tx.write(repoOf(file), serialise(component))
        );
        yield* publish;
        return { component, file } satisfies ComponentEntry;
      });

      const write = Effect.fn("ComponentService.write")(function* (
        input: unknown
      ) {
        const component = yield* decodeComponent(input).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the component is not valid: ${error.message}`,
              })
          )
        );
        return yield* save(
          yield* checked(component),
          `Change the ${component.name} component`
        );
      });

      const fromDefault = Effect.fn("ComponentService.fromDefault")(function* (
        name: string
      ) {
        const start = defaultLookOf(name);
        if (!start) {
          return yield* new NotFound({
            message: `${name} is no system component: only a system component has a default look to start from`,
          });
        }
        // Started again, a file keeps its behaviour notes: they are not the look.
        const notes = (yield* components).find((c) => c.name === name)?.notes;
        return yield* save(
          { ...start, ...(notes && notes.length > 0 && { notes }) },
          `Take ${name}'s look over`
        );
      });

      const remove = Effect.fn("ComponentService.remove")(function* (
        name: string
      ) {
        const file = componentFileOf(name);
        const exists = yield* fs
          .exists(path.join(paths.designsDir, file))
          .pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          return yield* new NotFound({ message: `no component ${name}` });
        }
        yield* edit.transaction(`Delete the ${name} component`, (tx) =>
          tx.remove(repoOf(file))
        );
        yield* publish;
      });

      /** The parts a note can be about: a system component's, an app component's slots and nodes. */
      const partsOf = (component: ComponentFile): string[] =>
        component.origin === "system"
          ? (systemComponentOf(component.name)?.slots ?? []).map((s) => s.name)
          : [...component.slots.map((s) => s.name), ...idsOf(component.tree)];

      const addNote = Effect.fn("ComponentService.addNote")(function* (
        name: string,
        text: string,
        slot?: string
      ) {
        const component = (yield* components).find((c) => c.name === name);
        if (!component) {
          return yield* new NotFound({
            message: systemComponentOf(name)
              ? `${name} has no file: take its look over first`
              : `no component ${name}`,
          });
        }
        if (text.trim() === "") {
          return yield* new BadRequest({
            message: "say what the component must do",
          });
        }
        const parts = partsOf(component);
        if (slot !== undefined && !parts.includes(slot)) {
          return yield* new NotFound({
            message: `${name} has no part ${slot}; its parts are ${parts.join(", ")}`,
          });
        }
        const note: ComponentNote = {
          id: yield* makeId("note"),
          ...(slot !== undefined && slot !== ROOT_SLOT && { slot }),
          text: text.trim(),
        };
        yield* save(
          { ...component, notes: [...(component.notes ?? []), note] },
          `Note how ${name} behaves`
        );
        return note;
      });

      const makeApp = Effect.fn("ComponentService.makeApp")(function* (
        page: string,
        nodeIds: readonly string[],
        given: string
      ) {
        const named = appNameOf(given, yield* components);
        if ("problem" in named) {
          return yield* new BadRequest({ message: named.problem });
        }
        const { name } = named;
        const { root } = yield* documents.get(page);
        const found = root ? siblingsOf(root, nodeIds) : null;
        if (!found) {
          return yield* new NotFound({
            message: `no node ${nodeIds[0]} inside a container of ${page} to make a component of`,
          });
        }
        if ("problem" in found) {
          return yield* new BadRequest({ message: found.problem });
        }
        const { index, nodes, parent } = found;
        const only = nodes.length === 1 ? nodes[0] : undefined;
        const placement = only ? placementOf(only) : {};
        const tree: DesignNode = only
          ? unplaced(only)
          : ({
              children: nodes.map(
                ({ slot: _slot, ...node }) => node as DesignNode
              ),
              gap: 8,
              id: yield* makeId("c"),
              type: parent.type === "row" ? "row" : "column",
            } as DesignNode);
        const instance: InstanceNode = {
          ...placement,
          component: name,
          from: APP_FROM,
          id: only?.id ?? (yield* makeId("c")),
          type: "instance",
        };
        const component: AppComponentFile = {
          name,
          origin: "app",
          properties: [],
          slots: [],
          tree,
          version: 1,
        };
        const file = componentFileOf(name);
        yield* documents.apply(
          {
            edits: [
              {
                doc: page,
                ops: [
                  ...nodes.map((n) => ({ id: n.id, op: "remove" as const })),
                  {
                    index,
                    node: instance,
                    op: "insert",
                    parent: parent.id,
                  },
                ],
              },
            ],
            label: `Make ${name} an app component`,
          },
          (tx) => tx.write(repoOf(file), serialise(component))
        );
        yield* publish;
        return { component, file } satisfies ComponentEntry;
      });

      /** The specs' files from before, each read, or left out when it does not read. */
      const legacySpecs = Effect.gen(function* () {
        const specsDir = path.join(paths.designsDir, LEGACY_SPECS_DIR);
        const names = yield* fs
          .readDirectory(specsDir)
          .pipe(Effect.orElseSucceed((): string[] => []));
        return yield* Effect.forEach(
          names.filter((n) => n.endsWith(LEGACY_SPEC_EXTENSION)).sort(),
          (name) =>
            fs.readFileString(path.join(specsDir, name)).pipe(
              Effect.flatMap((text) =>
                Effect.try({
                  catch: (error) => String(error),
                  try: () => JSON.parse(text) as unknown,
                })
              ),
              Effect.flatMap((raw) =>
                Effect.map(decodeSpec(raw), (spec) => ({
                  file: name,
                  raw,
                  spec,
                }))
              ),
              Effect.option
            )
        ).pipe(
          Effect.map((read) =>
            read.flatMap((o) => (o._tag === "Some" ? [o.value] : []))
          )
        );
      });

      const legacy = Effect.gen(function* () {
        const old = yield* documents.oldInstances;
        const specs = yield* legacySpecs;
        return { ...old, specs: specs.length };
      }).pipe(Effect.withSpan("ComponentService.legacy"));

      /**
       * The specs' files moved to components', their implementations' snapshots with them and
       * `implementation.json`'s targets renamed, each binding's design hash that of the component.
       */
      const migrateFiles = (
        tx: EditTransaction,
        specs: readonly {
          readonly file: string;
          readonly raw: unknown;
          readonly spec: LegacyComponentSpec;
        }[]
      ) =>
        Effect.gen(function* () {
          /** By component: its hash now, and what its spec hashed to, as a binding has it. */
          const now = new Map<string, { hash: string; was: string }>();
          /** By component: the hash of its design as it was implemented, from its snapshot. */
          const implementedHash = new Map<string, string>();
          for (const { file, raw, spec } of specs) {
            const component = componentOfSpec(spec);
            yield* tx.remove(repoOf(`${LEGACY_SPECS_DIR}/${file}`));
            if (component) {
              now.set(spec.component, {
                hash: componentHash(component),
                was: hashContent(stableJson(raw)),
              });
              yield* tx.write(
                repoOf(componentFileOf(component.name)),
                serialise(component)
              );
            }
          }
          const implementedDir = `${IMPLEMENTED_DIR}/${LEGACY_IMPLEMENTED_SPECS}`;
          const snapshots = yield* fs
            .readDirectory(path.join(paths.designsDir, implementedDir))
            .pipe(Effect.orElseSucceed((): string[] => []));
          for (const name of snapshots) {
            const rel = repoOf(`${implementedDir}/${name}`);
            const text = yield* fs
              .readFileString(path.join(paths.designsDir, implementedDir, name))
              .pipe(Effect.orElseSucceed(() => ""));
            const snapshot = yield* Effect.try(
              () => JSON.parse(text) as { kind?: unknown; spec?: unknown }
            ).pipe(
              Effect.flatMap((json) => decodeSpec(json.spec)),
              Effect.map(componentOfSpec),
              Effect.orElseSucceed(() => null)
            );
            yield* tx.remove(rel);
            if (snapshot) {
              implementedHash.set(snapshot.name, componentHash(snapshot));
              yield* tx.write(
                repoOf(`${IMPLEMENTED_DIR}/${IMPLEMENTED_COMPONENTS}/${name}`),
                serialise({ component: snapshot, kind: "component" })
              );
            }
          }
          const implementation = yield* fs
            .readFileString(path.join(paths.designsDir, IMPLEMENTATION_FILE))
            .pipe(
              Effect.flatMap(decodeImplementation),
              Effect.orElseSucceed(() => null)
            );
          if (
            implementation &&
            Object.keys(implementation.items).some((k) =>
              k.startsWith(LEGACY_SPEC_TARGET_PREFIX)
            )
          ) {
            const items = Object.fromEntries(
              Object.entries(implementation.items)
                .map(([target, entry]) => {
                  if (!target.startsWith(LEGACY_SPEC_TARGET_PREFIX)) {
                    return [target, entry] as const;
                  }
                  const name = target.slice(LEGACY_SPEC_TARGET_PREFIX.length);
                  // The design as implemented, as a component; or, without its snapshot, the
                  // component now when the spec had not changed since.
                  const component = now.get(name);
                  const hash =
                    implementedHash.get(name) ??
                    (component && entry.implemented?.design === component.was
                      ? component.hash
                      : undefined);
                  return [
                    `${COMPONENT_TARGET_PREFIX}${name}`,
                    entry.implemented && hash
                      ? {
                          ...entry,
                          implemented: { ...entry.implemented, design: hash },
                        }
                      : entry,
                  ] as const;
                })
                .sort(([a], [b]) => a.localeCompare(b))
            );
            yield* tx.write(
              repoOf(IMPLEMENTATION_FILE),
              serialise({ ...implementation, items })
            );
          }
        });

      const migrate = Effect.gen(function* () {
        const { drawn, edits } = yield* documents.migrationEdits;
        const specs = yield* legacySpecs;
        const made = specs.filter(({ spec }) => componentOfSpec(spec)).length;
        if (edits.length === 0 && specs.length === 0) {
          return { components: 0, documents: 0, drawn: 0 };
        }
        yield* documents.apply(
          { edits, label: "Bring the designs up to date" },
          (tx) => migrateFiles(tx, specs)
        );
        yield* publish;
        return { components: made, documents: edits.length, drawn };
      }).pipe(Effect.withSpan("ComponentService.migrate"));

      // Whoever changes the files — an undo, an agent, a checkout — the editor hears of it.
      const prefix = `${paths.relative(dir)}/`;
      yield* events.subscribe("file.changed").pipe(
        Stream.filter(
          ({ file }) =>
            file.startsWith(prefix) && file.endsWith(COMPONENT_EXTENSION)
        ),
        Stream.debounce("50 millis"),
        Stream.runForEach(() => publish),
        Effect.forkScoped
      );

      return ComponentService.of({
        addNote,
        components,
        fromDefault,
        legacy,
        list,
        makeApp,
        migrate,
        remove,
        write,
      });
    })
  );
}
