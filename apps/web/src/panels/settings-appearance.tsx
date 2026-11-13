/**
 * Settings › Appearance: the editor's theme and accent, the canvas's grid, comments and wheel, and
 * the interface's text size, contrast and motion. The person's, in every project, kept in the
 * browser and drawn at once; the designs keep their own look.
 */
import { Check } from "lucide-react";
import type * as React from "react";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { Segmented } from "../components/segmented.tsx";
import { useCanvasGrid } from "../state/canvas-grid.ts";
import { useComments } from "../state/comments.ts";
import {
  ACCENTS,
  type Accent,
  DEFAULT_PREFERENCES,
  type Motion,
  type Preferences,
  type ScrollWheel,
  type TextSize,
  usePreferences,
} from "../state/preferences.ts";
import { type ThemePreference, useTheme } from "../state/theme.ts";
import { Group, Row } from "./settings-group.tsx";

/** A drawing of the editor in one theme: its two cards beside a page on the canvas. */
const Editor = ({ dark }: { dark: boolean }) => (
  <div
    className={cn(
      "flex h-full min-w-0 flex-1 gap-1 p-1.5",
      dark ? "bg-[oklch(0.165_0.004_70)]" : "bg-[oklch(0.945_0.004_80)]"
    )}
  >
    {[9, 6].map((width, i) => (
      <div
        className={cn(
          "flex flex-col gap-1 rounded-[3px] p-1",
          dark ? "bg-[oklch(0.235_0.004_70)]" : "bg-[oklch(0.995_0.001_80)]",
          i === 1 && "order-3"
        )}
        key={width}
        style={{ width: `${width * 4}px` }}
      >
        {[1, 0.6, 0.8].map((w) => (
          <span
            className={cn(
              "h-[3px] rounded-full",
              dark ? "bg-[oklch(0.4_0.004_70)]" : "bg-[oklch(0.85_0.004_70)]"
            )}
            key={w}
            style={{ width: `${w * 100}%` }}
          />
        ))}
      </div>
    ))}
    <div className="order-2 flex flex-1 items-center justify-center">
      <span className="h-7 w-10 rounded-[2px] bg-white shadow-sm" />
    </div>
  </div>
);

const THEMES: readonly { label: string; value: ThemePreference }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

/**
 * The theme as three pictures of the editor, System split down the middle (as T3 Code draws
 * it): seen before it is picked. A radio group: the arrows move between them.
 */
const ThemeCards = () => {
  const preference = useTheme((s) => s.preference);
  const pick = (value: ThemePreference) => useTheme.getState().set(value);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step === undefined) {
      return;
    }
    e.preventDefault();
    const at = THEMES.findIndex((t) => t.value === preference);
    const next = THEMES[(at + step + THEMES.length) % THEMES.length];
    if (next) {
      pick(next.value);
      e.currentTarget.parentElement
        ?.querySelector<HTMLElement>(`[data-theme-card=${next.value}]`)
        ?.focus();
    }
  };
  return (
    <div
      aria-label="Theme"
      className="grid grid-cols-3 gap-3"
      role="radiogroup"
    >
      {THEMES.map(({ label, value }) => {
        const chosen = value === preference;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a picture of the theme, as a radio
          <button
            aria-checked={chosen}
            className="group flex min-w-0 flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            data-theme-card={value}
            key={value}
            onClick={() => pick(value)}
            onKeyDown={onKeyDown}
            role="radio"
            tabIndex={chosen ? 0 : -1}
            type="button"
          >
            <span
              className={cn(
                "flex h-24 overflow-hidden rounded-lg border p-0.5 transition-colors duration-100",
                chosen
                  ? "border-primary ring-1 ring-primary"
                  : "group-hover:border-input-hover"
              )}
            >
              <span className="flex flex-1 overflow-hidden rounded-md">
                {value === "dark" ? null : <Editor dark={false} />}
                {value === "light" ? null : <Editor dark />}
              </span>
            </span>
            <span className="flex items-center gap-2 px-0.5 font-body-medium">
              <span
                aria-hidden
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border",
                  chosen
                    ? "border-primary bg-primary"
                    : "border-muted-foreground"
                )}
              >
                {chosen ? (
                  <span className="size-1.5 rounded-full bg-primary-foreground" />
                ) : null}
              </span>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
};

/** The swatch's colour, as the accent draws in the theme on screen. */
const SWATCH: Record<Accent, string> = {
  graphite: "bg-foreground",
  green: "bg-[oklch(0.55_0.13_150)]",
  orange: "bg-[oklch(0.6_0.16_45)]",
  teal: "bg-[oklch(0.55_0.1_195)]",
  ultramarine: "bg-[oklch(0.55_0.2_263)]",
};

/** The accents as swatches, the chosen one checked; each named by its tooltip. */
const AccentSwatches = () => {
  const accent = usePreferences((s) => s.accent);
  return (
    <div aria-label="Accent" className="flex gap-2" role="radiogroup">
      {ACCENTS.map(({ label, value }) => {
        const chosen = value === accent;
        return (
          <Tooltip key={value}>
            <TooltipTrigger
              render={
                // biome-ignore lint/a11y/useSemanticElements: a swatch, as a radio named by its tooltip
                <button
                  aria-checked={chosen}
                  aria-label={label}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-sidebar focus-visible:ring-2 focus-visible:ring-ring",
                    SWATCH[value],
                    chosen && "ring-2 ring-foreground/40"
                  )}
                  onClick={() => usePreferences.getState().set("accent", value)}
                  role="radio"
                  type="button"
                />
              }
            >
              {chosen ? (
                <Check
                  className={cn(
                    "size-3.5",
                    value === "graphite" ? "text-background" : "text-white"
                  )}
                />
              ) : null}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
};

/** A preference's reset, while it differs from its default. */
const resetOf = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
  value === DEFAULT_PREFERENCES[key]
    ? undefined
    : () => usePreferences.getState().reset(key);

export const AppearanceSection = () => {
  const preferences = usePreferences();
  const { set } = preferences;
  const grid = useCanvasGrid((s) => s.visible);
  const comments = useComments((s) => s.visible);
  return (
    <>
      <Group>
        <Row
          description="The editor’s light and dark. Designs keep their own themes."
          layout="below"
          setting="theme"
          title="Theme"
        >
          <ThemeCards />
        </Row>
        <Row
          description="What you act on: the main button, a switch on, the focus ring."
          onReset={resetOf("accent", preferences.accent)}
          setting="accent"
          title="Accent"
        >
          <AccentSwatches />
        </Row>
      </Group>
      <Group title="Canvas">
        <Row
          description="Shows 8px cells; what you place snaps to them."
          htmlFor="settings-grid"
          setting="grid"
          title="Grid"
        >
          <Switch
            checked={grid}
            id="settings-grid"
            onCheckedChange={() => useCanvasGrid.getState().toggle()}
          />
        </Row>
        <Row
          description="Pins on the designs they’re left on."
          htmlFor="settings-comments"
          setting="comments"
          title="Comments"
        >
          <Switch
            checked={comments}
            id="settings-comments"
            onCheckedChange={() => useComments.getState().toggleVisible()}
          />
        </Row>
        <Row
          description="Pinch and ⌘/Ctrl+wheel always zoom."
          onReset={resetOf("scrollWheel", preferences.scrollWheel)}
          setting="scroll-wheel"
          title="Scroll wheel"
        >
          <Segmented<ScrollWheel>
            aria-label="Scroll wheel"
            onChange={(v) => set("scrollWheel", v)}
            options={[
              { label: "Pans", value: "pan" },
              { label: "Zooms", value: "zoom" },
            ]}
            value={preferences.scrollWheel}
          />
        </Row>
      </Group>
      <Group title="Interface">
        <Row
          description="The panels’ text. The canvas keeps its own zoom."
          onReset={resetOf("textSize", preferences.textSize)}
          setting="text-size"
          title="Text size"
        >
          <Segmented<TextSize>
            aria-label="Text size"
            onChange={(v) => set("textSize", v)}
            options={[
              { label: "Small", value: "small" },
              { label: "Default", value: "default" },
              { label: "Large", value: "large" },
            ]}
            value={preferences.textSize}
          />
        </Row>
        <Row
          description="Darker muted text and firmer edges."
          htmlFor="settings-contrast"
          setting="contrast"
          title="Increase contrast"
        >
          <Switch
            checked={preferences.contrast}
            id="settings-contrast"
            onCheckedChange={(on) => set("contrast", on)}
          />
        </Row>
        <Row
          description="System follows your computer’s Reduce motion setting."
          onReset={resetOf("motion", preferences.motion)}
          setting="motion"
          title="Motion"
        >
          <Segmented<Motion>
            aria-label="Motion"
            onChange={(v) => set("motion", v)}
            options={[
              { label: "System", value: "system" },
              { label: "Reduced", value: "reduced" },
              { label: "Full", value: "full" },
            ]}
            value={preferences.motion}
          />
        </Row>
      </Group>
    </>
  );
};
