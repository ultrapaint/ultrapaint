/**
 * A new thread before its first prompt: a few ways to start that can act now, just above the
 * composer they fill. Each one only writes the prompt into the composer; nothing is sent until the
 * user sends it. With something attached (or selected, which goes along), they work on it; with
 * nothing, on a new page or the page shown. A folder whose settings were detected and not saved
 * is offered its setup first (`/setup`), which nothing starts on its own (ADR 0073).
 */
import { commandOf } from "@ultrapaint/contracts/tasks";
import type { Thread } from "@ultrapaint/contracts/threads";
import { isPlace, useChips } from "../state/attachments.ts";
import { useEditor } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";

interface Starter {
  readonly label: string;
  /** What it writes into the composer; one ending in a space is left open for the rest. */
  readonly prompt: string;
}

const TO_THE_SYSTEM = "its spacing scale, text styles and colour tokens";

const useStarters = (threadId: string): readonly Starter[] => {
  const selection = useEditor((s) => s.selection);
  const attached = useChips(threadId).some(isPlace) || selection !== null;
  const activePage = useEditor((s) => s.activePage);
  const page = useProject((s) => s.pages.find((p) => p.id === activePage));
  const info = useProject((s) => s.info);
  if (attached) {
    return [
      {
        label: "Make three variants of it",
        prompt: "Make three variants of the attached element",
      },
      {
        label: "Design its empty, loading and error states",
        prompt:
          "Design the empty, loading and error states of the attached element",
      },
      {
        label: "Match it to the design system",
        prompt: `Match the attached element to the design system: ${TO_THE_SYSTEM}`,
      },
      {
        label: "Implement it as a component",
        prompt: "Implement the attached element as a component",
      },
    ];
  }
  // The page shown, by the name its frame carries; the command takes its URL, or its file.
  return [
    ...(info.configured && info.setup === "detected"
      ? [
          {
            label: `Set up ${info.name ?? "this folder"}`,
            prompt: commandOf({ _tag: "Setup" }),
          },
        ]
      : []),
    { label: "Design a new page for…", prompt: "Design a new page for " },
    ...(page
      ? [
          {
            label: `Match ${page.name} to the design system`,
            prompt: `Match the page ${page.route ?? page.id} to the design system: ${TO_THE_SYSTEM}`,
          },
          {
            label: `Implement ${page.name}`,
            prompt: `/implement ${page.route ?? page.id}`,
          },
        ]
      : []),
  ];
};

/** A new thread's ways to start, each a row that writes its prompt into the composer. */
export const ChatStarters = ({ thread }: { thread: Thread }) => {
  const starters = useStarters(thread.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-auto px-3 pt-4 pb-2">
      <ul className="flex flex-col gap-0.5">
        {starters.map((starter) => (
          <li key={starter.label}>
            <button
              className="-mx-1.5 block min-h-7 w-[calc(100%+0.75rem)] rounded-md px-1.5 py-1 text-left font-body-medium outline-none transition-colors duration-100 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                showLeftPanel({ chat: thread.id, draft: starter.prompt })
              }
              type="button"
            >
              {starter.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
