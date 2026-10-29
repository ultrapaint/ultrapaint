/**
 * The project's components (ADR 0041): `components/<Name>.component.json` in the designs
 * directory, one file per component. A system component's file is its look as the design says it
 * (ADR 0040); one without a file is drawn in its default look (`defaults.ts`), taking its look
 * over starts the file from that default, and removing the file goes back to it. An app
 * component's file is its tree, its properties and its slots, made from nodes of a page or written
 * by an agent. Every file is read and validated by the `component-files` codec, whoever writes it,
 * and an app component's properties and slots are changed on its file as it is now (`change`),
 * its instances following a rename in the same undo step.
 */

import type { Catalogue } from "@ultrapaint/contracts/catalogue";
import {
  APP_FROM,
  type AppComponentFile,
  appComponentsIn,
  COMPONENT_EXTENSION,
  COMPONENTS_DIR,
  type ComponentChange,
  type ComponentEntry,
  type ComponentFile,
  type ComponentList,
  type ComponentNote,
  componentDocOf,
  componentFileOf,
  ROOT_SLOT,
} from "@ultrapaint/contracts/components";
import type {
  DesignNode,
  DocumentEdit,
  InstanceNode,
} from "@ultrapaint/contracts/document";
import {
  BadRequest,
  type Conflict,
  NotFound,
} from "@ultrapaint/contracts/errors";
import { serialise } from "@ultrapaint/design-document/factories";
import { childrenOf, findPath, idsOf } from "@ultrapaint/design-document/tree";
import {
  catalogueOf,
  systemComponentOf,
} from "@ultrapaint/system-components/catalogue";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { Context, Effect, FileSystem, Layer, Path, Stream } from "effect";
import { EventBus } from "../events.ts";
import { makeId } from "../ids.ts";
import {
  changedComponent,
  componentOf,
  componentText,
  instanceOps,
  problemOf,
  readComponentFile,
} from "./component-files.ts";
import { DocumentService } from "./documents.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";

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
    const readEntry = (name: string) => {
      const file = `${COMPONENTS_DIR}/${name}`;
      return fs.readFileString(path.join(dir, name)).pipe(
        Effect.map(
          (text): ComponentEntry => ({ file, ...readComponentFile(text, file) })
        ),
        Effect.catch((error) =>
          Effect.succeed<ComponentEntry>({ file, problem: error.message })
        )
      );
    };
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

export class ComponentService extends Context.Service<
  ComponentService,
  {
    readonly list: Effect.Effect<ComponentList>;
    /** The components that read: what the preview and the briefing use. */
    readonly components: Effect.Effect<readonly ComponentFile[]>;
    /** What a design can place, system and app (ADR 0042): what the agents are told of. */
    readonly catalogue: Effect.Effect<Catalogue>;
    readonly write: (
      component: unknown
    ) => Effect.Effect<ComponentEntry, EditFailure>;
    /**
     * A change to an app component's properties or slots, made on its file as it is now; a
     * property or a member renamed or taken out follows into the variants its tree keeps and every
     * instance's props, in every document. One undo step.
     */
    readonly change: (
      name: string,
      change: ComponentChange
    ) => Effect.Effect<ComponentEntry, EditFailure | Conflict>;
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
      const catalogue = Effect.map(components, catalogueOf);

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
          tx.write(repoOf(file), componentText(component))
        );
        yield* publish;
        return { component, file } satisfies ComponentEntry;
      });

      /**
       * The documents' operations that bring the instances of `name` along with a change: every
       * page and canvas, and every other app component's tree.
       */
      const instanceEdits = Effect.fnUntraced(function* (
        name: string,
        made: ComponentChange
      ) {
        const trees = [
          ...(yield* documents.all),
          ...(yield* Effect.forEach(
            appComponentsIn(yield* components).filter((c) => c.name !== name),
            (c) => documents.get(componentDocOf(c.name))
          )),
        ];
        return trees.flatMap((state): DocumentEdit[] => {
          const ops = state.root ? instanceOps(state.root, name, made) : [];
          return ops.length > 0 ? [{ doc: state.doc, ops }] : [];
        });
      });

      /** An app component's file as it is on disk now. */
      const appFileNow = Effect.fnUntraced(function* (name: string) {
        const file = componentFileOf(name);
        const text = yield* fs
          .readFileString(path.join(paths.designsDir, file))
          .pipe(Effect.orElseSucceed(() => null));
        const read = text === null ? null : readComponentFile(text, file);
        if (!(read && "component" in read)) {
          return yield* new NotFound({
            message: `no app component ${name}${read ? `: ${read.problem}` : ""}`,
          });
        }
        if (read.component.origin !== "app") {
          return yield* new BadRequest({
            message: `${name} is a system component's look: it has no properties or slots`,
          });
        }
        return read.component;
      });

      const change = Effect.fn("ComponentService.change")(function* (
        name: string,
        made: ComponentChange
      ) {
        const file = componentFileOf(name);
        const edits = yield* instanceEdits(name, made);
        let saved: AppComponentFile | undefined;
        // Made on the file as it is under the journal: a change made since the editor read it stays.
        yield* documents.apply(
          { edits, label: `Change the ${name} component` },
          (tx) =>
            Effect.gen(function* () {
              const next = changedComponent(yield* appFileNow(name), made);
              if ("problem" in next) {
                return yield* new BadRequest({ message: next.problem });
              }
              yield* checked(next);
              yield* tx.write(repoOf(file), componentText(next));
              saved = next;
            })
        );
        yield* publish;
        return {
          ...(saved && { component: saved }),
          file,
        } satisfies ComponentEntry;
      });

      const write = Effect.fn("ComponentService.write")(function* (
        input: unknown
      ) {
        const read = componentOf(input);
        if ("problem" in read) {
          return yield* new BadRequest({
            message: `the component is not valid: ${read.problem}`,
          });
        }
        const { component } = read;
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
        catalogue,
        change,
        components,
        fromDefault,
        list,
        makeApp,
        remove,
        write,
      });
    })
  );
}
