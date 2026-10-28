/**
 * A new thread before its first prompt: the ways a chat usually starts. Each one only writes the
 * prompt into the composer; nothing is sent until the user sends it.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import {
  ArrowUpRight,
  ChevronDown,
  Code,
  CornerDownRight,
  FileInput,
  LayoutTemplate,
  type LucideIcon,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useRef, useState } from "react";
import { importFigma } from "../lib/import-figma.ts";
import { useEditor } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";

interface Starter {
  readonly description: string;
  readonly icon: LucideIcon;
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
      description: "Bring what is attached back onto the design system",
      icon: WandSparkles,
      prompts: [
        "Match the spacing to the design system's scale",
        "Use the design system's text styles",
        "Replace the raw colours with tokens",
      ],
      title: "Tidy and polish",
    },
    {
      description: "New pages and variants from a prompt",
      icon: LayoutTemplate,
      prompts: [
        "Design a new page for ",
        "Make three variants of the attached element",
        "Design the empty, loading and error states",
      ],
      title: "Generate designs",
    },
    {
      description: "Write the page with your components",
      icon: Code,
      prompts: [
        target ? `/implement ${target}` : "/implement ",
        "Implement the attached element as a component",
      ],
      title: "Implement in code",
    },
  ];
};

const write = (threadId: string, text: string) =>
  showLeftPanel({ chat: threadId, draft: text });

const StarterGroup = ({
  onToggle,
  open,
  starter,
  threadId,
}: {
  onToggle: () => void;
  open: boolean;
  starter: Starter;
  threadId: string;
}) => {
  const Icon = starter.icon;
  return (
    <div
      className={cn("flex flex-col rounded-lg border", open && "bg-muted/30")}
    >
      <button
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onToggle}
        type="button"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-heading-xsmall">{starter.title}</span>
          <span className="truncate font-body text-muted-foreground">
            {starter.description}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-1 px-3 pb-2.5">
          {starter.prompts.map((prompt) => (
            <button
              className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              key={prompt}
              onClick={() => write(threadId, prompt)}
              type="button"
            >
              <CornerDownRight className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">{prompt.trim()}</span>
              <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const ChatStarters = ({ thread }: { thread: Thread }) => {
  const starters = useStarters();
  const [open, setOpen] = useState<string | null>(starters[0]?.title ?? null);
  const figma = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto px-4 pt-10 pb-4">
      <span className="flex size-11 items-center justify-center rounded-full border border-agent/50 bg-agent/15 text-agent">
        <Sparkles className="size-5" />
      </span>
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="font-heading-small">What's next?</span>
        <span className="max-w-72 text-muted-foreground">
          The chat works on what you attach. Pick a starting point or just ask.
        </span>
      </div>
      <div className="flex w-full flex-col gap-2">
        {starters.map((starter) => (
          <StarterGroup
            key={starter.title}
            onToggle={() =>
              setOpen((o) => (o === starter.title ? null : starter.title))
            }
            open={open === starter.title}
            starter={starter}
            threadId={thread.id}
          />
        ))}
        <button
          className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => figma.current?.click()}
          type="button"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
            <FileInput className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-heading-xsmall">Import from Figma</span>
            <span className="truncate font-body text-muted-foreground">
              Turn a .fig file into pages
            </span>
          </span>
        </button>
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
      </div>
    </div>
  );
};
