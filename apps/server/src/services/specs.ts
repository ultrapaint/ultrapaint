/**
 * Component specs (ADR 0029): `specs/<Component>.spec.json` in the designs directory, what a
 * system component looks like as the design says it (ADR 0040). A system component without one is drawn in its
 * default look (`defaults.ts`); taking its look over starts the project's spec from that default,
 * and removing the spec goes back to it. A spec is written as given and validated, started from a
 * system component's default, or made from a node of a page as a draft, which the code does not have yet.
 */

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
import { serialise } from "@ultrapaint/design-document/factories";
import {
  childrenOf,
  findNode,
  findPath,
} from "@ultrapaint/design-document/tree";
import { defaultSpecOf } from "@ultrapaint/system-components/defaults";
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
import { DocumentService } from "./documents.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";

const decodeSpec = Schema.decodeUnknownEffect(ComponentSpec);

const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
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

/**
 * The specs in a designs directory, each read and validated, or the problem with it: the one
 * reading of the files, which the link to the code (ADR 0030) shares with the service.
 */
export const readSpecs = (designsDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(designsDir, SPECS_DIR);
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
    const names = yield* fs.readDirectory(dir).pipe(
      // No specs yet: the directory comes with the first.
      Effect.orElseSucceed((): string[] => [])
    );
    const entries = yield* Effect.forEach(
      names.filter((n) => n.endsWith(SPEC_EXTENSION)).sort(),
      readEntry
    );
    return { specs: entries } satisfies SpecList;
  });

/** The specs of a list that read. */
export const specsIn = (list: SpecList): ComponentSpec[] =>
  list.specs.flatMap((e) => (e.spec ? [e.spec] : []));

export class SpecService extends Context.Service<
  SpecService,
  {
    readonly list: Effect.Effect<SpecList>;
    /** The specs that read, by component: what the preview and the briefing use. */
    readonly specs: Effect.Effect<readonly ComponentSpec[]>;
    readonly write: (spec: unknown) => Effect.Effect<SpecEntry, EditFailure>;
    /**
     * A system component's spec started from its default look (ADR 0040), saved with the look given
     * (`design` when none), so the design edits real values. One there was keeps its behaviour
     * notes, which are not the look.
     */
    readonly fromCode: (
      component: string,
      from: string | undefined,
      look?: SpecLook
    ) => Effect.Effect<SpecEntry, EditFailure>;
    /** Removes a component's spec: a system component is drawn in its default look again. */
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
      const documents = yield* DocumentService;
      const dir = path.join(paths.designsDir, SPECS_DIR);

      /** A spec file's path inside the designs directory and in the repository. */
      const fileOf = (component: string) => ({
        designs: specFileOf(component),
        repo: paths.relative(
          path.join(paths.designsDir, specFileOf(component))
        ),
      });

      const list: Effect.Effect<SpecList> = readSpecs(paths.designsDir).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.withSpan("SpecService.list")
      );

      const specs = Effect.map(list, specsIn);

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

      const fromCode = Effect.fn("SpecService.fromCode")(function* (
        component: string,
        _from: string | undefined,
        look: SpecLook = "design"
      ) {
        const start = defaultSpecOf(component);
        if (!start) {
          return yield* new NotFound({
            message: `${component} is no system component: only a system component has a default look to start from`,
          });
        }
        // Started again, a spec keeps its behaviour notes: they are not the look.
        const notes = (yield* specs).find(
          (s) => s.component === component
        )?.notes;
        return yield* save(
          { ...start, look, ...(notes && notes.length > 0 && { notes }) },
          `Take ${component}'s look over`
        );
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
            message: `no spec for ${component}: take its look over first`,
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
        list,
        remove,
        specs,
        write,
      });
    })
  );
}
