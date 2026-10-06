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
import { missing, opt, reported, ToolFailure } from "./tools.ts";

const Failure = ToolFailure;

const FinishSetupStep = Tool.make("finish_setup_step", {
  description:
    "End your setup step, with a few lines for the user: what you did and were unsure of.",
  failure: Failure,
  parameters: Schema.Struct({ summary: Schema.String }),
  success: Schema.Struct({ status: Schema.String, step: Schema.String }),
});

/**
 * A decision as an agent passes it: optional keys, not unions with null. Kind `figma` matches a
 * Figma variable or style (`value`, where it is in Figma) to the code's token (`target`, added
 * when the code does not declare it), or leaves it out of the code (`keep`), for the sync.
 */
const MapEntry = Schema.Struct({
  keep: opt(Schema.Boolean),
  kind: Schema.Literals([...UsageKind.literals, "figma"]),
  note: opt(Schema.String),
  target: opt(Schema.String),
  value: Schema.String,
});

const MapValues = Tool.make("map_values", {
  description:
    'Decide values: target a token (color-primary, text-sm), a layer ("50") or a component (Button), or keep: true.',
  failure: Failure,
  parameters: Schema.Struct({ entries: Schema.Array(MapEntry) }),
  success: Schema.Struct({
    problems: Schema.Array(Schema.String),
    saved: Schema.Number,
    undecided: Schema.Number,
  }),
});

const NextBatch = Tool.make("next_batch", {
  description:
    "Migrate: ends the batch under way with done (a line on it), rewrites the next and returns what is left in its files; batch is null when none is.",
  failure: Failure,
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
});

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
      finish_setup_step: Effect.fnUntraced(function* ({ summary }) {
        const threadId = yield* caller;
        const step = yield* reported(setup.finish(threadId, summary));
        return { status: step.status, step: step.id };
      }),

      map_values: Effect.fnUntraced(function* ({ entries }) {
        const values = entries.flatMap((e) =>
          e.kind === "figma" ? [] : [{ ...e, kind: e.kind }]
        );
        const figma = entries.filter((e) => e.kind === "figma");
        const matched =
          figma.length > 0
            ? yield* reported(
                sync.matchFigma(
                  figma.map((e) => ({
                    to: e.keep ? null : e.target,
                    variable: e.value,
                  })),
                  "agent"
                )
              )
            : { problems: [], saved: 0, unmatched: 0 };
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

      next_batch: Effect.fnUntraced(function* ({ done }) {
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
