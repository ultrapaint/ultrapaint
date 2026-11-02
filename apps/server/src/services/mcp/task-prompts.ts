/**
 * The editor's tasks as MCP prompts: each slash command (contracts' `slashCommands`) is a prompt
 * of the same name whose message is the task `AgentTasks` writes, as a thread's command is
 * (`SlashCommands.expand`), worded for an agent with the tools. Its one argument is what follows
 * the command, completed from what the project has: pages, components and canvases. Claude Code
 * offers an MCP server's prompts as slash commands of its own; prompts cost no tool definition.
 */
import { SETUP_STEPS } from "@ultrapaint/contracts/design-system-setup";
import { SyncSource, slashCommands } from "@ultrapaint/contracts/tasks";
import { Effect, Layer, Schema } from "effect";
import { McpServer } from "effect/ai";
import { OpenProject } from "../../project.ts";
import { ComponentService } from "../components.ts";
import { FigmaImportService } from "../figma-import.ts";
import { PagesService } from "../pages.ts";
import { SlashCommands } from "../threads/commands.ts";

/** MCP's most values to one completion. */
const MOST = 100;

/** A canvas as a command writes it: `""` for the designs directory's own. */
const canvasWord = (id: string) => (id === "" ? '""' : id);

export const TaskPrompts = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* SlashCommands;
    const project = yield* OpenProject;

    /** The words a command's argument may be, from what the open project has. */
    const wordsOf = (command: string): Effect.Effect<readonly string[]> => {
      switch (command) {
        case "implement":
          return project
            .use(
              Effect.gen(function* () {
                const { pages } = yield* (yield* PagesService).list;
                const files = yield* (yield* ComponentService).components;
                return [
                  ...pages.map((p) => p.route ?? p.file),
                  ...files.map((c) => `component:${c.name}`),
                  "--adopt",
                ];
              })
            )
            .pipe(Effect.orElseSucceed(() => []));
        case "redraw":
          return project
            .use(Effect.flatMap(PagesService, (pages) => pages.list))
            .pipe(
              Effect.map((list) => list.canvases.map((c) => canvasWord(c.id))),
              Effect.orElseSucceed(() => [])
            );
        case "import-figma":
          return project
            .use(
              Effect.flatMap(FigmaImportService, (figma) =>
                Effect.map(figma.list, (all) => all.map((i) => i.name))
              )
            )
            .pipe(Effect.orElseSucceed(() => []));
        case "design-system":
          return Effect.succeed(
            SETUP_STEPS.filter((s) => s.agent).map((s) => s.id)
          );
        case "sync":
          return Effect.succeed(SyncSource.literals);
        default:
          return Effect.succeed([]);
      }
    };

    for (const { argument, description, name } of slashCommands) {
      yield* McpServer.registerPrompt({
        completion: {
          argument: (input: string) =>
            Effect.map(wordsOf(name), (words) =>
              [...new Set(words)]
                .filter((word) =>
                  word.toLowerCase().startsWith(input.trim().toLowerCase())
                )
                .slice(0, MOST)
            ),
        },
        content: ({ argument: given }) =>
          Effect.map(
            commands.expand(`/${name} ${given ?? ""}`.trim(), { tools: true }),
            (task) => task?.text ?? `/${name} ${given ?? ""}`
          ),
        description,
        name,
        parameters: {
          argument: Schema.optional(Schema.String).annotate({
            description: argument ?? "what to add to the task",
          }),
        },
      });
    }
  })
);
