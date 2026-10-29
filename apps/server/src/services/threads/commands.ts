/**
 * Commands a prompt may start with, declared in contracts' `tasks` (`slashCommands`). The
 * composer offers them after a `/`; the server reads one as the request it is (`parseCommand`)
 * and gives the agent the task the request stands for (`tasks.ts`) instead of what was typed,
 * which the transcript keeps. A command that names something that is not there becomes a task
 * that tells the user why.
 */
import {
  parseCommand,
  slashCommands,
  taskPurpose,
} from "@ultrapaint/contracts/tasks";
import type { SlashCommand } from "@ultrapaint/contracts/threads";
import { Context, Effect, Layer } from "effect";
import { AppLog } from "../../app-log.ts";
import { STEPS_NEXT } from "./setup-tasks.ts";
import { type AgentTask, AgentTasks } from "./tasks.ts";

/** What the agent is told when what the user ran cannot be done as asked, and what to say. */
const failedTask = (failure: {
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

      return SlashCommands.of({ expand, list: slashCommands });
    })
  );
}
