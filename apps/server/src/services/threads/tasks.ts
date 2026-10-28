/**
 * The tasks agents are given: a typed request (contracts' `TaskRequest`) in, the task's text and
 * the purpose of the thread that runs it out (ADR 0030), or a `TaskFailure` that says why the
 * request cannot be one. A slash command is one way in (`commands.ts`, which reads what the user
 * typed); the handoff tool asks for a design's task directly, and the setup's steps name theirs
 * (`setup-steps.ts`). The texts are written in `page-tasks.ts`, `setup-tasks.ts` and
 * `sync-tasks.ts`, with what an agent does with and without the editor's tools in
 * `agent-ways.ts`, and `/init`'s here.
 */
import {
  commandNameOf,
  type TaskRequest,
  taskPurpose,
} from "@ultrapaint/contracts/tasks";
import type { ThreadPurpose } from "@ultrapaint/contracts/threads";
import { Context, Effect, Layer } from "effect";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { DesignSystemService } from "../design-system.ts";
import { RepoPaths } from "../repo-paths.ts";
import { agentWays } from "./agent-ways.ts";
import { makePageTasks } from "./page-tasks.ts";
import { makeSetupTasks } from "./setup-tasks.ts";
import { makeSyncTasks } from "./sync-tasks.ts";
import { DESIGN_MD_GUIDE, TaskFailure, userAdds } from "./task-text.ts";

/** A task: what the agent is told, and what the thread that runs it is for. */
export interface AgentTask {
  readonly purpose: ThreadPurpose;
  readonly text: string;
}

export class AgentTasks extends Context.Service<
  AgentTasks,
  {
    /** The task a request stands for, with what the project knows filled in. */
    readonly task: (
      request: TaskRequest
    ) => Effect.Effect<AgentTask, TaskFailure>;
  }
>()("ultrapaint/server/AgentTasks") {
  static readonly layer = Layer.effect(
    AgentTasks,
    Effect.gen(function* () {
      const project = yield* ProjectManager;
      const { mcp } = yield* ServerConfig;
      const ways = agentWays(mcp);

      /** What `/init` asks for, which Define asks for too when it adopts the theme. */
      const importSteps = project.use(
        Effect.gen(function* () {
          const paths = yield* RepoPaths;
          const { designSystem, document } = yield* (yield* DesignSystemService)
            .get;
          const { settings } = paths;
          const libraries =
            settings.libraryDirs.join(", ") || "the component library";
          const before = `${
            designSystem
              ? `
   A design system was imported before: ${ways.readDesignSystem(settings.designsDir)}. Update
   it rather than start over, and ask only about what changed.`
              : ""
          }${
            document && !designSystem
              ? `
   The repository has a DESIGN.md (${document.path}): it says what the product is meant to
   look like. Start from it, keep what it says, and keep its sections; its tokens are compared
   with the design system's in Sync afterwards.`
              : ""
          }`;
          return `1. ${ways.readTheme(settings.hostCss.join(", ") || "none configured yet", before)}
2. Look at what the scan cannot see: the design system's packages (${libraries}), their READMEs,
   AGENTS.md and docs, Storybook stories, style guides, and how the application's own screens use
   the tokens and components.
3. Ask the user, here in the thread, what you cannot find out yourself, a few questions at a
   time, and wait for the answers: what the application is and who uses it, which colours are
   the brand and which are semantic, which text styles the product uses, what to always or never
   do. Skip what you already know.
4. ${ways.saveDesignSystem(settings.designsDir)}
   - colors: groups of tokens, the semantic colours first ("Semantic"), then one group per
     palette. Keep only what the product uses; say in \`description\` what a colour is for.
   - typography.styles: the named text styles the product uses, each one a size, a weight and
     a line height (and a font and tracking when it sets them) that a text is set in as one
     thing, in three groups: \`group\` heading (Heading xxl… Heading xs, with role heading and
     a level), body (Body lg, Body, Body sm, role paragraph) and other (Caption, Label, Code).
     Use tokens such as "$text-4xl", "$font-weight-bold" and "$leading-tight". The scan starts
     you off with a scale built from the theme: keep what the product uses, rename and fix the
     rest, drop what it does not have.
   - components: for each component a designer would place, by export name: \`category\`,
     \`description\`, \`exampleProps\` that make it render something meaningful on its own (a
     dialog open, a select with options, a badge with a variant) and \`exampleText\` for one
     that takes text as children.
   - elevation: the levels, lowest first (Sunken, Default, Raised, Overlay), each a \`surface\`
     colour token, the \`shadow\` that goes with it, and the z-index \`layer\` of those that
     overlap. The scan starts you off from the semantic surfaces; fix it from how the product's
     cards, menus and dialogs are styled.
   - borderWidths, layout (breakpoints, containers) and motion (easings, durations,
     animations): the scan reads them from the theme; keep what the product uses and say in
     \`description\` what each is for. A project that hard-codes durations or border widths in
     its components has them read from there.
   - icons: the package the product's icons come from, the sizes it uses, and in
     \`description\` how they are used (stroke width, with or without labels).
   - DESIGN.md: ${DESIGN_MD_GUIDE}`;
        })
      );

      /**
       * What a task says when the editor sees no components: the settings point nowhere. The
       * agent must not try to fix them itself (it has guessed paths before); the user does, in
       * the Sync view, which detects them.
       */
      const componentsMissing = project
        .use(
          Effect.gen(function* () {
            const { settings } = yield* RepoPaths;
            const count =
              settings.libraryDirs.length === 0
                ? 0
                : yield* (yield* CatalogueService).get(false).pipe(
                    Effect.map((c) => c.components.length),
                    Effect.orElseSucceed(() => 0)
                  );
            if (count > 0) {
              return "";
            }
            const where =
              settings.libraryDirs.length === 0
                ? "no component directory is configured"
                : `${settings.libraryDirs.join(", ")} has no components the editor can read`;
            return `Before anything else: the editor sees no components (${where}). Do not write or edit
ultrapaint.config.json or any other configuration to fix it. Tell the user to open the Design
system panel and press Sync, which finds the components and asks them to confirm, then stop.
Go on without components only if the user says the project has none.

`;
          })
        )
        .pipe(Effect.orElseSucceed(() => ""));

      const init = (extra: string | undefined) =>
        Effect.zipWith(
          importSteps,
          componentsMissing,
          (steps, missing) => `<ultrapaint-task command="init">
${missing}Import this repository's design system into ultrapaint, so that designs are drawn with its
tokens and components and every agent knows its conventions. Only Tailwind v4 is supported.

${steps}
5. End with a short summary: what you wrote, and what you were unsure of.
${userAdds(extra)}</ultrapaint-task>`
        );

      const pageTasks = yield* makePageTasks({ componentsMissing, ways });
      const { setupStep } = yield* makeSetupTasks({ importSteps, ways });
      const { sync } = yield* makeSyncTasks({ ways });

      const textOf = Effect.fnUntraced(function* (request: TaskRequest) {
        switch (request._tag) {
          case "Init":
            return yield* init(request.extra);
          case "Implement":
            return yield* pageTasks.implement(request);
          case "Adopt":
            return yield* pageTasks.adopt(request.targets);
          case "ImportFigma":
            return yield* pageTasks.importFigma(request);
          case "Redraw":
            return yield* pageTasks.redraw(request);
          case "Components":
            return yield* pageTasks.components(request);
          case "SetupStep":
            return yield* setupStep(request);
          case "Sync":
            return yield* sync(request);
          default:
            return request satisfies never;
        }
      });

      const task = (request: TaskRequest) =>
        textOf(request).pipe(
          Effect.map((text) => ({ purpose: taskPurpose(request), text })),
          // What the project or a service could not give: the reason is the error's own.
          Effect.mapError((error) =>
            error._tag === "TaskFailure"
              ? error
              : new TaskFailure({
                  command: commandNameOf(request),
                  message: error.message,
                })
          ),
          Effect.withSpan("AgentTasks.task", {
            attributes: { task: request._tag },
          })
        );

      return AgentTasks.of({ task });
    })
  );
}
