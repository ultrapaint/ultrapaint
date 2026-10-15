/**
 * Commands a prompt may start with. The composer offers them after a `/`; the server expands one
 * into the task it stands for before the agent sees the prompt, so the task is written once,
 * here, with what the project knows filled in — and the transcript still shows what the user
 * typed.
 */
import {
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
} from "@ultrapaint/contracts/design-system";
import type { SlashCommand } from "@ultrapaint/contracts/threads";
import { Context, Effect, Layer } from "effect";
import { AppLog } from "../../app-log.ts";
import { ServerConfig } from "../../config.ts";
import { ProjectManager } from "../../project.ts";
import { CatalogueService } from "../catalogue.ts";
import { DesignSystemService } from "../design-system.ts";
import { RepoPaths } from "../repo-paths.ts";
import { makePageTasks } from "./page-tasks.ts";
import { makeSetupTasks } from "./setup-tasks.ts";
import { makeSyncTasks } from "./sync-tasks.ts";
import { designSystemSchema, userAdds } from "./task-text.ts";

const COMMAND_RE = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/;

const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    description:
      "Import the repository's design system: tokens, text styles, components and conventions",
    name: "init",
  },
  {
    argument: "<page>",
    description: "Turn a page of the design into the application's own code",
    name: "implement",
  },
  {
    description:
      "Turn an imported Figma file into pages, with its components replaced by the repository's",
    name: "import-figma",
  },
  {
    argument: "<canvas> <what to change>",
    description:
      "Change every page of a canvas, a copy made to take another way: to wireframes, to finished screens",
    name: "redraw",
  },
  {
    argument: "<canvas>",
    description:
      "Draw a sheet of the design system's components, in each of their variants, into a canvas",
    name: "components",
  },
  {
    argument: "<step>",
    description:
      "Run a step of the design-system setup (Design system → Setup): define, map or migrate",
    name: "design-system",
  },
  {
    argument: "[describe | figma | design]",
    description:
      "Bring the design system and the code together: opens Sync; `describe` has an agent describe what changed, `figma` match Figma's tokens to the code's, `design` DESIGN.md's",
    name: "sync",
  },
];

export class SlashCommands extends Context.Service<
  SlashCommands,
  {
    /**
     * The task a prompt stands for, or null when it does not start with a command this server
     * knows (it then goes to the agent as it is, which may have commands of its own).
     */
    readonly expand: (text: string) => Effect.Effect<string | null>;
    readonly list: readonly SlashCommand[];
  }
>()("ultrapaint/server/SlashCommands") {
  static readonly layer = Layer.effect(
    SlashCommands,
    Effect.gen(function* () {
      const project = yield* ProjectManager;
      const { mcp } = yield* ServerConfig;
      const log = yield* AppLog;

      /** What `/init` asks for, which Define asks for too when it adopts the theme. */
      const importSteps = project.use(
        Effect.gen(function* () {
          const paths = yield* RepoPaths;
          const { designSystem } = yield* (yield* DesignSystemService).get;
          const { settings } = paths;
          const libraries =
            settings.libraryDirs.join(", ") || "the component library";
          const tools = mcp
            ? `1. Call scan_design_system. It reads the Tailwind v4 @theme blocks of the stylesheets the
   preview imports (${settings.hostCss.join(", ") || "none configured yet"}) and answers with a
   first design system, the files it read, and notes on what it could not interpret.${
     designSystem
       ? `
   A design system was imported before: read_design_system returns it with DESIGN.md. Update
   it rather than start over, and ask only about what changed.`
       : ""
   }`
            : `1. Read the stylesheets the preview imports (${settings.hostCss.join(", ") || "none configured yet"}) and
   their @theme blocks.`;
          const write = mcp
            ? `4. Save it with write_design_system: \`designSystem\` is the design-system.json object and
   \`notes\` the whole of DESIGN.md. get_document_format with kind "design-system" has its JSON
   Schema. The tool validates it and tells you what is wrong; fix it and call it again. Do not
   write the two files by hand.`
            : `4. Write ${settings.designsDir}/${DESIGN_SYSTEM_FILE}, valid against this JSON Schema:
   ${designSystemSchema()}
   and ${settings.designsDir}/${DESIGN_NOTES_FILE}.`;
          return `${tools}
2. Look at what the scan cannot see: the design system's packages (${libraries}), their READMEs,
   AGENTS.md and docs, Storybook stories, style guides, and how the application's own screens use
   the tokens and components.
3. Ask the user, here in the thread, what you cannot find out yourself, a few questions at a
   time, and wait for the answers: what the application is and who uses it, which colours are
   the brand and which are semantic, which text styles the product uses, what to always or never
   do. Skip what you already know.
${write}
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
   - DESIGN.md: what the application is and for whom, the voice and tone, layout conventions,
     which component to use for what, and what to avoid. Short and specific.`;
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

      const init = (extra: string) =>
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

      const { components, implement, importFigma, redraw } =
        yield* makePageTasks({ componentsMissing });
      const { designSystemStep } = yield* makeSetupTasks({ importSteps });
      const { syncCommand } = yield* makeSyncTasks;

      /**
       * A command that cannot be prepared is sent to the agent as it was typed. Why it could
       * not is in the log: without it, the agent's puzzled answer is all the user sees.
       */
      const orAsTyped =
        (name: string) =>
        <E extends { readonly message: string }>(
          prepared: Effect.Effect<string, E>
        ) =>
          prepared.pipe(
            Effect.catch((error) =>
              Effect.as(
                log.log(
                  "agent",
                  "warn",
                  `/${name} was sent as typed: ${error.message}`
                ),
                null
              )
            )
          );

      const expand = (text: string) => {
        const match: RegExpExecArray | null = COMMAND_RE.exec(text.trim());
        const name = match?.[1];
        const argument = match?.[2]?.trim() ?? "";
        if (name === "init") {
          return init(argument).pipe(orAsTyped(name));
        }
        if (name === "implement") {
          return implement(argument).pipe(orAsTyped(name));
        }
        if (name === "import-figma") {
          return importFigma(argument).pipe(orAsTyped(name));
        }
        if (name === "redraw") {
          return redraw(argument).pipe(orAsTyped(name));
        }
        if (name === "components") {
          return components(argument).pipe(orAsTyped(name));
        }
        if (name === "design-system") {
          return designSystemStep(argument).pipe(orAsTyped(name));
        }
        if (name === "sync") {
          return syncCommand(argument).pipe(orAsTyped(name));
        }
        return Effect.succeed(null);
      };

      return SlashCommands.of({ expand, list: SLASH_COMMANDS });
    })
  );
}
