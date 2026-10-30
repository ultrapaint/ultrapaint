/**
 * The project's components (ADR 0041): `components/<Name>.component.json` in the designs
 * directory, one file per component. A system component's file is its look as the design says it
 * (ADR 0040); one without a file is drawn in its default look (`defaults.ts`), taking its look
 * over starts the file from that default, and removing the file goes back to it. An app
 * component's file is its tree, its properties and its slots, made from nodes of a page or written
 * by an agent, or started empty from the Library (`create`). Every file is read and validated by
 * the `component-files` codec, whoever writes it, and every write reads the file as it is inside
 * its undo step: what the editor changes of a file (one thing of a look, properties and slots,
 * notes) is changed on it as it is now (`change`), an app component's instances following a
 * rename in the same undo step.
 */

import type { Catalogue } from "@ultrapaint/contracts/catalogue";
import {
  appComponentsIn,
  COMPONENT_EXTENSION,
  COMPONENTS_DIR,
  type ComponentChange,
  type ComponentEntry,
  type ComponentFile,
  type ComponentList,
  componentDocOf,
  componentFileOf,
  ROOT_SLOT,
} from "@ultrapaint/contracts/components";
import type { DesignNode, DocumentEdit } from "@ultrapaint/contracts/document";
import {
  BadRequest,
  type Conflict,
  NotFound,
} from "@ultrapaint/contracts/errors";
import { appComponentFrom } from "@ultrapaint/design-document/app-components";
import { newElement } from "@ultrapaint/design-document/factories";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { placeLabel } from "@ultrapaint/design-document/look-places";
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
  appComponentName,
  type ComponentRead,
  changedComponent,
  componentText,
  instanceOps,
  problemOf,
  readComponentFile,
} from "./component-files.ts";
import { type ApplyStep, DocumentService } from "./documents.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";

/** The undo step a change is named by: a look's part at its place, else the component. */
const labelOf = (name: string, made: ComponentChange) => {
  switch (made.op) {
    case "setStyle":
      return `Change ${name}'s ${made.slot === ROOT_SLOT ? "look" : made.slot} at ${placeLabel(made.place)}`;
    case "setHidden":
    case "setContent":
    case "setItem":
      return `Change ${name}'s look`;
    case "addNote":
      return `Note how ${name} behaves`;
    default:
      return `Change the ${name} component`;
  }
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
  return { nodes, parent };
};

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
    /**
     * A change to a component's file made on it as it is now: an app component's properties or
     * slots, one thing of a system component's look, a note added (its id made here) or taken
     * out. A property or a member renamed or taken out follows into the variants its tree keeps
     * and every instance's props, in every document as it is in the same undo step.
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
     * Nodes of a page, siblings, made an app component: they are its tree (several in a row or a
     * column, as their container lays them out), and an instance of it takes their place, where
     * the first of them was. One undo step.
     */
    readonly makeApp: (
      page: string,
      nodeIds: readonly string[],
      name: string
    ) => Effect.Effect<ComponentEntry, EditFailure | NotFound | Conflict>;
    /**
     * A new app component, its tree an empty column, placed nowhere yet (ADR 0045): the Library's
     * + New, its board opened to build it in place. One undo step.
     */
    readonly create: (
      name: string
    ) => Effect.Effect<ComponentEntry, EditFailure>;
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

      /**
       * The documents' operations that bring the instances of `name` along with a change: every
       * page and canvas, and every other app component's tree, as they are in the step.
       */
      const instanceEdits = Effect.fnUntraced(function* (
        step: ApplyStep,
        name: string,
        made: ComponentChange
      ) {
        const trees = [
          ...(yield* step.all),
          ...(yield* Effect.forEach(
            appComponentsIn(yield* components).filter((c) => c.name !== name),
            (c) => step.get(componentDocOf(c.name))
          )),
        ];
        return trees.flatMap((state): DocumentEdit[] => {
          const ops = state.root ? instanceOps(state.root, name, made) : [];
          return ops.length > 0 ? [{ doc: state.doc, ops }] : [];
        });
      });

      /** A component's file as it is on disk now: what it reads as, or null when there is none. */
      const fileNow = Effect.fnUntraced(function* (name: string) {
        const file = componentFileOf(name);
        const text = yield* fs
          .readFileString(path.join(paths.designsDir, file))
          .pipe(Effect.orElseSucceed(() => null));
        return text === null ? null : readComponentFile(text, file);
      });

      /** Refused when a component of that name has a file already. */
      const notTaken = Effect.fnUntraced(function* (name: string) {
        if ((yield* fileNow(name)) !== null) {
          return yield* new BadRequest({
            message: `there is a ${name} component already`,
          });
        }
      });

      /**
       * A component's file written as `next` makes it of the file as it is under the journal (null
       * when there is none), so a change made since the editor read it stays (a tree edited in
       * place, a note added); with `follow`, the instances of the component in every document
       * follow it in the same step, read in it too. Every write of a component's file is this.
       */
      const changeFile = Effect.fnUntraced(function* (
        name: string,
        label: string,
        next: (
          now: ComponentRead | null
        ) => Effect.Effect<ComponentFile, BadRequest | NotFound>,
        follow?: ComponentChange
      ) {
        const file = componentFileOf(name);
        let saved: ComponentFile | undefined;
        yield* documents.apply({ edits: [], label }, (step) =>
          Effect.gen(function* () {
            const changed = yield* checked(yield* next(yield* fileNow(name)));
            yield* step.tx.write(repoOf(file), componentText(changed));
            saved = changed;
            return follow && changed.origin === "app"
              ? yield* instanceEdits(step, name, follow)
              : undefined;
          })
        );
        yield* publish;
        return {
          ...(saved && { component: saved }),
          file,
        } satisfies ComponentEntry;
      });

      const change = Effect.fn("ComponentService.change")(function* (
        name: string,
        made: ComponentChange
      ) {
        const noteId =
          made.op === "addNote" ? yield* makeId("note") : undefined;
        return yield* changeFile(
          name,
          labelOf(name, made),
          (now) => {
            if (!(now && "component" in now)) {
              return new NotFound({
                message: systemComponentOf(name)
                  ? `${name} has no file: take its look over first`
                  : `no component ${name}${now ? `: ${now.problem}` : ""}`,
              });
            }
            const changed = changedComponent(now.component, made, {
              ...(noteId && { noteId }),
            });
            return "problem" in changed
              ? new BadRequest({ message: changed.problem })
              : Effect.succeed(changed);
          },
          made
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
        return yield* changeFile(name, `Take ${name}'s look over`, (now) => {
          // Started again, a file keeps its behaviour notes: they are not the look.
          const notes = now && "component" in now ? now.component.notes : [];
          return Effect.succeed({
            ...start,
            ...(notes && notes.length > 0 && { notes }),
          });
        });
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

      const makeApp = Effect.fn("ComponentService.makeApp")(function* (
        page: string,
        nodeIds: readonly string[],
        given: string
      ) {
        const name = appComponentName(given);
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
        const { nodes, parent } = found;
        const { file: component, instance } = appComponentFrom(
          name,
          nodes,
          parent,
          makeIdGenerator(root ? idsOf(root) : [])
        );
        const file = componentFileOf(name);
        yield* documents.apply(
          {
            edits: [
              {
                doc: page,
                ops: [
                  {
                    ids: nodes.map((n) => n.id),
                    node: instance,
                    op: "replace",
                  },
                ],
              },
            ],
            label: `Make ${name} an app component`,
          },
          ({ tx }) =>
            Effect.as(
              Effect.all(
                [
                  checked(component),
                  notTaken(name),
                  tx.write(repoOf(file), componentText(component)),
                ],
                { discard: true }
              ),
              undefined
            )
        );
        yield* publish;
        return { component, file } satisfies ComponentEntry;
      });

      const create = Effect.fn("ComponentService.create")(function* (
        given: string
      ) {
        const name = appComponentName(given);
        const made: ComponentFile = {
          name,
          origin: "app",
          properties: [],
          slots: [],
          tree: newElement("column", makeIdGenerator()),
          version: 1,
        };
        // What is wrong with the name is said before that it is taken.
        return yield* changeFile(name, `Make the ${name} component`, () =>
          Effect.as(Effect.andThen(checked(made), notTaken(name)), made)
        );
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
        catalogue,
        change,
        components,
        create,
        fromDefault,
        list,
        makeApp,
        remove,
      });
    })
  );
}
