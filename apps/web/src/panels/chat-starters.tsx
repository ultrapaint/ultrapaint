/**
 * A new thread before its first prompt: a few ways to start that can act now, just above the
 * composer they fill, offered while nothing is typed there. Each one only writes the prompt into
 * the composer; nothing is sent until the user sends it. With something attached (or selected,
 * which goes along), they work on it, in words for what it is and how many: elements, pages, a
 * board's tokens, components or guidelines. With nothing, on a new page or the page shown. A
 * folder whose settings were detected and not saved is offered its setup first (`/setup`), which
 * nothing starts on its own (ADR 0073).
 */
import { commandOf } from "@ultrapaint/contracts/tasks";
import type { Thread } from "@ultrapaint/contracts/threads";
import { Button } from "@/components/ui/button";
import { CutText } from "../components/cut-text.tsx";
import { useBoardChip } from "../lib/add-to-chat.ts";
import { type Chip, isPlace, useChips } from "../state/attachments.ts";
import { useDraft } from "../state/drafts.ts";
import { useEditor } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";

interface Starter {
  readonly label: string;
  /** What it writes into the composer; one ending in a space is left open for the rest. */
  readonly prompt: string;
}

const TO_THE_SYSTEM = "its spacing scale, text styles and colour tokens";

/** What a prompt is about, as its starters word it. */
type Subject = "element" | "page" | "component" | "style" | "guideline";

const subjectOf = (chip: Chip): Subject => {
  if (chip.kind === "page") {
    return "page";
  }
  if (chip.kind !== "board") {
    return "element";
  }
  if (chip.pick === "systemComponent" || chip.pick === "appComponent") {
    return "component";
  }
  return chip.pick === "guideline" ? "guideline" : "style";
};

/** The starters' words for one thing or several: "it" or "them", and the noun the prompt says. */
const wordsOf = (subject: Subject, count: number) => {
  const one = count === 1;
  const nouns: Record<Subject, string> = {
    component: "component",
    element: "element",
    guideline: "guideline",
    page: "page",
    style: "token",
  };
  const noun = `attached ${nouns[subject]}${one ? "" : "s"}`;
  return {
    it: one ? "it" : "them",
    its: one ? "its" : "their",
    the: `the ${noun}`,
  };
};

/** The ways to start on what is attached, by what it is and how many. */
const attachedStarters = (
  subjects: readonly Subject[],
  implementRoute: string | null
): Starter[] => {
  const [first] = subjects;
  if (!first) {
    return [];
  }
  // Things of several kinds share one way to start, which says them all.
  if (subjects.some((s) => s !== first)) {
    return [
      {
        label: "Match them to the design system",
        prompt: `Match what is attached to the design system: ${TO_THE_SYSTEM}`,
      },
    ];
  }
  const subject = first;
  const { it, its, the } = wordsOf(subject, subjects.length);
  const one = subjects.length === 1;
  const match: Starter = {
    label: `Match ${it} to the design system`,
    prompt: `Match ${the} to the design system: ${TO_THE_SYSTEM}`,
  };
  switch (subject) {
    case "style":
      return [
        {
          label: `Use ${it} where pages set ${its} value by hand`,
          prompt: `Use ${the} wherever the pages set the same value by hand`,
        },
      ];
    case "guideline":
      return [
        {
          label: `Check the pages against ${it}`,
          prompt: `Check the pages against ${the}, and list where they break ${it}`,
        },
      ];
    default:
      break;
  }
  const variants: Starter = {
    label: one ? "Make three variants of it" : "Make three variants of each",
    prompt: one
      ? `Make three variants of ${the}`
      : `Make three variants of each of ${the}`,
  };
  const states: Starter = {
    label: `Design ${its} empty, loading and error states`,
    prompt: `Design the empty, loading and error states of ${the}`,
  };
  if (subject === "component") {
    return [variants, states, match];
  }
  if (subject === "page") {
    return [
      variants,
      states,
      match,
      ...(implementRoute
        ? [{ label: "Implement it", prompt: `/implement ${implementRoute}` }]
        : []),
    ];
  }
  return [
    variants,
    states,
    match,
    {
      label: one
        ? "Implement it as a component"
        : "Implement them as components",
      prompt: one
        ? `Implement ${the} as a component`
        : `Implement ${the} as components`,
    },
  ];
};

const useStarters = (threadId: string): readonly Starter[] => {
  const selection = useEditor((s) => s.selection);
  const boardChip = useBoardChip();
  const places = useChips(threadId).filter(isPlace);
  const activePage = useEditor((s) => s.activePage);
  const pages = useProject((s) => s.pages);
  const page = pages.find((p) => p.id === activePage);
  const info = useProject((s) => s.info);
  // What is attached, or else what goes along with the prompt: the selection, a board's pick.
  let subjects: Subject[] = places.map(subjectOf);
  if (subjects.length === 0 && selection) {
    subjects = ["element"];
  } else if (subjects.length === 0 && boardChip) {
    subjects = [subjectOf(boardChip)];
  }
  if (subjects.length > 0) {
    const [only] = places;
    const attachedPage =
      places.length === 1 && only?.kind === "page"
        ? pages.find((p) => p.id === only.pageId)
        : undefined;
    return attachedStarters(
      subjects,
      attachedPage ? (attachedPage.route ?? attachedPage.id) : null
    );
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

/**
 * A new thread's ways to start, as the chat list offers its own: quiet filled buttons, each as
 * wide as its words, stacked on the composer's edge just above it. They are drawn only while
 * nothing is typed, so a starter never takes the place of a draft; the space they had stays, so
 * the composer keeps its place at the panel's foot.
 */
export const ChatStarters = ({ thread }: { thread: Thread }) => {
  const starters = useStarters(thread.id);
  const typed = useDraft(thread.id).trim() !== "";
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pt-4 pb-6">
      {typed ? null : (
        <ul aria-label="Ways to start" className="mt-auto flex flex-col gap-2">
          {starters.map((starter) => (
            <li className="flex min-w-0" key={starter.label}>
              <Button
                className="min-w-0 max-w-full"
                onClick={() =>
                  showLeftPanel({ chat: thread.id, draft: starter.prompt })
                }
                variant="secondary"
              >
                <CutText className="min-w-0 truncate">{starter.label}</CutText>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
