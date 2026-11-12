/**
 * What the element toolbar adds for a page's root, which is the page (ADR 0075): the viewports
 * it can be drawn at, the views it is drawn in beside its frame (ADR 0036), and the notes on the
 * page as a whole (ADR 0085). The frame's header keeps its name; the inspector keeps its Viewport
 * field, its route and its size.
 */
import type { Comment } from "@ultrapaint/contracts/comments";
import { presetSize, type ViewportPreset } from "@ultrapaint/contracts/pages";
import {
  Cog,
  Columns2,
  type LucideIcon,
  MessageSquare,
  Monitor,
  Scaling,
  Smartphone,
  Tablet,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { presetOf, viewportPresets } from "../lib/presets.ts";
import { openComment, pageNotesOf, useComments } from "../state/comments.ts";
import { useBreakpoints } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { addView, setPreset } from "../state/page-layout.ts";
import { useProject } from "../state/project.ts";
import { selectPage } from "../state/selection.ts";
import {
  MenuHead,
  TRIGGER_CLASS,
  ValueTrigger,
} from "./element-toolbar-selects.tsx";

const PRESET_ICON: Record<ViewportPreset, LucideIcon> = {
  custom: Scaling,
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

/** The devices a page can be drawn at; Custom is what a frame sized by hand already is. */
const DEVICES = viewportPresets.flatMap((p) =>
  p.value === "custom" ? [] : [{ ...p, size: presetSize[p.value] }]
);

const ViewportSelect = ({
  pageId,
  preset,
}: {
  pageId: string;
  preset: ViewportPreset;
}) => (
  <DropdownMenu>
    <ValueTrigger icon={PRESET_ICON[preset]} tooltip="Viewport">
      {viewportPresets.find((p) => p.value === preset)?.label ?? "Custom"}
    </ValueTrigger>
    <DropdownMenuContent className="w-52">
      <DropdownMenuGroup>
        <MenuHead name="viewport" />
        <DropdownMenuRadioGroup
          onValueChange={(v) => setPreset(pageId, v as ViewportPreset)}
          value={preset}
        >
          {DEVICES.map((d) => {
            const Icon = PRESET_ICON[d.value];
            return (
              <DropdownMenuRadioItem key={d.value} value={d.value}>
                <Icon />
                <span className="flex-1">{d.label}</span>
                <span className="font-body-small text-muted-foreground tabular-nums">
                  {d.size.width} × {d.size.height}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

/**
 * Adds a view of the page beside its frame: at a device's width, or where a breakpoint of the
 * design system starts. The view is selected, so what is edited next lands at its breakpoint.
 */
const ViewsMenu = ({ pageId }: { pageId: string }) => {
  const count = useEditor((s) => s.frames[pageId]?.views?.length ?? 0);
  const breakpoints = useBreakpoints();
  const add = (width: number, height?: number) => {
    const view = addView(pageId, width, height);
    if (view) {
      selectPage(view);
    }
  };
  return (
    <DropdownMenu>
      <ValueTrigger icon={Columns2} tooltip="Views">
        {count === 0 ? "Views" : `${count + 1} views`}
      </ValueTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <MenuHead name="Add a view" />
          {DEVICES.map((d) => {
            const Icon = PRESET_ICON[d.value];
            return (
              <DropdownMenuItem
                key={d.value}
                onClick={() => add(d.size.width, d.size.height)}
              >
                <Icon />
                <span className="flex-1">{d.label}</span>
                <span className="font-body-small text-muted-foreground tabular-nums">
                  {d.size.width}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <MenuHead name="At a breakpoint" />
          {breakpoints.map((b) => (
            <DropdownMenuItem key={b.name} onClick={() => add(b.min)}>
              <span className="flex-1 font-code">{b.name}</span>
              <span className="font-body-small text-muted-foreground tabular-nums">
                {b.min}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** "1 note", "3 comments": behaviour notes (ADR 0030) by that name, anything else as comments. */
const notesLabel = (notes: readonly Comment[]) => {
  const word = notes.every((n) => n.kind === "behaviour") ? "note" : "comment";
  return `${notes.length} ${word}${notes.length === 1 ? "" : "s"}`;
};

const NoteIcon = ({ notes }: { notes: readonly Comment[] }) =>
  notes.every((n) => n.kind === "behaviour") ? (
    <Cog className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
  );

/**
 * The open notes on the page as a whole, those without a spot on it (ADR 0085), which the canvas
 * does not pin: one opens its card, several are listed to pick from. None, no button.
 */
const PageNotes = ({ pageId }: { pageId: string }) => {
  const path = useProject((s) => s.pages.find((p) => p.id === pageId)?.path);
  const comments = useComments((s) => s.comments);
  const notes = path === undefined ? [] : pageNotesOf(comments, path);
  const [first] = notes;
  if (first === undefined) {
    return null;
  }
  if (notes.length === 1) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className={TRIGGER_CLASS}
              onClick={() => openComment(first.id)}
              type="button"
            />
          }
        >
          <NoteIcon notes={notes} />
          <span className="truncate pr-0.5">{notesLabel(notes)}</span>
        </TooltipTrigger>
        <TooltipContent>Open the note on this page</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <DropdownMenu>
      <ValueTrigger tooltip="Notes on this page">
        <span className="flex items-center gap-1.5">
          <NoteIcon notes={notes} />
          {notesLabel(notes)}
        </span>
      </ValueTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuGroup>
          {notes.map((note) => (
            <DropdownMenuItem
              key={note.id}
              onClick={() => openComment(note.id)}
            >
              {note.kind === "behaviour" ? <Cog /> : <MessageSquare />}
              <span className="flex-1 truncate">{note.text}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** In the element toolbar while the page's root is selected. */
export const PageControls = ({ pageId }: { pageId: string }) => {
  const preset = useEditor((s) => presetOf(s.frames[pageId]));
  return (
    <>
      <ViewportSelect pageId={pageId} preset={preset} />
      <ViewsMenu pageId={pageId} />
      <PageNotes pageId={pageId} />
    </>
  );
};
