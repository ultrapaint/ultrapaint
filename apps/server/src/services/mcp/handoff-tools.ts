/**
 * The link between the designs and their code (ADR 0030), for agents in the editor and outside
 * it: what is ready or changed, the task that implements one, marking it implemented, writing
 * down behaviour the design cannot show, changing a component as its code now draws it (ADR
 * 0122), and bringing the code's tokens up to the design's (ADR 0028). One tool: every agent
 * carries every tool's schema on every turn.
 */

import { ComponentChange } from "@ultrapaint/contracts/components";
import {
  componentNameOf,
  type ImplementationItem,
  isComponentTarget,
} from "@ultrapaint/contracts/implementation";
import { baselineKey } from "@ultrapaint/contracts/sync";
import { plural } from "@ultrapaint/shared/text";
import { systemComponentOf } from "@ultrapaint/system-components/catalogue";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { OpenProject } from "../../project.ts";
import { ComponentService } from "../components.ts";
import { DesignSystemSyncService } from "../design-system-sync.ts";
import {
  type DesignTarget,
  DesignTargets,
  targetId,
} from "../design-targets.ts";
import { ImplementationService } from "../implementation.ts";
import { codeDirection } from "../sync-readings.ts";
import { HANDOFF_ACTIONS, TOOLS } from "../threads/agent-ways.ts";
import { AgentTasks } from "../threads/tasks.ts";
import {
  AnyObject,
  doing,
  missing,
  opt,
  reported,
  ToolFailure,
} from "./tool-helpers.ts";

const decodeChange = Schema.decodeUnknownEffect(ComponentChange);

/** The component a target names, `component:Button` or `Button`. */
const componentNamed = (target: string) => {
  const where = target.trim();
  return isComponentTarget(where) ? componentNameOf(where) : where;
};

const Handoff = Tool.make("handoff", {
  description:
    'Designs and their code. action "list": ready or changed; "read": target\'s task; "mark": target implemented by files; "note": what target (node) must do that a design cannot show (text); "change": component target by change {op,…}, renames followed in instances; "export"/"import": token values design→code/code→design, those named or all changed.',
  failure: ToolFailure,
  parameters: Schema.Struct({
    action: Schema.Literals(HANDOFF_ACTIONS),
    canvas: opt(Schema.String),
    /** One change to a component's file (`ComponentChange`), which the task says the ops of. */
    change: opt(AnyObject),
    files: opt(Schema.Array(Schema.String)),
    /** A page's node, or a component's part. */
    node: opt(Schema.String),
    /** A page (URL or file), or a component as component:Button. */
    target: opt(Schema.String),
    text: opt(Schema.String),
    /** Token names, `color-primary` or `color-primary@dark` for one theme. */
    tokens: opt(Schema.Array(Schema.String)),
  }),
  success: Schema.Struct({ text: Schema.String }),
}).annotateMerge(doing("destructive"));

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

export const HandoffTools = Toolkit.make(Handoff);

export const HandoffToolsLive = HandoffTools.toLayer(
  Effect.gen(function* () {
    const project = yield* OpenProject;
    const implementation = project.service(ImplementationService);
    const designTargets = project.service(DesignTargets);
    const components = project.service(ComponentService);
    const tasks = yield* AgentTasks;
    const sync = yield* DesignSystemSyncService;

    /** The design an agent named, by the one rule for design targets. */
    const targetOf = Effect.fnUntraced(function* (
      target: string | undefined,
      canvas: string | undefined
    ) {
      if (!target) {
        return yield* missing("say which design with target");
      }
      return yield* reported(designTargets((d) => d.resolve(target, canvas)));
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
      // Asked over MCP: the agent has the tools.
      tasks.task({ _tag: "Implement", target: id }, { tools: true }).pipe(
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
     * A behaviour note on a page or one of its nodes, or on a component (a part of it, named as
     * the node): what the code must do that a design cannot show.
     */
    const note = Effect.fnUntraced(function* (
      target: DesignTarget,
      node: string | undefined,
      text: string | undefined
    ) {
      if (!text) {
        return yield* missing("say in text what the code must do");
      }
      const added = yield* reported(
        designTargets((d) => d.addNote(target, text, node))
      );
      const on =
        target._tag === "Component" ? target.component.name : target.page.file;
      const where = added.nodeId ?? added.element;
      return { text: `Noted on ${on}${where ? ` (${where})` : ""}.` };
    });

    /**
     * The component a change names: a system component whether it has a file or not, its first
     * change starting it (UP-227), else one with a file.
     */
    const changedName = Effect.fnUntraced(function* (
      target: string | undefined,
      canvas: string | undefined
    ) {
      const system = target && systemComponentOf(componentNamed(target));
      if (system) {
        return system.name;
      }
      const named = yield* targetOf(target, canvas);
      if (named._tag !== "Component") {
        return yield* missing(
          `a page changes through ${TOOLS.apply_operations}: change takes a component (target component:<Name>)`
        );
      }
      return named.component.name;
    });

    /**
     * One change to a component's file (ADR 0122), made through `ComponentService.change` as the
     * editor makes it: a property or a member renamed or taken out follows into every
     * instance's props, in one undo step; a system component with no file has it started from
     * its default look in that step (UP-227). A page changes through its own tool.
     */
    const change = Effect.fnUntraced(function* (
      target: string | undefined,
      canvas: string | undefined,
      given: unknown
    ) {
      const name = yield* changedName(target, canvas);
      if (given === undefined) {
        return yield* missing(
          "say the change in change: one {op, …} of the component"
        );
      }
      const made = yield* decodeChange(given).pipe(
        Effect.mapError(
          (error) =>
            new ToolFailure({
              message: `change is no component change: ${error.message}`,
            })
        )
      );
      const { file } = yield* reported(components((c) => c.change(name, made)));
      // A look whose file did not read takes a change that adds no problem: say what is left.
      const { components: entries } = yield* reported(
        components((c) => c.list)
      );
      const left = entries.find((e) => e.file === file)?.problem;
      return {
        text: left
          ? `Changed ${name}; its file still does not read: ${left}`
          : `Changed ${name}.`,
      };
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
        change: given,
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
        if (action === "change") {
          return yield* change(target, canvas, given);
        }
        const named = yield* targetOf(target, canvas);
        if (action === "read") {
          return yield* read(targetId(named));
        }
        if (action === "mark") {
          return yield* mark(targetId(named), files);
        }
        return yield* note(named, node, text);
      }),
    });
  })
);
