import { cn } from "cn";
import {
  FileUp,
  Frame,
  type LucideIcon,
  Palette,
  Shapes,
  Sparkles,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useMemo,
} from "react";
import { Button } from "@/components/ui/button";
import { openSetup } from "../components/setup-dialog.tsx";
import { newCanvas } from "../lib/canvas-actions.ts";
import { pickFigmaFile } from "../lib/import-figma.ts";
import { newPage } from "../lib/page-actions.ts";
import { startCommand, startInit } from "../lib/start-thread.ts";
import { useCatalogue } from "../state/catalogue.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { openLeftPanel } from "../state/panels.ts";
import { useProject } from "../state/project.ts";
import { StarterThumb, thumbStyle } from "./starter-thumbs.tsx";
import {
  offeredStarters,
  type StarterId,
  type StarterTheme,
  starterPrompt,
  starterTheme,
} from "./starters.ts";

interface Action {
  icon: LucideIcon;
  label: string;
  run: () => unknown;
}

const NO_CANVAS: readonly Action[] = [
  { icon: Frame, label: "New canvas…", run: newCanvas },
  { icon: FileUp, label: "Import a Figma file…", run: pickFigmaFile },
  { icon: Sparkles, label: "Ask an agent", run: () => openLeftPanel("chat") },
];

// What is pressed on the canvas is the button's, not the start of a pan or a marquee.
const keepFromCanvas = (e: ReactPointerEvent) => e.stopPropagation();

const Tile = ({
  hint,
  label,
  onClick,
  plain,
  style,
  thumb,
}: {
  hint?: string;
  label: string;
  onClick: () => unknown;
  plain: boolean;
  style?: CSSProperties;
  thumb: StarterId | "blank";
}) => {
  const blank = thumb === "blank";
  return (
    <button
      className="group pointer-events-auto flex w-[150px] flex-col items-center gap-1.5 outline-none"
      onClick={() => onClick()}
      onPointerDown={keepFromCanvas}
      type="button"
    >
      <div
        className={cn(
          "relative flex h-[104px] w-[150px] flex-col gap-1 overflow-hidden rounded-lg p-[9px] outline-offset-2 transition-[translate,box-shadow]",
          "group-hover:-translate-y-1.5 group-hover:shadow-black/60 group-hover:shadow-xl group-hover:outline-2 group-hover:outline-selection",
          "group-focus-visible:outline-2 group-focus-visible:outline-selection",
          blank || plain
            ? "border-[1.5px] border-foreground/20 border-dashed"
            : "border border-transparent",
          !blank && "bg-(--s-surface)"
        )}
        style={style}
      >
        <StarterThumb id={thumb} plain={plain} />
        {!blank && (
          <span className="absolute right-1.5 bottom-1.5 rounded-md bg-primary px-2 py-0.5 text-primary-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            Use
          </span>
        )}
      </div>
      <span className="text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground">
        {label}
      </span>
      {hint ? (
        <span className="whitespace-nowrap text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
          {hint}
        </span>
      ) : null}
    </button>
  );
};

const Dot = () => <span className="opacity-40">·</span>;

/** What the starters are drawn with: the design system's colours, heading font and library. */
const SystemPill = ({
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
  return (
    <span className="flex items-center gap-2 rounded-full border py-1 pr-2.5 pl-1.5 text-muted-foreground">
      <span className="flex gap-0.5">
        {swatches.map(({ colour, role }) => (
          <span
            className="size-3 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]"
            key={role}
            style={{ background: colour }}
          />
        ))}
      </span>
      Drawn with your design system
      {theme.font ? (
        <>
          <Dot />
          <span
            className="text-foreground"
            style={{ fontFamily: theme.font.css }}
          >
            Aa
          </span>
          {theme.font.name}
        </>
      ) : null}
      {components > 0 && (
        <>
          <Dot />
          {components} components
        </>
      )}
    </span>
  );
};

/** Without a design system: the starters are plain, and this is how they stop being. */
const SetupRow = () => (
  <div
    className="pointer-events-auto flex max-w-[830px] items-center gap-3.5 rounded-xl border bg-sidebar/70 py-2.5 pr-2.5 pl-3.5 backdrop-blur-sm"
    onPointerDown={keepFromCanvas}
  >
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
      <Palette className="size-4" />
    </span>
    <div className="flex flex-1 flex-col gap-0.5 text-left">
      <span className="font-medium">Draw these with your own components</span>
      <span className="font-body text-muted-foreground">
        An agent reads your colours, type and components, then every starter
        uses them.
      </span>
    </div>
    <Button onClick={startInit} size="sm">
      <Palette />
      Set up the design system
    </Button>
    <Button onClick={pickFigmaFile} size="sm" variant="outline">
      <FileUp />
      From a Figma file
    </Button>
  </div>
);

/** The other ways to begin: describe a page to an agent, or drag a component in. */
const OtherWay = () => (
  <div className="flex items-center gap-1.5 text-muted-foreground">
    <button
      className="pointer-events-auto flex items-center gap-1.5 hover:text-foreground"
      onClick={() => openLeftPanel("chat")}
      onPointerDown={keepFromCanvas}
      type="button"
    >
      <Sparkles className="size-3 text-agent" />
      or describe a page to an agent
    </button>
    <span aria-hidden>·</span>
    <button
      className="pointer-events-auto flex items-center gap-1.5 hover:text-foreground"
      onClick={() => openLeftPanel("assets")}
      onPointerDown={keepFromCanvas}
      type="button"
    >
      <Shapes className="size-3" />
      drag a component or an image from Assets
    </button>
  </div>
);

/**
 * The ways from an empty canvas to a first page: a blank page, or a starter an agent draws.
 * Choosing a starter writes its prompt into a new chat, unsent, for the user to finish. With a
 * design system the starters follow its library and are drawn in its look.
 */
const Starters = ({ canvas }: { canvas: string }) => {
  const designSystem = useDesignSystem((s) => s.designSystem);
  const loaded = useDesignSystem((s) => s.loaded);
  const catalogue = useCatalogue((s) => s.catalogue);
  const name = useProject(
    (s) => s.canvases.find((c) => c.id === canvas)?.name ?? canvas
  );
  const theme = useMemo(
    () => (designSystem ? starterTheme(designSystem) : null),
    [designSystem]
  );
  const withSystem = theme !== null;
  const offered = offeredStarters(catalogue, withSystem);
  const style = thumbStyle(theme);
  return (
    // Between both side panels the canvas is narrower than the strip: it is drawn smaller there.
    <div className="flex max-w-full flex-col items-center gap-5 px-6 @max-[54rem]:[zoom:0.8]">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="font-medium">Start {name} from</span>
        {theme && (
          <SystemPill
            components={catalogue?.components.length ?? 0}
            theme={theme}
          />
        )}
        {loaded && !theme && (
          <span className="font-body text-muted-foreground">
            Plain wireframes, until the design system is set up
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-center gap-4">
        <Tile label="Blank" onClick={newPage} plain thumb="blank" />
        {offered.map((o) => (
          <Tile
            hint={withSystem ? o.uses.join(" · ") : "Plain wireframe"}
            key={o.starter.id}
            label={o.starter.label}
            onClick={() => startCommand(starterPrompt(o, name, withSystem))}
            plain={!withSystem}
            style={style}
            thumb={o.starter.id}
          />
        ))}
      </div>
      {loaded && !theme ? <SetupRow /> : <OtherWay />}
    </div>
  );
};

/**
 * Shown over a canvas with nothing on it, centred in the part the side panels leave to be seen.
 * Only what can be pressed takes the pointer; around it the canvas still takes a drop or a pan.
 */
export const EmptyState = () => {
  const configured = useProject((s) => s.info.configured);
  const canvas = useEditor((s) => s.canvas);
  let content = (
    <span className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-sidebar/90 px-4 py-3 text-muted-foreground shadow-black/10 shadow-sm backdrop-blur-sm">
      No repository set up yet.
      <Button onClick={openSetup} size="sm" variant="outline">
        Set up…
      </Button>
    </span>
  );
  if (configured && canvas !== null) {
    content = <Starters canvas={canvas} />;
  } else if (configured) {
    content = (
      <div
        className="pointer-events-auto flex max-w-xl flex-col items-center gap-4 rounded-xl border bg-sidebar/90 px-8 py-6 text-center shadow-black/10 shadow-sm backdrop-blur-sm"
        onPointerDown={keepFromCanvas}
      >
        <div className="flex flex-col items-center gap-1">
          <span className="font-medium">No canvas yet</span>
          <span className="max-w-xs text-balance font-body text-muted-foreground">
            A canvas holds the pages of one part of the app. Start one, bring in
            a Figma file, or have an agent draw it.
          </span>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {NO_CANVAS.map(({ icon: Icon, label, run }, i) => (
            <Button
              key={label}
              onClick={() => run()}
              size="sm"
              variant={i === 0 ? "default" : "outline"}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </div>
      </div>
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
