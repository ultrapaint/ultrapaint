/**
 * The tasks agents are given: a typed request (contracts' `TaskRequest`) in, the task's text and
 * the purpose of the thread that runs it out (ADR 0030), or a `TaskFailure` that says why the
 * request cannot be one. A slash command is one way in (`commands.ts`, which reads what the user
 * typed); the handoff tool asks for a design's task directly, and the setup's steps name theirs
 * (`setup-steps.ts`). The texts are written in `page-tasks.ts`, `setup-tasks.ts` and
 * `sync-tasks.ts` and `folder-setup.ts`, with what an agent does with and without the editor's
 * tools in `agent-ways.ts`, and `/init`'s here.
 */
import {
  commandNameOf,
  type TaskRequest,
  taskPurpose,
} from "@ultrapaint/contracts/tasks";
import type { ThreadPurpose } from "@ultrapaint/contracts/threads";
import { Context, Effect, Layer } from "effect";
import { ServerConfig } from "../../config.ts";
import { OpenProject } from "../../project.ts";
import { DesignSystemService } from "../design-system.ts";
import { RepoPaths } from "../repo-paths.ts";
import { type AgentWays, agentWays } from "./agent-ways.ts";
import { makeFolderSetup } from "./folder-setup.ts";
import { makePageTasks } from "./page-tasks.ts";
import { makeSetupTasks } from "./setup-tasks.ts";
import { makeSyncTasks } from "./sync-tasks.ts";
import {
  DESIGN_MD_GUIDE,
  needsTools,
  TaskFailure,
  userAdds,
} from "./task-text.ts";

/** A task: what the agent is told, and what the thread that runs it is for. */
export interface AgentTask {
  readonly purpose: ThreadPurpose;
  readonly text: string;
}

export class AgentTasks extends Context.Service<
  AgentTasks,
  {
    /**
     * The task a request stands for, with what the project knows filled in, for an agent that has
     * the editor's tools (`tools`), or not; the server's MCP setting when it is not said.
     */
    readonly task: (
      request: TaskRequest,
      options?: { readonly tools?: boolean }
    ) => Effect.Effect<AgentTask, TaskFailure>;
  }
>()("ultrapaint/server/AgentTasks") {
  static readonly layer = Layer.effect(
    AgentTasks,
    Effect.gen(function* () {
      const project = yield* OpenProject;
      const { mcp } = yield* ServerConfig;

      /** The texts, worded for an agent with the editor's tools or without them. */
      const writtenFor = Effect.fnUntraced(function* (ways: AgentWays) {
        /** What `/init` asks for, which Define asks for too when it adopts the theme. */
        const importSteps = project.use(
          Effect.gen(function* () {
            const paths = yield* RepoPaths;
            const { designSystem, document } =
              yield* (yield* DesignSystemService).get;
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
2. Look at what the scan cannot see, in the repository: the design system's packages (${libraries}),
   their READMEs, AGENTS.md and docs, its Storybook stories and style guides, and how the
   application's own screens use the tokens.
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

        /** `/init`: the repository's design system imported, in the steps above. */
        const init = (extra: string | undefined) =>
          Effect.map(
            importSteps,
            (steps) => `<ultrapaint-task command="init">
Import this repository's design system into Ultrapaint, so that designs are drawn with its
tokens and every agent knows its conventions. Only Tailwind v4 is supported.

${steps}
5. End with a short summary: what you wrote, and what you were unsure of.
${userAdds(extra)}</ultrapaint-task>`
          );

        const folderSetup = yield* makeFolderSetup;
        const pageTasks = yield* makePageTasks({ ways });
        const { setupStep } = yield* makeSetupTasks({ importSteps, ways });
        const { sync } = yield* makeSyncTasks({ ways });

        return Effect.fnUntraced(function* (request: TaskRequest) {
          switch (request._tag) {
            case "Setup":
              return ways.tools === null
                ? yield* needsTools("setup", "Saving the setup")
                : yield* folderSetup(request.extra);
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
            case "SetupStep":
              return yield* setupStep(request);
            case "Sync":
              return yield* sync(request);
            default:
              return request satisfies never;
          }
        });
      });
      const withTools = yield* writtenFor(agentWays(true));
      const withoutTools = yield* writtenFor(agentWays(false));

      const task = (
        request: TaskRequest,
        options: { readonly tools?: boolean } = {}
      ) =>
        ((options.tools ?? mcp) ? withTools : withoutTools)(request).pipe(
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
