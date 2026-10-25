/**
 * The link between the designs and their code (ADR 0030), for agents in the editor and outside
 * it: what is ready or changed, the task that implements one, marking it implemented, and
 * writing down behaviour the design cannot show. One tool: every agent carries every tool's
 * schema on every turn.
 */

import {
  type ImplementationItem,
  isSpecTarget,
} from "@ultrapaint/contracts/implementation";
import { findNode, nodeLabel } from "@ultrapaint/design-document/tree";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { CommentsService } from "../comments.ts";
import { DocumentService } from "../documents.ts";
import { ImplementationService } from "../implementation.ts";
import { SlashCommands } from "../threads/commands.ts";
import { makeLookup } from "./lookup.ts";
import { missing, opt, reported, ToolFailure } from "./tool-helpers.ts";

export const Handoff = Tool.make("handoff", {
  description:
    'Designs and their code. action "list": what is ready or changed; "read": the task for target; "mark": target implemented by files; "note": what target\'s node must do that a design cannot show (text).',
  failure: ToolFailure,
  parameters: Schema.Struct({
    action: Schema.Literals(["list", "read", "mark", "note"]),
    canvas: opt(Schema.String),
    files: opt(Schema.Array(Schema.String)),
    node: opt(Schema.String),
    /** A page (URL or file), or a component spec as spec:Button. */
    target: opt(Schema.String),
    text: opt(Schema.String),
  }),
  success: Schema.Struct({ text: Schema.String }),
});

/** A design's line in the list: what it is, where it stands, and what implements it. */
const lineOf = (item: ImplementationItem) => {
  const changed = [
    item.designChanged ? "the design changed" : null,
    item.codeChanged
      ? `the code changed (${item.changedFiles.join(", ")})`
      : null,
  ].filter(Boolean);
  const status =
    item.status === "changed" ? `changed: ${changed.join(", ")}` : item.status;
  const files = item.files.length > 0 ? ` → ${item.files.join(", ")}` : "";
  return `- ${item.target} (${item.name}): ${status}${files}`;
};

const HandoffTools = Toolkit.make(Handoff);

export const handoffToolHandlers = Effect.gen(function* () {
  const { pageAt, project } = yield* makeLookup;
  const commands = yield* SlashCommands;

  /** The binding's name for what an agent named: a page by URL or file, or `spec:<Component>`. */
  const targetOf = Effect.fnUntraced(function* (
    target: string | undefined,
    canvas: string | undefined
  ) {
    if (!target) {
      return yield* missing("say which design with target");
    }
    if (isSpecTarget(target)) {
      return target;
    }
    return (yield* pageAt(target, canvas)).id;
  });

  const list = Effect.gen(function* () {
    const { items } = yield* reported(
      project.use(Effect.flatMap(ImplementationService, (s) => s.list))
    );
    const shown = items.filter((i) => i.status !== "draft");
    return {
      text:
        shown.length === 0
          ? "Nothing is ready or implemented yet."
          : shown.map(lineOf).join("\n"),
    };
  });

  const read = Effect.fnUntraced(function* (id: string) {
    const task = yield* commands.expand(`/implement ${id}`);
    return task === null
      ? yield* missing(`${id} cannot be read as a task`)
      : { text: task };
  });

  const mark = Effect.fnUntraced(function* (
    id: string,
    files: readonly string[] | undefined
  ) {
    if (!files || files.length === 0) {
      return yield* missing(
        "name the files that implement it in files, repository-relative"
      );
    }
    const item = yield* reported(
      project.use(
        Effect.flatMap(ImplementationService, (s) => s.mark(id, files))
      )
    );
    return { text: lineOf(item) };
  });

  /** A behaviour note on a node of a page: what the code must do that a design cannot show. */
  const note = Effect.fnUntraced(function* (
    id: string,
    canvas: string | undefined,
    node: string | undefined,
    text: string | undefined
  ) {
    if (!text) {
      return yield* missing("say in text what the code must do");
    }
    if (isSpecTarget(id)) {
      return yield* missing("a behaviour note goes on a page's node");
    }
    const page = yield* pageAt(id, canvas);
    const { root } = yield* reported(
      project.use(Effect.flatMap(DocumentService, (d) => d.get(page.id)))
    );
    const found = node ? findNode(root, node) : null;
    if (node && !found) {
      return yield* missing(`no node ${node} in ${page.file}`);
    }
    yield* reported(
      project.use(
        Effect.flatMap(CommentsService, (comments) =>
          comments.create({
            canvas: page.canvas,
            element: found ? nodeLabel(found) : null,
            kind: "behaviour",
            nodeId: found?.id ?? null,
            page: page.path,
            text,
            x: 0,
            y: 0,
          })
        )
      )
    );
    return { text: `Noted on ${page.file}${found ? ` (${found.id})` : ""}.` };
  });

  return HandoffTools.of({
    handoff: Effect.fn("EditorTools.handoff")(function* ({
      action,
      canvas,
      files,
      node,
      target,
      text,
    }) {
      if (action === "list") {
        return yield* list;
      }
      const id = yield* targetOf(target, canvas);
      if (action === "read") {
        return yield* read(id);
      }
      if (action === "mark") {
        return yield* mark(id, files);
      }
      return yield* note(id, canvas, node, text);
    }),
  });
});
