/**
 * Commands a prompt may start with. The composer offers them after a `/`; the server reads one
 * as the request it is (contracts' `parseCommand`) and gives the agent the task the request
 * stands for (`tasks.ts`) instead of what was typed, which the transcript keeps. A command that
 * names something that is not there becomes a task that tells the user why.
 */
import { parseCommand, taskPurpose } from "@ultrapaint/contracts/tasks";
import type { SlashCommand } from "@ultrapaint/contracts/threads";
import { Context, Effect, Layer } from "effect";
import { AppLog } from "../../app-log.ts";
import { STEPS_NEXT } from "./setup-tasks.ts";
import { type AgentTask, AgentTasks } from "./tasks.ts";

const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    description:
      "Import the repository's design system: tokens, text styles, components and conventions",
    name: "init",
  },
  {
    argument: "<page | component> | --adopt [canvas | page…]",
    description:
      "Turn a page or a component of the design into the application's own code; `--adopt` links pages built already to the files that implement them",
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
    argument: "[describe | figma | design | code]",
    description:
      "Bring the design system and the code together: opens Sync; `describe` has an agent describe what changed, `figma` match Figma's tokens to the design system's, `design` DESIGN.md's, `code` bring the code up to the design",
    name: "sync",
  },
];

/** What the agent is told when what the user ran cannot be done as asked, and what to say. */
export const failedTask = (failure: {
  readonly command: string;
  readonly message: string;
  readonly next: string;
}) => `<ultrapaint-task command="${failure.command}">
The user ran /${failure.command}, but ${failure.message}. ${failure.next}
</ultrapaint-task>`;

export class SlashCommands extends Context.Service<
  SlashCommands,
  {
    /**
     * The task a prompt stands for, and what the thread that runs it is for; null when it does
     * not start with a command this server knows (it then goes to the agent as it is, which may
     * have commands of its own). A task that could not be prepared at all (no project open) is
     * what was typed, and why it could not is in the log.
     */
    readonly expand: (text: string) => Effect.Effect<AgentTask | null>;
    readonly list: readonly SlashCommand[];
  }
>()("ultrapaint/server/SlashCommands") {
  static readonly layer = Layer.effect(
    SlashCommands,
    Effect.gen(function* () {
      const tasks = yield* AgentTasks;
      const log = yield* AppLog;

      const expand = Effect.fnUntraced(function* (text: string) {
        const parsed = parseCommand(text);
        if (parsed === null) {
          return null;
        }
        if (parsed._tag === "Invalid") {
          return {
            purpose: "design" as const,
            text: failedTask({ ...parsed, next: STEPS_NEXT }),
          };
        }
        const { request } = parsed;
        return yield* tasks.task(request).pipe(
          Effect.catch((failure) => {
            const { command, message, next } = failure;
            if (next !== undefined) {
              return Effect.succeed({
                purpose: taskPurpose(request),
                text: failedTask({ command, message, next }),
              });
            }
            // Without it, the agent's puzzled answer would be all the user sees.
            return Effect.as(
              log.log(
                "agent",
                "warn",
                `/${failure.command} was sent as typed: ${failure.message}`
              ),
              { purpose: taskPurpose(request), text }
            );
          })
        );
      });

      return SlashCommands.of({ expand, list: SLASH_COMMANDS });
    })
  );
}
