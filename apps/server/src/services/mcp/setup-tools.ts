/**
 * The tools of the design-system setup (ADR 0023), offered to agents over MCP: the decisions of
 * Map, the batches of Migrate, and the way an agent says its step is finished, which puts the
 * step in front of the user to review. What a step reads (the inventory, the mapping) comes in its
 * task instead: every session carries the tools on every turn, a task is read once.
 */
import {
  type MappingEntry,
  MigrationBatch,
  UsageKind,
  UsageLeft,
} from "@ultrapaint/contracts/design-system-setup";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { DesignSystemSetupService } from "../design-system-setup.ts";
import { DesignSystemSyncService } from "../design-system-sync.ts";
import { CallingThread } from "./access.ts";
import { doing, missing, opt, reported, ToolFailure } from "./tool-helpers.ts";

const FinishSetupStep = Tool.make("finish_setup_step", {
  description:
    "End your setup step, with a few lines for the user: what you did and were unsure of.",
  failure: ToolFailure,
  parameters: Schema.Struct({ summary: Schema.String }),
  success: Schema.Struct({ status: Schema.String, step: Schema.String }),
}).annotateMerge(doing("edit"));

/**
 * A decision as an agent passes it: optional keys, not unions with null. Kinds `figma` and
 * `design` match a token of the newest Figma import or of DESIGN.md (`value`, where it is there)
 * to the design system's token (`target`, added when it does not list it), or leave it out
 * (`keep`), for the sync (ADR 0028).
 */
const MapEntry = Schema.Struct({
  keep: opt(Schema.Boolean),
  kind: Schema.Literals([...UsageKind.literals, "figma", "design"]),
  note: opt(Schema.String),
  target: opt(Schema.String),
  value: Schema.String,
});

const MapValues = Tool.make("map_values", {
  description:
    'Decide values: target a token (color-primary, text-sm), a layer ("50") or a component (Button), or keep: true.',
  failure: ToolFailure,
  parameters: Schema.Struct({ entries: Schema.Array(MapEntry) }),
  success: Schema.Struct({
    problems: Schema.Array(Schema.String),
    saved: Schema.Number,
    undecided: Schema.Number,
  }),
}).annotateMerge(doing("edit", { idempotent: true }));

const NextBatch = Tool.make("next_batch", {
  description:
    "Migrate: ends the batch under way with done (a line on it), rewrites the next and returns what is left in its files; batch null when none is.",
  failure: ToolFailure,
  parameters: Schema.Struct({ done: opt(Schema.String) }),
  success: Schema.Struct({
    batch: Schema.NullOr(MigrationBatch),
    files: Schema.Array(
      Schema.Struct({
        changes: Schema.Number,
        file: Schema.String,
        left: Schema.Array(UsageLeft),
      })
    ),
    remaining: Schema.Number,
  }),
}).annotateMerge(doing("destructive"));

export const SetupTools = Toolkit.make(FinishSetupStep, MapValues, NextBatch);

const undecidedIn = (entries: readonly MappingEntry[]) =>
  entries.filter((e) => e.target === undefined && !e.keep).length;

export const SetupToolsLive = SetupTools.toLayer(
  Effect.gen(function* () {
    const setup = yield* DesignSystemSetupService;
    const sync = yield* DesignSystemSyncService;

    /** The thread calling, which a step's tools need. */
    const caller = Effect.gen(function* () {
      const threadId = yield* Effect.service(CallingThread);
      return threadId === undefined
        ? yield* missing(
            "only an agent in one of the editor's threads runs a setup step"
          )
        : threadId;
    });

    return {
      finish_setup_step: Effect.fn("SetupTools.finish_setup_step")(function* ({
        summary,
      }) {
        const threadId = yield* caller;
        const step = yield* reported(setup.finish(threadId, summary));
        return { status: step.status, step: step.id };
      }),

      map_values: Effect.fn("SetupTools.map_values")(function* ({ entries }) {
        const values = entries.flatMap((e) =>
          e.kind === "figma" || e.kind === "design"
            ? []
            : [{ ...e, kind: e.kind }]
        );
        const matchesOf = (kind: "design" | "figma") => {
          const listed = entries.filter((e) => e.kind === kind);
          return listed.length > 0
            ? reported(
                sync.match(
                  kind === "design" ? "designMd" : kind,
                  listed.map((e) => ({
                    to: e.keep ? null : e.target,
                    variable: e.value,
                  })),
                  "agent"
                )
              )
            : Effect.succeed({ problems: [], saved: 0, unmatched: 0 });
        };
        const figma = yield* matchesOf("figma");
        const design = yield* matchesOf("design");
        const matched = {
          problems: [...figma.problems, ...design.problems],
          saved: figma.saved + design.saved,
          unmatched: figma.unmatched + design.unmatched,
        };
        if (values.length === 0) {
          return {
            problems: matched.problems,
            saved: matched.saved,
            undecided: matched.unmatched,
          };
        }
        const result = yield* reported(setup.setMapping(values, "agent"));
        return {
          problems: [...result.problems, ...matched.problems],
          saved: result.applied + matched.saved,
          undecided: undecidedIn(result.mapping.entries) + matched.unmatched,
        };
      }),

      next_batch: Effect.fn("SetupTools.next_batch")(function* ({ done }) {
        const threadId = yield* caller;
        if (done !== undefined) {
          yield* reported(setup.finishBatch(threadId, done));
        }
        const next = yield* reported(setup.nextBatch(threadId));
        return next
          ? { batch: next.batch, files: next.files, remaining: next.remaining }
          : { batch: null, files: [], remaining: 0 };
      }),
    };
  })
);
