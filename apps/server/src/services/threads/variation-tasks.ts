/**
 * `/variations` (ADR 0098): takes on a thing of the canvas, made in working copies the server
 * prepares before the turn (`variation-rounds.ts`), each handed in by renaming it. The task
 * names the thing, its copies, what should vary, and the takes it has already, so a new round
 * makes takes unlike those.
 */
import { componentOfDoc } from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  VARIATIONS_COMMAND,
  type VariationsTask,
} from "@ultrapaint/contracts/tasks";
import {
  TAKE_NAME_SEPARATOR,
  targetOfRef,
  type VariationSet,
  type VariationTarget,
} from "@ultrapaint/contracts/variations";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { plural } from "@ultrapaint/shared/text";
import { Effect } from "effect";
import { OpenProject } from "../../project.ts";
import { type RoundStart, VariationRounds } from "../variation-rounds.ts";
import { VariationsService } from "../variations.ts";
import type { AgentWays, ToolNames } from "./agent-ways.ts";
import { needsTools, taskFailure } from "./task-text.ts";

const COMMAND = VARIATIONS_COMMAND;

/** What a take of the thing is, by its kind (ADR 0098). */
const takeOfKind = (thing: DesignNode) => {
  switch (thing.type) {
    case "text":
      return "A take of a text is its words: change what it says, and nothing else of it.";
    case "image":
      return "A take of an image is another picture: one of the project's own (its assets), or one you can reach; change its src, and its alt to match.";
    default:
      return "A take is its subtree drawn another way, with the design system's components and tokens. Keep the ids of the nodes you keep.";
  }
};

/** The takes it has already, so that the new ones are unlike them. */
const madeBefore = (set: VariationSet | undefined) => {
  if (set === undefined) {
    return "";
  }
  const inUse = set.variations.find((v) => v.id === set.inUse);
  const others = set.variations.filter((v) => v.id !== set.inUse);
  const line = (v: { readonly name: string; readonly varied?: string }) =>
    `- ${v.name}${v.varied ? `: ${v.varied}` : ""}`;
  return `
It has variations already. ${inUse ? `In use: ${inUse.name}.` : "None is in use."} Made before:
${others.map(line).join("\n") || "- none"}
Make takes unlike these.
`;
};

/** Where the thing is, as the task says it. */
const whereOf = (page: Page | null, doc: string) => {
  if (page !== null) {
    return `${page.route ?? page.file} (the page ${page.name}, canvas ${JSON.stringify(page.canvas)})`;
  }
  const component = componentOfDoc(doc);
  return component === null
    ? "the canvas, beside the pages"
    : `the component ${component}'s main tree`;
};

/** The task's text: the thing, what should vary, the takes it has, and its working copies. */
const taskText = ({
  request,
  set,
  started,
  target,
  tools,
}: {
  readonly request: VariationsTask;
  readonly set: VariationSet | undefined;
  readonly started: RoundStart;
  readonly target: VariationTarget;
  readonly tools: ToolNames;
}) => {
  const { copies, page, thing, whole } = started;
  const what = whole
    ? "the whole page"
    : `${nodeLabel(thing)} (node ${target.node})`;
  const named = `“Editorial${TAKE_NAME_SEPARATOR}Tone of the copy”`;
  return `<ultrapaint-task command="${COMMAND}">
Make ${plural(copies.length, "take")} on ${what}, in ${whereOf(page, target.doc)}: clearly
different takes, within the design system, for the user to choose from. They are kept as its
variations; the one in use stays as it is.
What should vary: ${request.vary || "you choose: what would make the most difference here"}
${madeBefore(set)}
${takeOfKind(thing)}

Each take has a working copy, ${page === null ? "a page holding it alone" : "a copy of the page"}, which the canvas does not show:
${copies.map((c, i) => `${i + 1}. ${c.file}`).join("\n")}

For each copy, one at a time, so the user can look at the first while you make the others:
1. Change node ${target.node} and what is inside it, in the copy, with ${tools.read_page} and ${tools.apply_operations},
   route the copy's file. Change nothing else of the copy, and nothing outside it: not the page
   itself.
2. Look at it with ${tools.get_screenshot} (route the copy's file, node ${target.node}) and fix what is off.
3. Hand it in: ${tools.rename_page} with route the copy's file and name the take's name and what it
   varied, ${named}. That saves it as a variation and removes the copy.
End with one line per take: its name and what it varied.
</ultrapaint-task>`;
};

export const makeVariationTasks = Effect.fnUntraced(function* ({
  ways,
}: {
  readonly ways: AgentWays;
}) {
  const project = yield* OpenProject;

  const variations = (request: VariationsTask, thread: string | undefined) =>
    Effect.gen(function* () {
      const { tools } = ways;
      if (tools === null) {
        return yield* needsTools(COMMAND, "Making variations");
      }
      const target = targetOfRef(request.target);
      if (target === null) {
        return yield* taskFailure(
          COMMAND,
          `${request.target} names no node`,
          "Ask which element to vary."
        );
      }
      if (thread === undefined) {
        return yield* taskFailure(
          COMMAND,
          "variations are made in a chat of the editor's",
          "Tell the user to ask for them from the canvas."
        );
      }
      const started = yield* project.use(
        Effect.flatMap(VariationRounds, (rounds) =>
          rounds.start({
            count: request.count,
            target,
            thread,
            vary: request.vary,
          })
        )
      );
      const sets = yield* project.use(
        Effect.flatMap(VariationsService, (v) => v.sets(target.doc))
      );
      return taskText({
        request,
        set: sets[target.node],
        started,
        target,
        tools,
      });
    });

  return { variations };
});
