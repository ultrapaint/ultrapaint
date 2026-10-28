/**
 * Component specs (ADR 0029): `specs/<Component>.spec.json` in the designs directory, what a
 * component looks like as the design says it. The behaviour stays the code's; a spec with
 * `look: design` is drawn over the component in the preview. A spec is written as given and
 * validated, read off the code's cva classes through the style system, or made from a node of a
 * page as a draft, which the code does not have yet.
 */

import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import {
  BadRequest,
  type Conflict,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  ComponentSpec,
  DRAFT_FROM,
  emptySpec,
  ROOT_SLOT,
  SPEC_EXTENSION,
  SPECS_DIR,
  type SpecEntry,
  type SpecList,
  type SpecLook,
  type SpecNote,
  specFileOf,
} from "@ultrapaint/contracts/specs";
import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { serialise } from "@ultrapaint/design-document/factories";
import {
  childrenOf,
  findNode,
  findPath,
} from "@ultrapaint/design-document/tree";
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
import { makeId } from "../ids.ts";
import { CatalogueService } from "./catalogue.ts";
import { CodeSide } from "./code-side.ts";
import { DocumentService } from "./documents.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";

const decodeSpec = Schema.decodeUnknownEffect(ComponentSpec);

const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const DATA_SLOT_RE = /data-slot=["']([a-z0-9-]+)["']/g;

/** The `data-slot`s a component's file writes, in the order they appear. */
export const slotsInSource = (source: string): string[] => [
  ...new Set([...source.matchAll(DATA_SLOT_RE)].map((m) => m[1] ?? "")),
];

/**
 * The parts of a component that its own file names: the slot whose name is the component's in
 * kebab case is its root, the others are parts inside it. A file with several components (a
 * card's header, title, content) names theirs too: only the slots that start with the root's
 * name and are not another export's root are this component's.
 */
export const slotsOf = (
  component: string,
  slots: readonly string[],
  siblings: readonly string[]
): string[] => {
  const kebab = component.replace(/(?<!^)([A-Z])/g, "-$1").toLowerCase();
  const others = new Set(
    siblings.map((s) => s.replace(/(?<!^)([A-Z])/g, "-$1").toLowerCase())
  );
  return slots.filter(
    (slot) =>
      slot !== kebab && slot.startsWith(`${kebab}-`) && !others.has(slot)
  );
};

/** The fields a draft's instance takes over from the node it replaces: where it sits. */
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
  "width",
  "x",
  "y",
] as const;

export class SpecService extends Context.Service<
  SpecService,
  {
    readonly list: Effect.Effect<SpecList>;
    /** The specs that read, by component: what the preview and the briefing use. */
    readonly specs: Effect.Effect<readonly ComponentSpec[]>;
    readonly write: (spec: unknown) => Effect.Effect<SpecEntry, EditFailure>;
    readonly fromCode: (
      component: string,
      from: string | undefined,
      look: SpecLook
    ) => Effect.Effect<SpecEntry, EditFailure | NotFound>;
    /**
     * A spec read off the code for every component with classes to read and no spec yet, in one
     * undo step: how a project whose components are built already comes in. Answers with each
     * spec and the file of its component.
     */
    readonly fromCodeAll: (look: SpecLook) => Effect.Effect<
      readonly {
        readonly file: string;
        readonly spec: ComponentSpec;
      }[],
      EditFailure
    >;
    readonly remove: (
      component: string
    ) => Effect.Effect<void, EditFailure | NotFound>;
    /**
     * A behaviour note added to a component's spec (ADR 0030), about a slot or the whole
     * component: what its code must do that the spec cannot show. One undo step.
     */
    readonly addNote: (
      component: string,
      text: string,
      slot?: string
    ) => Effect.Effect<SpecNote, EditFailure | NotFound>;
    readonly draftFrom: (
      page: string,
      nodeId: string,
      name: string
    ) => Effect.Effect<SpecEntry, EditFailure | NotFound | Conflict>;
  }
>()("ultrapaint/server/SpecService") {
  static readonly layer = Layer.effect(
    SpecService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const catalogue = yield* CatalogueService;
      const styleSystem = yield* ProjectStyleSystem;
      const code = yield* CodeSide;
      const documents = yield* DocumentService;
      const dir = path.join(paths.designsDir, SPECS_DIR);

      /** A spec file's path inside the designs directory and in the repository. */
      const fileOf = (component: string) => ({
        designs: specFileOf(component),
        repo: paths.relative(
          path.join(paths.designsDir, specFileOf(component))
        ),
      });

      const readEntry = (name: string) =>
        Effect.gen(function* () {
          const file = `${SPECS_DIR}/${name}`;
          const text = yield* fs.readFileString(path.join(dir, name));
          const json = yield* Effect.try({
            catch: (error) => `not JSON: ${String(error)}`,
            try: () => JSON.parse(text) as unknown,
          });
          const spec = yield* decodeSpec(json).pipe(
            Effect.mapError((error) => error.message)
          );
          return { file, spec } satisfies SpecEntry;
        }).pipe(
          Effect.catch((problem) =>
            Effect.succeed({
              file: `${SPECS_DIR}/${name}`,
              problem: typeof problem === "string" ? problem : problem.message,
            } satisfies SpecEntry)
          )
        );

      const list: Effect.Effect<SpecList> = Effect.gen(function* () {
        const names = yield* fs.readDirectory(dir).pipe(
          // No specs yet: the directory comes with the first.
          Effect.orElseSucceed((): string[] => [])
        );
        const entries = yield* Effect.forEach(
          names.filter((n) => n.endsWith(SPEC_EXTENSION)).sort(),
          readEntry
        );
        return { specs: entries };
      }).pipe(Effect.withSpan("SpecService.list"));

      const specs = Effect.map(list, (l) =>
        l.specs.flatMap((e) => (e.spec ? [e.spec] : []))
      );

      const publish = Effect.flatMap(list, (l) => events.publish("specs", l));

      const save = Effect.fnUntraced(function* (
        spec: ComponentSpec,
        label: string
      ) {
        const file = fileOf(spec.component);
        yield* edit.transaction(label, (tx) =>
          tx.write(file.repo, serialise(spec))
        );
        yield* publish;
        return { file: file.designs, spec } satisfies SpecEntry;
      });

      const write = Effect.fn("SpecService.write")(function* (input: unknown) {
        const spec = yield* decodeSpec(input).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the spec is not valid: ${error.message}`,
              })
          )
        );
        if (!COMPONENT_NAME_RE.test(spec.component)) {
          return yield* new BadRequest({
            message: `a component is named in PascalCase: ${spec.component}`,
          });
        }
        return yield* save(spec, `Change the ${spec.component} spec`);
      });

      /** The catalogue's entry for a component, by name and, when given, module. */
      const metaOf = Effect.fnUntraced(function* (
        component: string,
        from: string | undefined
      ) {
        const { components } = yield* catalogue.get(false).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the catalogue cannot be read: ${error.message}`,
              })
          )
        );
        const found =
          components.find(
            (c) =>
              c.name === component &&
              (from === undefined || c.importFrom === from)
          ) ?? components.find((c) => c.name === component);
        if (!found) {
          return yield* new NotFound({
            message: `no component ${component} in the catalogue`,
          });
        }
        return { all: components, meta: found };
      });

      /** The slots a component's own file names, after its root. */
      const slotsFor = Effect.fnUntraced(function* (
        meta: ComponentMeta,
        all: readonly ComponentMeta[]
      ) {
        const source = yield* fs
          .readFileString(path.resolve(paths.root, meta.file))
          .pipe(Effect.orElseSucceed(() => ""));
        const siblings = all
          .filter((c) => c.file === meta.file && c.name !== meta.name)
          .map((c) => c.name);
        return slotsOf(meta.name, slotsInSource(source), siblings);
      });

      /** A component's spec read off its cva classes; one there was keeps its behaviour notes. */
      const specFromCode = Effect.fnUntraced(function* (
        meta: ComponentMeta,
        all: readonly ComponentMeta[],
        look: SpecLook,
        tokens: readonly SourceToken[],
        kept: ComponentSpec | undefined
      ) {
        const { styles } = meta;
        const read = styles
          ? yield* Effect.try({
              catch: (error) =>
                new BadRequest({
                  message: `${meta.name}'s classes could not be read: ${String(error)}`,
                }),
              try: () => styleSystem.componentSpec(styles, tokens),
            })
          : { base: {}, defaults: {}, states: {}, variants: {} };
        const parts = yield* slotsFor(meta, all);
        // Read again, a spec keeps its behaviour notes: they are not the code's look.
        const notes = kept?.notes;
        return {
          ...emptySpec(meta.name, meta.importFrom, look),
          ...read,
          ...(meta.description !== undefined && {
            description: meta.description,
          }),
          ...(notes && notes.length > 0 && { notes }),
          slots: [{ name: ROOT_SLOT }, ...parts.map((name) => ({ name }))],
        } satisfies ComponentSpec;
      });

      const fromCode = Effect.fn("SpecService.fromCode")(function* (
        component: string,
        from: string | undefined,
        look: SpecLook
      ) {
        const { all, meta } = yield* metaOf(component, from);
        const spec = yield* specFromCode(
          meta,
          all,
          look,
          (yield* code.tokens).tokens,
          (yield* specs).find((s) => s.component === meta.name)
        );
        return yield* save(spec, `Read the ${meta.name} spec from the code`);
      });

      const fromCodeAll = Effect.fn("SpecService.fromCodeAll")(function* (
        look: SpecLook
      ) {
        const { components } = yield* catalogue.get(false).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the catalogue cannot be read: ${error.message}`,
              })
          )
        );
        const have = new Set((yield* specs).map((s) => s.component));
        // A component without classes to read would be an empty spec; one with a spec keeps it.
        const open = components.filter(
          (c) => c.styles !== undefined && !have.has(c.name)
        );
        const { tokens } = yield* code.tokens;
        const read = yield* Effect.forEach(open, (meta) =>
          Effect.map(
            specFromCode(meta, components, look, tokens, undefined),
            (spec) => ({ file: meta.file, spec })
          )
        );
        if (read.length > 0) {
          yield* edit.transaction(
            `Read ${read.length} spec${read.length === 1 ? "" : "s"} from the code`,
            (tx) =>
              Effect.forEach(
                read,
                ({ spec }) =>
                  tx.write(fileOf(spec.component).repo, serialise(spec)),
                { discard: true }
              )
          );
          yield* publish;
        }
        return read;
      });

      const remove = Effect.fn("SpecService.remove")(function* (
        component: string
      ) {
        const file = fileOf(component);
        const exists = yield* fs
          .exists(path.join(paths.designsDir, file.designs))
          .pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          return yield* new NotFound({ message: `no spec for ${component}` });
        }
        yield* edit.transaction(`Delete the ${component} spec`, (tx) =>
          tx.remove(file.repo)
        );
        yield* publish;
      });

      const addNote = Effect.fn("SpecService.addNote")(function* (
        component: string,
        text: string,
        slot?: string
      ) {
        const spec = (yield* specs).find((s) => s.component === component);
        if (!spec) {
          return yield* new NotFound({
            message: `no spec for ${component}: read it from the code first`,
          });
        }
        if (text.trim() === "") {
          return yield* new BadRequest({
            message: "say what the component must do",
          });
        }
        if (slot !== undefined && !spec.slots.some((s) => s.name === slot)) {
          return yield* new NotFound({
            message: `${component} has no slot ${slot}; its slots are ${spec.slots.map((s) => s.name).join(", ")}`,
          });
        }
        const note: SpecNote = {
          id: yield* makeId("note"),
          ...(slot !== undefined && slot !== ROOT_SLOT && { slot }),
          text: text.trim(),
        };
        yield* save(
          { ...spec, notes: [...(spec.notes ?? []), note] },
          `Note how ${component} behaves`
        );
        return note;
      });

      const draftFrom = Effect.fn("SpecService.draftFrom")(function* (
        page: string,
        nodeId: string,
        name: string
      ) {
        const component = name
          .trim()
          .replace(/\s+(\w)/g, (_, c: string) => c.toUpperCase());
        if (!COMPONENT_NAME_RE.test(component)) {
          return yield* new BadRequest({
            message: `a component is named in PascalCase, letters and digits: ${name}`,
          });
        }
        const existing = yield* specs;
        if (existing.some((s) => s.component === component)) {
          return yield* new BadRequest({
            message: `there is a ${component} spec already`,
          });
        }
        const { root } = yield* documents.get(page);
        const node = root ? findNode(root, nodeId) : null;
        const at = root ? findPath(root, nodeId) : null;
        if (!(root && node && at) || node.id === root.id) {
          return yield* new NotFound({
            message: `no node ${nodeId} in ${page} to make a component of`,
          });
        }
        const parent = at.at(-2);
        const index = parent
          ? childrenOf(parent).findIndex((c) => c.id === nodeId)
          : -1;
        if (!parent || index < 0) {
          return yield* new NotFound({
            message: `${nodeId} is not inside a container of ${page}`,
          });
        }
        const placement = Object.fromEntries(
          PLACEMENT_FIELDS.flatMap((field) => {
            const value = (node as unknown as Record<string, unknown>)[field];
            return value === undefined ? [] : [[field, value] as const];
          })
        );
        const instance = {
          ...placement,
          component,
          from: DRAFT_FROM,
          id: nodeId,
          type: "instance",
        } as InstanceNode;
        const draft = Object.fromEntries(
          Object.entries(node).filter(
            ([key]) =>
              !(PLACEMENT_FIELDS as readonly string[]).includes(key) &&
              key !== "name"
          )
        ) as DesignNode;
        const spec: ComponentSpec = {
          ...emptySpec(component, DRAFT_FROM, "design"),
          draft,
        };
        const file = fileOf(component);
        // The spec first, so the instance has its tree as soon as the page names it.
        yield* edit.transaction(`Make ${component} a draft component`, (tx) =>
          tx.write(file.repo, serialise(spec))
        );
        yield* documents.apply({
          edits: [
            {
              doc: page,
              ops: [
                { id: nodeId, op: "remove" },
                { index, node: instance, op: "insert", parent: parent.id },
              ],
            },
          ],
          label: `Use the ${component} draft`,
        });
        yield* publish;
        return { file: file.designs, spec } satisfies SpecEntry;
      });

      // Whoever changes the files — an undo, an agent, a checkout — the editor hears of it.
      const prefix = `${paths.relative(dir)}/`;
      yield* events.subscribe("file.changed").pipe(
        Stream.filter(
          ({ file }) => file.startsWith(prefix) && file.endsWith(SPEC_EXTENSION)
        ),
        Stream.debounce("50 millis"),
        Stream.runForEach(() => publish),
        Effect.forkScoped
      );

      return SpecService.of({
        addNote,
        draftFrom,
        fromCode,
        fromCodeAll,
        list,
        remove,
        specs,
        write,
      });
    })
  );
}
