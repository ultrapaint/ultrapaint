/**
 * The tools that read and change design documents: a page, the loose nodes beside the pages or
 * an app component's tree (UP-230), the format they are written in, the operations that change
 * them as the editor does, one undo step at a time, and the focus that shows the user where an
 * agent works.
 */
import { Json } from "@ultrapaint/contracts/base";
import type { Catalogue } from "@ultrapaint/contracts/catalogue";
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import { type DesignNode, DocOp } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import { breakpointsOf } from "@ultrapaint/design-document/breakpoints";
import { fillIds } from "@ultrapaint/design-document/ids";
import { inertFields } from "@ultrapaint/design-document/inert-fields";
import { touchedBy } from "@ultrapaint/design-document/ops";
import { wrapperWarning } from "@ultrapaint/design-document/page-root";
import { fillWarnings } from "@ultrapaint/design-document/sizing";
import {
  canvasDocOf,
  childrenOf,
  findNode,
  idsOf,
  walk,
} from "@ultrapaint/design-document/tree";
import { valueMatcher } from "@ultrapaint/design-document/value-matches";
import { formatNodeRef } from "@ultrapaint/shared/node-ref";
import { Effect, Predicate, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { EventBus } from "../../events.ts";
import { ComponentService } from "../components.ts";
import { DesignSystemService } from "../design-system.ts";
import { DocumentService } from "../documents.ts";
import { ProjectStyleSystem } from "../style-system.ts";
import {
  designSystemSchema,
  OUTLINE_DEPTH,
  pageSchema,
  treeForAgent,
} from "../threads/task-text.ts";
import { CallingThread } from "./access.ts";
import { makeLookup, nodeIdOf, type Where } from "./lookup.ts";
import {
  AnyObject,
  asJson,
  doing,
  finite,
  missing,
  opt,
  reported,
  ToolFailure,
} from "./tool-helpers.ts";

const decodeOps = Schema.decodeUnknownEffect(Schema.Array(DocOp));

/**
 * Sibling nodes of a page made an app component, an instance of it in their place, as the
 * editor's Make component does (UP-230): a call of its own, which is its own undo step.
 */
const MakeComponent = Schema.Struct({
  ids: Schema.NonEmptyArray(Schema.String),
  name: Schema.String,
  op: Schema.Literal("makeComponent"),
});
const decodeMake = Schema.decodeUnknownEffect(MakeComponent);

/** A field that names a node: a reference read as its node's id, anything else as it is. */
const idIn = (value: unknown): unknown =>
  typeof value === "string" ? nodeIdOf(value) : value;

/**
 * An operation with the node references in the fields that name a node (`id`, `parent`, `ids`)
 * read as their ids. Only those: a link, a text or a prop may hold a `#` that is the user's
 * content, `https://example.com/docs#intro` or `/pricing#faq`, and is kept as it is.
 */
const nodeRefsToIds = (op: unknown): unknown => {
  if (!Predicate.isObject(op)) {
    return op;
  }
  const fields = { ...op };
  for (const key of ["id", "parent"] as const) {
    if (key in fields) {
      fields[key] = idIn(fields[key]);
    }
  }
  if (Array.isArray(fields.ids)) {
    fields.ids = fields.ids.map(idIn);
  }
  return fields;
};

/** Past this many, `apply_operations` says how many more warnings, or ignored fields, there are. */
const MAX_WARNINGS = 12;

/** The first `MAX_WARNINGS` of a list, and a line saying how many more there are. */
const capped = <A>(items: readonly A[]): (A | string)[] =>
  items.length > MAX_WARNINGS
    ? [
        ...items.slice(0, MAX_WARNINGS),
        `and ${items.length - MAX_WARNINGS} more`,
      ]
    : [...items];

/** What an agent is told of a page after its edit: a wrapper the page does not need, then fills with no room. */
const warningsOf = (root: DesignNode, catalogue: Catalogue): string[] => {
  const wrapper = wrapperWarning(root);
  return [
    ...(wrapper === null ? [] : [wrapper]),
    ...fillWarnings(root, catalogue).map((w) => `${w.nodeId}: ${w.message}`),
  ];
};

/** A field of a node holding the value `read_page` matched. */
const Match = Schema.Struct({
  field: Schema.String,
  /** A near hit: the value of the token matched, which the field's own is near. */
  near: Schema.optional(Schema.String),
  /** Its reference: page and node (`/orders#c_1`, `canvas#c_1` beside the pages). */
  node: Schema.String,
  /** For a value that names a token: what it comes to in the default theme. */
  resolves: Schema.optional(Schema.String),
  value: Schema.Union([Schema.String, Schema.Number]),
});

const ReadPage = Tool.make("read_page", {
  description:
    "A page's nodes with ids, and a hash for apply_operations; a big one as an outline, deeper levels counted. node: its subtree only; depth: levels shown. A node reference (/orders#c_8x2k1q) names page and node. match ($token, CSS or px): the nodes holding it, every page's without route.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    /** Levels below the node or the root shown; a node at the last keeps a count of its children. */
    depth: opt(finite(0, 50)),
    /** A value: the nodes holding it rather than a tree, on every page and beside them without `route`. */
    match: opt(Schema.String),
    /** Only this node and what is inside it: a big page costs less to read in parts. */
    node: opt(Schema.String),
    /** Needed without `match`. */
    route: opt(Schema.String),
  }),
  success: Schema.Struct({
    document: Schema.optional(Json),
    file: Schema.optional(Schema.String),
    hash: Schema.optional(Schema.String),
    /** The nodes holding the value matched, page by page; past twelve, `more` counts the rest. */
    matches: Schema.optional(Schema.Array(Match)),
    more: Schema.optional(Schema.Number),
    /** Said when a tree too big to give whole is given as its outline. */
    outline: Schema.optional(Schema.String),
    /** The files of the canvas's pages a match could not read, and so did not search. */
    skipped: Schema.optional(Schema.Array(Schema.String)),
  }),
}).annotateMerge(doing("read"));

const ReadCanvas = Tool.make("read_canvas", {
  description:
    "The loose nodes beside a canvas's pages, with x and y; change them with apply_operations, loose: true.",
  failure: ToolFailure,
  parameters: Schema.Struct({ canvas: opt(Schema.String) }),
  success: Schema.Struct({ hash: Schema.String, nodes: Json }),
}).annotateMerge(doing("read"));

const GetDocumentFormat = Tool.make("get_document_format", {
  description:
    'The JSON Schema of a page, or with kind "design-system" of design-system.json, and how it maps to code.',
  failure: ToolFailure,
  parameters: Schema.Struct({
    kind: opt(Schema.Literals(["page", "design-system"])),
  }),
  success: Schema.Struct({ rules: Schema.String, schema: Json }),
}).annotateMerge(doing("read"));

const ApplyOperations = Tool.make("apply_operations", {
  description: `Change a page (loose: true the nodes beside it; component:<Name> an app component's tree) as one undo step. ops in order, ids or node references:
{op:"insert", parent, index?, node}: parent null at the top; node may leave out ids
{op:"remove", id}
{op:"move", id, parent, index?}: index among siblings without it
{op:"update", id, set:{field: value}}: null removes; a group, row or column may change "type"
{op:"setProps", id, props:{name: value}}: null removes
(both take at:"md", from that breakpoint up)
{op:"wrap", ids, type:"row"|"column"|"group"}, {op:"unwrap", id}, {op:"duplicate", id}
{op:"replace", ids, node}: node where the siblings were
{op:"makeComponent", ids, name}, alone: siblings made an app component, an instance in their place
"inst/layer" is a layer of an app instance: update, setProps, remove (hides) override that instance alone
Inserting into an instance showing "text" makes the text its first child. Numbers are pixels, "$name" a token, else CSS. Size an instance with width, height, padding, never className. expectedHash (read_page's) refuses a changed page. "copies": new ids of a duplicate, or of nodes put in whose ids were taken.`,
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Needed only when the project has several canvases. */
    canvas: opt(Schema.String),
    /** The hash read_page answered with; the call is refused if the page changed since. */
    expectedHash: opt(Schema.String),
    /** What the undo menu calls it. */
    label: opt(Schema.String),
    /** Work on the loose nodes placed on the canvas beside the pages, instead of a page. */
    loose: opt(Schema.Boolean),
    /** Checked once the ids a new node leaves out are filled in. */
    ops: Schema.Array(AnyObject),
    /** URL or file of the page; leave out with `loose: true`. */
    route: opt(Schema.String),
  }),
  success: Schema.Struct({
    /** Each node an operation gave a new id, by the id it had, in the order they were made. */
    copies: Schema.optional(
      Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String }))
    ),
    created: Schema.Array(Schema.String),
    hash: Schema.String,
    /** Fields the operations set that did nothing, and why; past twelve, how many more. */
    ignored: Schema.optional(
      Schema.Array(
        Schema.Union([
          Schema.Struct({
            field: Schema.String,
            id: Schema.String,
            why: Schema.String,
          }),
          Schema.String,
        ])
      )
    ),
    /** Nodes of the document whose fill has no room to take, and why. */
    warnings: Schema.optional(Schema.Array(Schema.String)),
  }),
}).annotateMerge(doing("edit"));

export const Focus = Tool.make("focus", {
  description:
    'Show the user the page you are on and, before changing nodes, their ids and what you do (action: "formatting the dates").',
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** A few words on what you are doing to the nodes. */
    action: opt(Schema.String),
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    /** Ids of the nodes of the page you are about to change. */
    nodes: opt(Schema.Array(Schema.String)),
    route: Schema.String,
  }),
  success: Schema.Struct({ file: Schema.String }),
}).annotateMerge(doing("read"));

export const DocumentTools = Toolkit.make(
  ReadPage,
  ReadCanvas,
  GetDocumentFormat,
  ApplyOperations,
  Focus
);

/** The breakpoints one operation writes at: its `at`, and the `at` of every node it puts in. */
const breakpointsOf1 = (op: DocOp): string[] => {
  switch (op.op) {
    case "setProps":
      return op.at === undefined ? [] : [op.at];
    case "update": {
      const set = op.set.at;
      const whole = set && typeof set === "object" ? Object.keys(set) : [];
      return op.at === undefined ? whole : [op.at, ...whole];
    }
    case "insert":
    case "replace":
      return Array.from(walk(op.node)).flatMap((n) => Object.keys(n.at ?? {}));
    default:
      return [];
  }
};

/**
 * The operations with each node put in as the agent wrote it, any field its type lacks kept: the
 * schema has checked it, the page drops that field when it is written, and the answer names it
 * (`inertFields`).
 */
const asWritten = (
  decoded: readonly DocOp[],
  raw: readonly unknown[]
): DocOp[] =>
  decoded.map((op, i) =>
    op.op === "insert" || op.op === "replace"
      ? { ...op, node: (raw[i] as { node: DesignNode }).node }
      : op
  );

/** The breakpoints operations write at. */
const breakpointsNamedIn = (ops: readonly DocOp[]): string[] => [
  ...new Set(ops.flatMap(breakpointsOf1)),
];

export const DocumentToolsLive = DocumentTools.toLayer(
  Effect.gen(function* () {
    const events = yield* EventBus;
    const { canvasOf, documents, pagesOf, project, treeWhere, where } =
      yield* makeLookup;

    /** Shows the calling thread's work on the nodes it changed; a take's on its thing (ADR 0098). */
    const showEdited = Effect.fnUntraced(function* (
      { doc, takeOf }: Where,
      nodeIds: readonly string[],
      label: string | undefined
    ) {
      const threadId = yield* Effect.service(CallingThread);
      if (threadId) {
        yield* events.publish("agent.edited", {
          ...(takeOf === undefined
            ? { doc, nodeIds }
            : { doc: takeOf.doc, nodeIds: [takeOf.node] }),
          threadId,
          ...(label !== undefined && { label }),
        });
      }
    });

    /**
     * `makeComponent`: the page's sibling nodes made an app component through the editor's own
     * Make component (`makeApp`), in a call of its own. Answers with the instance put in their
     * place.
     */
    const makeComponent = Effect.fnUntraced(function* (
      at: Where,
      raw: readonly unknown[],
      expectedHash: string | undefined
    ) {
      if (raw.length !== 1) {
        return yield* missing(
          "makeComponent is its own undo step: send it alone, and the other operations in another call"
        );
      }
      const made = yield* decodeMake(raw[0]).pipe(
        Effect.mapError(
          (error) =>
            new ToolFailure({
              message: `the operations are not valid: ${error.message}`,
            })
        )
      );
      if (at.page === null) {
        return yield* missing(
          "makeComponent makes a component of a page's nodes: name the page with route"
        );
      }
      // A take's working copy may be thrown away: the component it made would stay, placed nowhere.
      if (at.takeOf !== undefined) {
        return yield* missing(
          "makeComponent works on a page, not a take's working copy: make the component once the take is in"
        );
      }
      const before = yield* documents((d) => d.get(at.doc));
      if (expectedHash !== undefined && expectedHash !== before.hash) {
        return yield* missing(
          `${at.file} changed since you last saw it; read it again`
        );
      }
      yield* reported(
        project.use(
          Effect.flatMap(ComponentService, (c) =>
            c.makeApp(at.doc, made.ids, made.name)
          )
        )
      );
      // makeApp answers the component, as the editor's request does: the instance is the node
      // the page did not have.
      const after = yield* documents((d) => d.get(at.doc));
      const had = before.root ? idsOf(before.root) : new Set<string>();
      const created = after.root
        ? [...idsOf(after.root)].filter((id) => !had.has(id))
        : [];
      yield* showEdited(at, created, undefined);
      return { created, hash: after.hash };
    });

    /**
     * Refuses a breakpoint the design system does not have: the code has no prefix for it.
     * Answers with its breakpoints, smallest first.
     */
    const knownBreakpoints = Effect.fnUntraced(function* (
      ops: readonly DocOp[]
    ) {
      const { designSystem } = yield* reported(
        project.use(Effect.flatMap(DesignSystemService, (d) => d.get))
      );
      const known = breakpointsOf(designSystem).map((b) => b.name);
      const unknown = breakpointsNamedIn(ops).filter(
        (name) => !known.includes(name)
      );
      if (unknown.length > 0) {
        return yield* new ToolFailure({
          message: `${unknown.join(", ")} is not a breakpoint of the design system: ${known.join(", ")}`,
        });
      }
      return known;
    });

    /** What a design can place: how an instance's slots lay out what they hold (ADR 0042). */
    const catalogue = reported(
      project.use(Effect.flatMap(ComponentService, (c) => c.catalogue))
    );

    /**
     * The nodes holding a value (`valueMatcher`): on the page `route` names, or on every page of
     * the canvas as its variations in use draw it and among the nodes beside them. A page of the
     * canvas that cannot be read is skipped and named, as `list_pages` passes one by; named by
     * `route`, it fails as `read_page` does. Past `MAX_WARNINGS`, `more` counts the rest.
     */
    const matching = Effect.fnUntraced(function* (
      match: string,
      canvas: string | undefined,
      route: string | undefined
    ) {
      const { designSystem } = yield* reported(
        project.use(Effect.flatMap(DesignSystemService, (d) => d.get))
      );
      // A project with no design system matches its values as they are written.
      const find = valueMatcher(designSystem ?? emptyDesignSystem(), match);
      const { canvases, pages } = yield* reported(pagesOf);
      const several = canvases.length > 1;
      /** The hits in a page's tree, or among the nodes beside the pages, by their references. */
      const hitsIn = (
        root: DesignNode | null,
        at: { readonly canvas: string; readonly page: string | null }
      ) => {
        if (root === null) {
          return [];
        }
        // The nodes beside the pages are each a tree of their own.
        const trees = at.page === null ? childrenOf(root) : [root];
        return trees
          .flatMap((tree) => find(tree))
          .map(({ node, ...hit }) => ({
            ...hit,
            node: formatNodeRef({
              ...(several && { canvas: at.canvas }),
              nodeId: node,
              page: at.page,
            }),
          }));
      };
      /** A page as a node reference names it: its URL, else its file inside the canvas. */
      const pageName = (page: Page | null) =>
        page === null ? null : (page.route ?? page.path);
      const answer = (hits: ReturnType<typeof hitsIn>) => ({
        matches: hits.slice(0, MAX_WARNINGS),
        ...(hits.length > MAX_WARNINGS && {
          more: hits.length - MAX_WARNINGS,
        }),
      });
      if (route !== undefined) {
        const at = yield* where({ canvas, route });
        const state = yield* documents((d) => d.get(at.doc));
        if (state.problem !== undefined) {
          return yield* missing(
            `${at.file} is not a valid page: ${state.problem}`
          );
        }
        return {
          file: at.file,
          hash: state.hash,
          ...answer(
            hitsIn(state.root, { canvas: at.canvas, page: pageName(at.page) })
          ),
        };
      }
      const id = yield* canvasOf(canvas);
      const beside = yield* where({ canvas: id, loose: true });
      const searched = [
        ...pages
          .filter((p) => p.canvas === id)
          .map((p) => ({ doc: p.id, file: p.file, page: pageName(p) })),
        { doc: beside.doc, file: beside.file, page: null },
      ];
      const found: ReturnType<typeof hitsIn> = [];
      const skipped: string[] = [];
      for (const { doc, file, page } of searched) {
        // A page that is not valid, or whose file went since the pages were listed, is passed by
        // and named, as list_pages passes one by; a failure to read the storage fails the call.
        const state = yield* reported(
          project.use(
            Effect.flatMap(DocumentService, (d) => d.get(doc)).pipe(
              Effect.catchTag("NotFound", () => Effect.succeed(null))
            )
          )
        );
        if (state === null || state.problem !== undefined) {
          skipped.push(file);
        } else {
          found.push(...hitsIn(state.root, { canvas: id, page }));
        }
      }
      return {
        ...answer(found),
        ...(skipped.length > 0 && { skipped }),
      };
    });

    /** How the design maps to code, in the open project's style system. */
    const codeRulesOf = reported(
      project.use(Effect.map(ProjectStyleSystem, (s) => s.codeRules))
    );

    return DocumentTools.of({
      apply_operations: Effect.fn("EditorTools.apply_operations")(function* ({
        canvas,
        expectedHash,
        label,
        loose,
        ops,
        route,
      }) {
        const at = yield* treeWhere({ canvas, loose, route });
        const { doc } = at;
        // A node an agent writes may leave its ids out; they are made before the ops are read.
        // Node references the user pasted stand for their node ids.
        const raw = (JSON.parse(JSON.stringify(ops)) as unknown[]).map(
          nodeRefsToIds
        );
        if (
          raw.some((op) => Predicate.isObject(op) && op.op === "makeComponent")
        ) {
          return yield* makeComponent(at, raw, expectedHash);
        }
        for (const op of raw) {
          if (op && typeof op === "object" && "node" in op) {
            fillIds({ nodes: [(op as { node: unknown }).node] });
          }
        }
        const decoded = yield* decodeOps(raw).pipe(
          Effect.mapError(
            (error) =>
              new ToolFailure({
                message: `the operations are not valid: ${error.message}`,
              })
          )
        );
        const breakpoints = yield* knownBreakpoints(decoded);
        const given = asWritten(decoded, raw);
        // An agent's edit of a component keeps its slots and the nodes its properties set:
        // taking one out is handoff's change's, which follows into every instance.
        const result = yield* documents((d) =>
          d.apply(
            {
              edits: [
                {
                  doc,
                  ops: given,
                  ...(expectedHash !== undefined && { expectedHash }),
                },
              ],
              ...(label !== undefined && { label }),
            },
            undefined,
            { keepParts: true }
          )
        );
        const after = yield* documents((d) => d.get(doc));
        // The work is the calling thread's: the canvas shows it on the nodes it changed.
        if (after.root) {
          yield* showEdited(
            at,
            touchedBy(decoded, result.created, after.root),
            label
          );
        }
        // What the call set that did nothing, then the fills on the page with no room.
        const { ignored, warnings } = after.root
          ? {
              ignored: inertFields(result.found, after.root, breakpoints),
              warnings: warningsOf(after.root, yield* catalogue),
            }
          : { ignored: [], warnings: [] };
        return {
          ...(result.copies.length > 0 && { copies: result.copies }),
          created: result.created,
          hash: result.documents[0]?.hash ?? "",
          ...(ignored.length > 0 && { ignored: capped(ignored) }),
          ...(warnings.length > 0 && { warnings: capped(warnings) }),
        };
      }),

      focus: Effect.fn("EditorTools.focus")(function* ({
        action,
        nodes,
        route,
        canvas,
      }) {
        const { doc, file, nodeId, page, takeOf } = yield* where({
          canvas,
          route,
        });
        // A reference names its node: the route's, or each of the nodes'. A take's work shows
        // on its thing (ADR 0098).
        const nodeIds = takeOf
          ? [takeOf.node]
          : (nodes?.map(nodeIdOf) ??
            (nodeId === undefined ? undefined : [nodeId]));
        const threadId = yield* Effect.service(CallingThread);
        if (threadId) {
          // The page, not the route: the same route can be a page in two canvases.
          yield* events.publish("agent.focus", {
            pageId: takeOf?.doc ?? doc,
            threadId,
            ...(page?.route !== undefined && { route: page.route }),
            ...(nodeIds !== undefined && { nodeIds }),
            ...(action !== undefined && { action }),
          });
        }
        return { file };
      }),

      get_document_format: ({ kind }) =>
        Effect.map(codeRulesOf, (rules) => ({
          rules,
          schema: asJson(
            JSON.parse(
              kind === "design-system" ? designSystemSchema() : pageSchema()
            )
          ),
        })),

      read_canvas: Effect.fn("EditorTools.read_canvas")(function* ({ canvas }) {
        const id = yield* canvasOf(canvas);
        const state = yield* documents((d) => d.get(canvasDocOf(id)));
        if (state.problem !== undefined) {
          return yield* missing(state.problem);
        }
        return {
          hash: state.hash,
          nodes: asJson(
            state.root && "children" in state.root
              ? (state.root.children ?? [])
              : []
          ),
        };
      }),

      read_page: Effect.fn("EditorTools.read_page")(function* ({
        route,
        canvas,
        depth,
        match,
        node,
      }) {
        if (match !== undefined) {
          return node === undefined && depth === undefined
            ? yield* matching(match, canvas, route)
            : yield* missing(
                "match searches for the nodes holding a value and reads no tree: leave out node and depth"
              );
        }
        if (route === undefined) {
          return yield* missing(
            "say which page with `route`, or pass `match` to search the canvas for a value"
          );
        }
        /** The tree, or its outline when it is too big or the agent asked for one. */
        const shown = (tree: DesignNode) => {
          const read = treeForAgent(tree, depth);
          return {
            document: asJson(read.tree),
            ...(read.outlined &&
              depth === undefined && {
                outline: `too big to give whole: ${OUTLINE_DEPTH} levels down, a node there counting its children; read a part with node`,
              }),
          };
        };
        const { doc, file, nodeId } = yield* treeWhere({ canvas, node, route });
        const state = yield* documents((d) => d.get(doc));
        if (state.problem !== undefined) {
          return yield* missing(
            `${file} is not a valid page: ${state.problem}`
          );
        }
        if (nodeId !== undefined) {
          const found = findNode(state.root, nodeId);
          if (found === null) {
            return yield* missing(
              `no node ${nodeId} in ${file}; read it without a node to see its ids`
            );
          }
          return { file, hash: state.hash, ...shown(found) };
        }
        if (!state.root) {
          return {
            document: asJson({ root: null, version: 1 }),
            file,
            hash: state.hash,
          };
        }
        const { document, ...outlined } = shown(state.root);
        return {
          document: asJson({ root: document, version: 1 }),
          file,
          hash: state.hash,
          ...outlined,
        };
      }),
    });
  })
);
