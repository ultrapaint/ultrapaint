/**
 * The link between the designs and their code (ADR 0030), for agents in the editor and outside
 * it: what is ready or changed, the task that implements one, marking it implemented, writing
 * down behaviour the design cannot show, and bringing the code's tokens up to the design's (ADR
 * 0028). One tool: every agent carries every tool's schema on every turn.
 */

import {
  type ImplementationItem,
  isSpecTarget,
  SPEC_TARGET_PREFIX,
} from "@ultrapaint/contracts/implementation";
import { baselineKey } from "@ultrapaint/contracts/sync";
import { findNode, nodeLabel } from "@ultrapaint/design-document/tree";
import { plural } from "@ultrapaint/shared/text";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { CommentsService } from "../comments.ts";
import { DesignSystemSyncService } from "../design-system-sync.ts";
import { ImplementationService } from "../implementation.ts";
import { SpecService } from "../specs.ts";
import { codeDirection } from "../sync-readings.ts";
import { HANDOFF_ACTIONS } from "../threads/agent-ways.ts";
import { AgentTasks } from "../threads/tasks.ts";
import { makeLookup } from "./lookup.ts";
import { missing, opt, reported, ToolFailure } from "./tool-helpers.ts";

export const Handoff = Tool.make("handoff", {
  description:
    'Designs and their code. action "list": what is ready or changed; "read": target\'s task; "mark": target implemented by files; "note": what target (its node) must do that a design cannot show (text); "export"/"import": token values design→code/code→design, the tokens named or all changed on one side.',
  failure: ToolFailure,
  parameters: Schema.Struct({
    action: Schema.Literals(HANDOFF_ACTIONS),
    canvas: opt(Schema.String),
    files: opt(Schema.Array(Schema.String)),
    /** A page's node, or a spec's slot. */
    node: opt(Schema.String),
    /** A page (URL or file), or a component spec as spec:Button. */
    target: opt(Schema.String),
    text: opt(Schema.String),
    /** Token names, `color-primary` or `color-primary@dark` for one theme. */
    tokens: opt(Schema.Array(Schema.String)),
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
  const tokens = item.tokens
    ? `; tokens waiting for the code: ${item.tokens.join(", ")}`
    : "";
  return `- ${item.target} (${item.name}): ${status}${files}${tokens}`;
};

const HandoffTools = Toolkit.make(Handoff);

export const handoffToolHandlers = Effect.gen(function* () {
  const { documents, pageAt, project } = yield* makeLookup;
  const implementation = project.service(ImplementationService);
  const tasks = yield* AgentTasks;
  const sync = yield* DesignSystemSyncService;

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
    const { items } = yield* reported(implementation((s) => s.list));
    const shown = items.filter((i) => i.status !== "draft");
    return {
      text:
        shown.length === 0
          ? "Nothing is ready or implemented yet."
          : shown.map(lineOf).join("\n"),
    };
  });

  /** The task that implements a design, or why there is none, in the failure's own words. */
  const read = (id: string) =>
    tasks.task({ _tag: "Implement", target: id }).pipe(
      Effect.map(({ text }) => ({ text })),
      Effect.catchTag("TaskFailure", (failure) => missing(failure.message))
    );

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
      // What an agent marks has to draw as designed: no token of it waiting for the code.
      implementation((s) => s.mark(id, files, true))
    );
    return { text: lineOf(item) };
  });

  /**
   * A behaviour note on a node of a page, or on a component's spec (a slot of it, named as the
   * node): what the code must do that a design cannot show.
   */
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
      const component = id.slice(SPEC_TARGET_PREFIX.length);
      yield* reported(
        project.service(SpecService)((specs) =>
          specs.addNote(component, text, node)
        )
      );
      return { text: `Noted on ${component}${node ? ` (${node})` : ""}.` };
    }
    const page = yield* pageAt(id, canvas);
    const { root } = yield* documents((d) => d.get(page.id));
    const found = node ? findNode(root, node) : null;
    if (node && !found) {
      return yield* missing(`no node ${node} in ${page.file}`);
    }
    yield* reported(
      project.service(CommentsService)((comments) =>
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
    );
    return { text: `Noted on ${page.file}${found ? ` (${found.id})` : ""}.` };
  });

  /**
   * The code's token values brought up to the design's, or the code's taken into the design (ADR
   * 0028): the tokens named, conflicts among them included, or what changed on one side alone.
   */
  const tokensTo = Effect.fnUntraced(function* (
    direction: "export" | "import",
    names: readonly string[]
  ) {
    const comparison = yield* reported(sync.tokens("code"));
    if (!comparison) {
      return yield* missing(
        "there is no design system yet to compare the code with: Sync makes one"
      );
    }
    const { decisions, left, unknown } = codeDirection(
      comparison.diffs,
      direction,
      names
    );
    if (unknown.length > 0) {
      return yield* missing(
        `neither the design system nor the code has ${unknown.join(", ")}`
      );
    }
    const { files, written } = yield* reported(
      sync.apply("code", decisions, direction, names)
    );
    const done = direction === "export" ? "to the code" : "into the design";
    const lines = [
      written === 0
        ? `Nothing to bring ${done}.`
        : `${plural(written, "token value")} brought ${done}${files.length > 0 ? `: ${files.join(", ")}` : ""}.`,
    ];
    if (left.length > 0) {
      lines.push(
        `Changed on both sides, left for the user: ${left
          .map(
            (d) =>
              `${baselineKey(d.name, d.theme)} (code ${d.source ?? "none"}, design ${d.design ?? "none"})`
          )
          .join(
            ", "
          )}. Ask which value to keep, then export or import them by name.`
      );
    }
    return { text: lines.join(" ") };
  });

  return HandoffTools.of({
    handoff: Effect.fn("EditorTools.handoff")(function* ({
      action,
      canvas,
      files,
      node,
      target,
      text,
      tokens,
    }) {
      if (action === "list") {
        return yield* list;
      }
      if (action === "export" || action === "import") {
        return yield* tokensTo(action, tokens ?? []);
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
