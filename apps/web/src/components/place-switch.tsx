/**
 * The editor's three places, in one switch at the top of the canvas: the pages of a canvas, the
 * design system's boards (ADR 0053's two modes), and the prototype, clicked through. Where the
 * user is, said once, where the eye looks first.
 */
import { cn } from "cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditor } from "../state/editor.ts";
import { type EditorMode, showMode, useEditorMode } from "../state/panels.ts";
import { syncWaiting, useSync } from "../state/sync.ts";
import { CommandKeys } from "./shortcut-sheet.tsx";

type Place = EditorMode | "prototype";

const places: readonly { command?: string; label: string; value: Place }[] = [
  { command: "workspace:design", label: "Canvas", value: "canvas" },
  { label: "Design system", value: "designSystem" },
  { command: "workspace:prototype", label: "Prototype", value: "prototype" },
];

const go = (place: Place) => {
  if (place === "prototype") {
    useEditor.getState().setWorkspace("prototype");
    return;
  }
  showMode(place);
};

export const PlaceSwitch = () => {
  const mode = useEditorMode();
  const prototype = useEditor((s) => s.workspace === "prototype");
  const current: Place = prototype ? "prototype" : mode;
  // The design system and the code need syncing: said here too, seen from the canvas.
  const waiting = useSync((s) => syncWaiting(s.plan));
  return (
    <nav
      aria-label="Places"
      className="floating pointer-events-auto flex items-center gap-0.5 p-1"
    >
      {places.map((place) => {
        const active = place.value === current;
        return (
          <Tooltip key={place.value}>
            <TooltipTrigger
              render={
                <button
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-7 items-center gap-1.5 rounded-md px-3 font-label outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/25",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => go(place.value)}
                  type="button"
                />
              }
            >
              {place.label}
              {place.value === "designSystem" && waiting ? (
                <span
                  aria-label="The design system and the code need syncing"
                  className="size-1.5 shrink-0 rounded-full bg-agent"
                  role="status"
                />
              ) : null}
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {place.label}
              {place.command ? <CommandKeys id={place.command} /> : null}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
};
