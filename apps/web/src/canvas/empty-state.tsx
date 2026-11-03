import { cn } from "cn";
import {
  FileUp,
  FolderGit2,
  Frame,
  type LucideIcon,
  PanelsTopLeft,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useMemo,
} from "react";
import { Button } from "@/components/ui/button";
import { openSetup } from "../components/setup-dialog.tsx";
import { newCanvas } from "../lib/canvas-actions.ts";
import { pickFigmaFile } from "../lib/import-figma.ts";
import { newPage } from "../lib/page-actions.ts";
import { startInit, startPrompt } from "../lib/start-thread.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { showLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { StarterThumb, thumbStyle } from "./starter-thumbs.tsx";
import {
  offeredStarters,
  type StarterId,
  type StarterTheme,
  starterPrompt,
  starterTheme,
} from "./starters.ts";

// What is pressed on the canvas is the button's, not the start of a pan or a marquee.
const keepFromCanvas = (e: ReactPointerEvent) => e.stopPropagation();

const askAgent = () => showLeftPanel("chat");

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
    <span className="font-label">{title}</span>
    <span className="mt-1 text-balance font-small text-muted-foreground">
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

/** A starter an agent draws: its drawing in the design's look, its name under it. */
const Tile = ({
  hint,
  label,
  onClick,
  plain,
  style,
  thumb,
}: {
  hint: string;
  label: string;
  onClick: () => unknown;
  plain: boolean;
  style?: CSSProperties;
  thumb: StarterId;
}) => (
  <button
    className="group pointer-events-auto flex w-36 flex-col items-center gap-2 outline-none"
    onClick={() => onClick()}
    onPointerDown={keepFromCanvas}
    title={hint}
    type="button"
  >
    <div
      className={cn(
        "relative flex h-24 w-36 flex-col gap-1 overflow-hidden rounded-lg bg-(--s-surface) p-2 transition-[border-color,box-shadow]",
        "group-hover:border-foreground/30 group-focus-visible:ring-2 group-focus-visible:ring-ring/50",
        plain ? "border border-foreground/15 border-dashed" : "border"
      )}
      style={style}
    >
      <StarterThumb id={thumb} plain={plain} />
    </div>
    <span className="font-small text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground">
      {label}
    </span>
  </button>
);

/** What the starters are drawn with: the design system's colours, heading font and library. */
const SystemLine = ({
  components,
  theme,
}: {
  components: number;
  theme: StarterTheme;
}) => {
  const swatches = Object.entries({
    accent: theme.accent,
    border: theme.border,
    foreground: theme.foreground,
    surface: theme.surface,
  }).flatMap(([role, colour]) => (colour ? [{ colour, role }] : []));
  const parts = [
    theme.font?.name,
    components > 0 ? `${components} components` : undefined,
  ].filter((p) => p !== undefined);
  return (
    <span className="flex items-center gap-2 font-small text-muted-foreground">
      <span className="flex -space-x-0.5">
        {swatches.map(({ colour, role }) => (
          <span
            className="size-3 rounded-full ring-1 ring-foreground/15"
            key={role}
            style={{ background: colour }}
          />
        ))}
      </span>
      In your design system
      {parts.map((part) => (
        <span key={part}>· {part}</span>
      ))}
    </span>
  );
};

/** Without a design system the starters are plain, and this is how they stop being. */
const SetupLine = () => (
  <span
    className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-1 font-small text-muted-foreground"
    onPointerDown={keepFromCanvas}
  >
    Plain wireframes until the design system is set up.
    <Button
      className="h-auto px-1 font-small"
      onClick={startInit}
      variant="link"
    >
      Set it up
    </Button>
    or
    <Button
      className="h-auto px-1 font-small"
      onClick={pickFigmaFile}
      variant="link"
    >
      import it from Figma
    </Button>
  </span>
);

/**
 * A canvas with no pages: what it will hold, a first page, an agent asked to draw one, and the
 * starters an agent draws. Choosing a starter writes its prompt into a new chat, unsent, for the
 * user to finish. With a design system the starters follow its library and are drawn in its look.
 */
const NoPages = ({ canvas }: { canvas: string }) => {
  const designSystem = useDesignSystem((s) => s.designSystem);
  const loaded = useDesignSystem((s) => s.loaded);
  const catalogue = useComponents((s) => s.catalogue);
  const name = useProject(
    (s) => s.canvases.find((c) => c.id === canvas)?.name ?? canvas
  );
  const theme = useMemo(
    () => (designSystem ? starterTheme(designSystem) : null),
    [designSystem]
  );
  const withSystem = theme !== null;
  const style = thumbStyle(theme);
  return (
    // Between both side panels the canvas is narrower than the starters: they are drawn smaller.
    <div className="flex max-w-full flex-col items-center gap-12 px-6 @max-[48rem]:[zoom:0.85]">
      <Lead
        description="Pages are drawn here side by side, one for each screen of this part of the app."
        icon={PanelsTopLeft}
        title={`${name} has no pages yet`}
      >
        <Button onClick={newPage}>
          <Plus />
          New page
        </Button>
        <Button onClick={askAgent} variant="outline">
          <Sparkles />
          Ask an agent
        </Button>
      </Lead>
      <div className="flex flex-col items-center gap-4">
        <span className="font-small text-muted-foreground">
          Or have an agent draw a starter
        </span>
        <div className="flex flex-wrap items-start justify-center gap-4">
          {offeredStarters(withSystem).map((o) => (
            <Tile
              hint={withSystem ? o.uses.join(" · ") : "Plain wireframe"}
              key={o.starter.id}
              label={o.starter.label}
              onClick={() => startPrompt(starterPrompt(o, name, withSystem))}
              plain={!withSystem}
              style={style}
              thumb={o.starter.id}
            />
          ))}
        </div>
        {theme ? (
          <SystemLine components={catalogue.length} theme={theme} />
        ) : null}
        {loaded && !theme ? <SetupLine /> : null}
      </div>
    </div>
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
      description="Pick the repository whose app you’ll design, and where its designs are kept."
      icon={FolderGit2}
      title="No repository set up"
    >
      <Button onClick={openSetup}>Set up…</Button>
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
