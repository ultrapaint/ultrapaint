/**
 * How much review a design gets (ADR 0063): the named levels, what each says, and the stepped
 * slider the composer's Review chip opens. Settings › Agents shows the same levels as a segmented
 * control, Custom among them.
 */
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import {
  levelOf,
  REVIEW_LEVELS,
  type ReviewLevel,
  type ReviewSettings,
  reviewSettingsOf,
  withLevel,
} from "@ultrapaint/contracts/review";
import type { Thread } from "@ultrapaint/contracts/threads";
import { cn } from "cn";
import { ChevronDown, ScanEye } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "../state/connection.ts";
import { reportError, useProject } from "../state/project.ts";

export const LEVEL_NAMES: Record<ReviewLevel | "custom", string> = {
  custom: "Custom",
  off: "Off",
  quick: "Quick",
  standard: "Standard",
  thorough: "Thorough",
};

/** What each level does, in the person's words: under the slider and under Settings' Level. */
export const LEVEL_LINES: Record<ReviewLevel | "custom", string> = {
  custom: "You choose who reviews each round, who approves, and the goal.",
  off: "Not recommended. Nothing checks the design before it’s done.",
  quick: "Your first review model reviews until it approves.",
  standard:
    "Your review models take turns, and all of them approve the result.",
  thorough:
    "All your review models review every round. Slower, and the most thorough.",
};

/** The fields a level sets in a chat's own settings: over the project's, a goal it has cleared. */
const chatLevel = (level: ReviewLevel): ReviewSettings => {
  const fields = withLevel(undefined, level);
  return level === "off" ? { on: false } : { ...fields, goal: {} };
};

/** The level's name and line, the warning dot before Off's. */
export const LevelLine = ({
  className,
  level,
  line = LEVEL_LINES[level],
  tag,
}: {
  className?: string;
  level: ReviewLevel | "custom";
  /** What it says under the name, when not the level's own line. */
  line?: string;
  tag?: string | undefined;
}) => (
  <div className={cn("flex flex-col gap-0.5", className)}>
    <span className="flex items-center gap-1.5 font-label">
      {level === "off" ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-warning"
        />
      ) : null}
      {LEVEL_NAMES[level]}
      {tag ? (
        <span className="rounded-full bg-accent px-1.5 font-caption text-muted-foreground">
          {tag}
        </span>
      ) : null}
    </span>
    <span className="font-small text-muted-foreground">{line}</span>
  </div>
);

/**
 * Off, Quick, Standard, Thorough on a stepped track: drag, click a stop or its name, or the
 * arrow keys. Custom sits on no stop.
 */
export const LevelSlider = ({
  level,
  onChange,
}: {
  level: ReviewLevel | "custom";
  onChange: (level: ReviewLevel) => void;
}) => {
  const at = level === "custom" ? -1 : REVIEW_LEVELS.indexOf(level);
  const last = REVIEW_LEVELS.length - 1;
  const percent = (i: number) => (i / last) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      {/* The track runs from the first name's centre to the last's: four equal columns. */}
      <SliderPrimitive.Root
        aria-label="Review"
        className="mx-[12.5%]"
        max={last}
        min={0}
        onValueChange={(value) => {
          const next = REVIEW_LEVELS[value as number];
          if (next && next !== level) {
            onChange(next);
          }
        }}
        step={1}
        value={Math.max(at, 0)}
      >
        <SliderPrimitive.Control className="relative flex h-6 cursor-pointer touch-none items-center">
          <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-input">
            {at >= 0 ? (
              <SliderPrimitive.Indicator className="rounded-full bg-primary" />
            ) : null}
            {REVIEW_LEVELS.map((name, i) => (
              <span
                aria-hidden
                className={cn(
                  "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                  i <= at ? "bg-primary-foreground" : "bg-muted-foreground"
                )}
                key={name}
                style={{ left: `${percent(i)}%` }}
              />
            ))}
            {at >= 0 ? (
              <SliderPrimitive.Thumb
                className="size-4 rounded-full bg-foreground shadow-sm outline-none transition-[box-shadow] duration-100 after:absolute after:-inset-1 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                getAriaValueText={(_formatted, value) =>
                  LEVEL_NAMES[REVIEW_LEVELS[value] ?? "standard"]
                }
              />
            ) : null}
          </SliderPrimitive.Track>
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>
      {/* Each name centred under its stop. */}
      <div className="grid grid-cols-4">
        {REVIEW_LEVELS.map((name, i) => (
          <button
            className={cn(
              "h-6 rounded-sm font-small outline-none transition-colors duration-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              i === at ? "font-label text-foreground" : "text-muted-foreground"
            )}
            key={name}
            onClick={() => onChange(name)}
            // The thumb takes the keys; on Custom, with no thumb, the names do.
            tabIndex={at < 0 ? 0 : -1}
            type="button"
          >
            {LEVEL_NAMES[name]}
          </button>
        ))}
      </div>
    </div>
  );
};

/** The project's review settings, as the editor has them. */
const useProjectReview = () => useProject((s) => s.settings?.review);

/**
 * The composer's Review chip (ADR 0063): this design's level, a dot when it differs from the
 * project's, opening the slider. A change applies from the next round.
 */
export const ReviewChip = ({ thread }: { thread: Thread }) => {
  const project = useProjectReview();
  const trigger = useRef<HTMLButtonElement>(null);
  // An implement thread writes the code a design already settled: nothing of it is reviewed here.
  if (thread.purpose === "implement") {
    return null;
  }
  const projectLevel = levelOf(project);
  const level = levelOf(reviewSettingsOf(project, thread.review));
  const own = thread.review !== undefined;
  const differs = own && level !== projectLevel;
  const set = (review: ReviewSettings | null) =>
    api()
      .request("threads.setReview", { review, threadId: thread.id })
      .catch(reportError);
  const onChange = (next: ReviewLevel) =>
    set(next === projectLevel ? null : chatLevel(next));
  const openSettings = () => useProject.getState().openSettings(true, "agents");
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label={`Review: ${LEVEL_NAMES[level]}${differs ? ", changed for this chat" : ""}`}
            className="min-w-0 shrink gap-1 px-1.5 text-muted-foreground has-data-[icon=inline-end]:pr-1"
            ref={trigger}
            variant="ghost"
          />
        }
      >
        <ScanEye aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{LEVEL_NAMES[level]}</span>
        {differs ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-foreground"
          />
        ) : null}
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </PopoverTrigger>
      {/* Over the whole composer, as wide as it, as its model menu opens above it. */}
      <PopoverContent
        align="start"
        anchor={() =>
          trigger.current?.closest("[data-composer]") ?? trigger.current
        }
        className="w-(--anchor-width) gap-3 p-3"
        side="top"
      >
        <div className="flex h-6 items-center justify-between gap-2">
          <span className="font-heading-xsmall">Review</span>
          {differs ? (
            <Button
              className="-mr-1.5 h-6 px-1.5 font-small"
              onClick={() => set(null)}
              size="sm"
              variant="ghost"
            >
              Use project default
            </Button>
          ) : (
            <Button
              className="-mr-1.5 h-6 px-1.5 font-small"
              onClick={openSettings}
              size="sm"
              variant="ghost"
            >
              Project settings
            </Button>
          )}
        </div>
        <LevelSlider level={level} onChange={onChange} />
        <LevelLine
          className="rounded-md bg-muted p-2"
          level={level}
          // The composer can't set Custom's rows: they are the project's.
          line={level === "custom" ? "Set in project settings." : undefined}
          tag={
            level === projectLevel && level !== "custom"
              ? "Project default"
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
};
