import {
  FileUp,
  FolderOpen,
  Frame,
  type LucideIcon,
  PanelsTopLeft,
  Plus,
  Sparkles,
} from "lucide-react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { newCanvas } from "../lib/canvas-actions.ts";
import { pickFigmaFile } from "../lib/import-figma.ts";
import { newPage } from "../lib/page-actions.ts";
import { chooseFolder } from "../lib/project-setup.ts";
import { startPrompt } from "../lib/start-thread.ts";
import { useEditor } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";

// What is pressed on the canvas is the button's, not the start of a pan or a marquee.
const keepFromCanvas = (e: ReactPointerEvent) => e.stopPropagation();

const askAgent = () => showLeftPanel("chat");

/** A new chat drafted to draw the canvas's first page, for the person to finish and send. */
const askForFirstPage = (canvas: string) =>
  startPrompt(`Draw the first page of ${canvas}: `);

/**
 * An empty state on the canvas, as every panel has one: a muted icon, what will be here in one
 * line, how it fills in one sentence, then the actions, the first of them the one it is for.
 */
const Lead = ({
  children,
  description,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  description: ReactNode;
  icon: LucideIcon;
  title: ReactNode;
}) => (
  <div className="flex max-w-sm flex-col items-center text-center">
    <Icon className="mb-3 size-5 text-muted-foreground" />
    <span className="font-body-medium">{title}</span>
    <span className="mt-1 text-balance font-body-small text-muted-foreground">
      {description}
    </span>
    <div
      className="pointer-events-auto mt-4 flex flex-wrap justify-center gap-2"
      onPointerDown={keepFromCanvas}
    >
      {children}
    </div>
  </div>
);

/**
 * A canvas with no pages: what it will hold, a first page, and an agent asked to draw one. A
 * project with no design system of its own draws in the default look (ADR 0062): nothing here
 * says so, the Design system place does.
 */
const NoPages = ({ canvas }: { canvas: string }) => {
  const name = useProject(
    (s) => s.canvases.find((c) => c.id === canvas)?.name ?? canvas
  );
  return (
    <Lead
      description="Pages are drawn here side by side, one for each screen of this part of the app."
      icon={PanelsTopLeft}
      title="No pages yet"
    >
      <Button onClick={newPage}>
        <Plus />
        New page
      </Button>
      <Button onClick={() => askForFirstPage(name)} variant="outline">
        <Sparkles />
        Ask an agent
      </Button>
    </Lead>
  );
};

const NO_CANVAS: readonly {
  icon: LucideIcon;
  label: string;
  run: () => unknown;
  variant: "default" | "ghost" | "outline";
}[] = [
  { icon: Plus, label: "New canvas", run: newCanvas, variant: "default" },
  {
    icon: FileUp,
    label: "Import a Figma file",
    run: pickFigmaFile,
    variant: "outline",
  },
  { icon: Sparkles, label: "Ask an agent", run: askAgent, variant: "ghost" },
];

/**
 * Shown over a canvas with nothing on it, centred in the part the side panels leave to be seen.
 * Only what can be pressed takes the pointer; around it the canvas still takes a drop or a pan.
 */
export const EmptyState = () => {
  const configured = useProject((s) => s.info.configured);
  const canvas = useEditor((s) => s.canvas);
  let content = (
    <Lead
      description="Choose the folder of the app you’ll design."
      icon={FolderOpen}
      title="No folder open"
    >
      <Button onClick={chooseFolder}>Choose a folder…</Button>
    </Lead>
  );
  if (configured && canvas !== null) {
    content = <NoPages canvas={canvas} />;
  } else if (configured) {
    content = (
      <Lead
        description="A canvas holds the pages of one part of your app. Start one, bring in a Figma file, or have an agent draw it."
        icon={Frame}
        title="No canvases yet"
      >
        {NO_CANVAS.map(({ icon: Icon, label, run, variant }) => (
          <Button key={label} onClick={() => run()} variant={variant}>
            <Icon />
            {label}
          </Button>
        ))}
      </Lead>
    );
  }
  return (
    <div
      className="@container pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{
        paddingLeft: "var(--cover-left, 0px)",
        paddingRight: "var(--cover-right, 0px)",
      }}
    >
      {content}
    </div>
  );
};
