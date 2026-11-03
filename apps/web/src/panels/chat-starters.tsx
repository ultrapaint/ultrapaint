/**
 * A new thread before its first prompt: the ways a chat usually starts. Each one only writes the
 * prompt into the composer; nothing is sent until the user sends it.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { type ReactNode, useRef } from "react";
import { importFigma } from "../lib/import-figma.ts";
import { useEditor } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";

interface Starter {
  readonly prompts: readonly string[];
  readonly title: string;
}

const useStarters = (): readonly Starter[] => {
  const activePage = useEditor((s) => s.activePage);
  // The command names a page by its URL, or by its file when it has none.
  const target = useProject((s) => {
    const page = s.pages.find((p) => p.id === activePage);
    return page ? (page.route ?? page.id) : undefined;
  });
  return [
    {
      prompts: [
        "Match the spacing to the design system’s scale",
        "Use the design system’s text styles",
        "Replace the raw colours with tokens",
      ],
      title: "Tidy and polish",
    },
    {
      prompts: [
        "Design a new page for ",
        "Make three variants of the attached element",
        "Design the empty, loading and error states",
      ],
      title: "Generate designs",
    },
    {
      prompts: [
        target ? `/implement ${target}` : "/implement ",
        "Implement the attached element as a component",
      ],
      title: "Implement in code",
    },
  ];
};

/** A prompt left open for the rest to be typed ends in an ellipsis. */
const shownPrompt = (prompt: string) =>
  prompt.endsWith(" ") ? `${prompt.trim()}…` : prompt;

const write = (threadId: string, text: string) =>
  showLeftPanel({ chat: threadId, draft: text });

/** A way to start, as a row: what it writes into the composer, or what it opens. */
const StarterRow = ({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) => (
  <button
    className="-mx-1.5 flex min-h-7 items-center rounded-md px-1.5 py-1 text-left font-body outline-none transition-colors duration-100 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);

const StarterGroup = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <section className="flex flex-col gap-0.5">
    <h3 className="pb-0.5 font-small text-muted-foreground">{title}</h3>
    {children}
  </section>
);

/**
 * A new thread before its first prompt: what the chat works on, then the usual ways to start,
 * each one a prompt written into the composer, and a Figma file to import.
 */
export const ChatStarters = ({ thread }: { thread: Thread }) => {
  const starters = useStarters();
  const figma = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-3 pt-4 pb-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-heading-xsmall">What’s next?</h3>
        <p className="text-pretty font-small text-muted-foreground">
          The agent works on what you attach. Select something on the canvas,
          then pick a start or write your own.
        </p>
      </div>
      {starters.map((starter) => (
        <StarterGroup key={starter.title} title={starter.title}>
          {starter.prompts.map((prompt) => (
            <StarterRow key={prompt} onClick={() => write(thread.id, prompt)}>
              {shownPrompt(prompt)}
            </StarterRow>
          ))}
        </StarterGroup>
      ))}
      <StarterGroup title="From Figma">
        <StarterRow onClick={() => figma.current?.click()}>
          Import a .fig file…
        </StarterRow>
        <input
          accept=".fig"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              importFigma(file);
            }
            e.target.value = "";
          }}
          ref={figma}
          type="file"
        />
      </StarterGroup>
    </div>
  );
};
