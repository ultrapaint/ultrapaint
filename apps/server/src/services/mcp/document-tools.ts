/**
 * The tools that read and change design documents: a page or the loose nodes beside the pages,
 * the format they are written in, the operations that change them as the editor does, one undo
 * step at a time, and the focus that shows the user where an agent works.
 */
import { Json } from "@ultrapaint/contracts/base";
import { type DesignNode, DocOp } from "@ultrapaint/contracts/document";
import { breakpointsOf } from "@ultrapaint/design-document/breakpoints";
import { fillIds } from "@ultrapaint/design-document/ids";
import { touchedBy } from "@ultrapaint/design-document/ops";
import { fillWarnings } from "@ultrapaint/design-document/sizing";
import { canvasDocOf, findNode, walk } from "@ultrapaint/design-document/tree";
import { Effect, Predicate, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { EventBus } from "../../events.ts";
import { ComponentService } from "../components.ts";
import { DesignSystemService } from "../design-system.ts";
import { ProjectStyleSystem } from "../style-system.ts";
import {
  designSystemSchema,
  OUTLINE_DEPTH,
  pageSchema,
  treeForAgent,
} from "../threads/task-text.ts";
import { CallingThread } from "./access.ts";
import { makeLookup, nodeIdOf } from "./lookup.ts";
import {
  asJson,
  doing,
  finite,
  missing,
  opt,
  reported,
  ToolFailure,
} from "./tool-helpers.ts";

const decodeOps = Schema.decodeUnknownEffect(Schema.Array(DocOp));

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

/** Past this many, `apply_operations` says how many more warnings there are. */
const MAX_WARNINGS = 12;

/**
 * One JSON object an agent passes, the handler validating it. An array of `AnyJson` would say
 * nothing of its items, and Codex reads an array without `items` as an array of strings.
 */
const AnyObject = Schema.Record(Schema.String, Schema.Unknown);

const ReadPage = Tool.make("read_page", {
  description:
    "A page's nodes with ids, and a hash for apply_operations; a big one as an outline, deeper levels counted. node: its subtree only; depth: levels shown. A node reference (/orders#c_8x2k1q) names page and node.",
  failure: ToolFailure,
  parameters: Schema.Struct({
    /** Needed only when the URL is a page in more than one canvas. */
    canvas: opt(Schema.String),
    /** Levels below the node or the root shown; a node at the last keeps a count of its children. */
    depth: opt(finite(0, 50)),
    /** Only this node and what is inside it: a big page costs less to read in parts. */
    node: opt(Schema.String),
    route: Schema.String,
  }),
  success: Schema.Struct({
    document: Json,
    file: Schema.String,
    hash: Schema.String,
    /** Said when a tree too big to give whole is given as its outline. */
    outline: Schema.optional(Schema.String),
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
  description: `Change a page (loose: true the nodes beside the pages) as one undo step. ops in order, ids or node references:
{op:"insert", parent, index?, node}: parent null at the top; node may leave out ids
{op:"remove", id}
{op:"move", id, parent, index?}: index among siblings without it
{op:"update", id, set:{field: value}}: null removes; a group, row or column may change "type"
{op:"setProps", id, props:{name: value}}: null removes
(both take at:"md", from that breakpoint up)
{op:"wrap", ids, type:"row"|"column"|"group"}, {op:"unwrap", id}, {op:"duplicate", id}
{op:"replace", ids, node}: node where the siblings were
Inserting into an instance showing "text" makes the text its first child. Numbers are pixels, "$name" a token, else CSS. Size an instance with width, height, padding, never className. expectedHash (from read_page) refuses a changed page. "warnings": fills with no room.`,
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
    created: Schema.Array(Schema.String),
    hash: Schema.String,
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

/** The breakpoints one operation writes at: its `at`, and the `at` of every node it inserts. */
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
      return Array.from(walk(op.node)).flatMap((n) => Object.keys(n.at ?? {}));
    default:
      return [];
  }
};

/** The breakpoints operations write at. */
const breakpointsNamedIn = (ops: readonly DocOp[]): string[] => [
  ...new Set(ops.flatMap(breakpointsOf1)),
];

export const DocumentToolsLive = DocumentTools.toLayer(
  Effect.gen(function* () {
    const events = yield* EventBus;
    const { canvasOf, documents, project, where } = yield* makeLookup;

    /** Refuses a breakpoint the design system does not have: the code has no prefix for it. */
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
    });

    /** What a design can place: how an instance's slots lay out what they hold (ADR 0042). */
    const catalogue = reported(
      project.use(Effect.flatMap(ComponentService, (c) => c.catalogue))
    );

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
        const { doc } = yield* where({ canvas, loose, route });
        // A node an agent writes may leave its ids out; they are made before the ops are read.
        // Node references the user pasted stand for their node ids.
        const raw = (JSON.parse(JSON.stringify(ops)) as unknown[]).map(
          nodeRefsToIds
        );
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
        yield* knownBreakpoints(decoded);
        const result = yield* documents((d) =>
          d.apply({
            edits: [
              {
                doc,
                ops: decoded,
                ...(expectedHash !== undefined && { expectedHash }),
              },
            ],
            ...(label !== undefined && { label }),
          })
        );
        const after = yield* documents((d) => d.get(doc));
        // The work is the calling thread's: the canvas shows it on the nodes it changed.
        const threadId = yield* Effect.service(CallingThread);
        if (threadId && after.root) {
          yield* events.publish("agent.edited", {
            doc,
            nodeIds: touchedBy(decoded, result.created, after.root),
            threadId,
            ...(label !== undefined && { label }),
          });
        }
        const warnings = after.root
          ? fillWarnings(after.root, yield* catalogue).map(
              (w) => `${w.nodeId}: ${w.message}`
            )
          : [];
        return {
          created: result.created,
          hash: result.documents[0]?.hash ?? "",
          ...(warnings.length > 0 && {
            warnings:
              warnings.length > MAX_WARNINGS
                ? [
                    ...warnings.slice(0, MAX_WARNINGS),
                    `and ${warnings.length - MAX_WARNINGS} more`,
                  ]
                : warnings,
          }),
        };
      }),

      focus: Effect.fn("EditorTools.focus")(function* ({
        action,
        nodes,
        route,
        canvas,
      }) {
        const { doc, file, nodeId, page } = yield* where({ canvas, route });
        // A reference names its node: the route's, or each of the nodes'.
        const nodeIds =
          nodes?.map(nodeIdOf) ?? (nodeId === undefined ? undefined : [nodeId]);
        const threadId = yield* Effect.service(CallingThread);
        if (threadId) {
          // The page, not the route: the same route can be a page in two canvases.
          yield* events.publish("agent.focus", {
            pageId: doc,
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
        node,
      }) {
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
        const { doc, file, nodeId } = yield* where({ canvas, node, route });
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
