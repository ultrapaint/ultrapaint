/**
 * What the inspector shows of a page beyond its route and viewport, and of anything selected, its
 * behaviour notes (ADR 0086).
 */

import type { DesignNode } from "@ultrapaint/contracts/document";
import { presetSize } from "@ultrapaint/contracts/pages";
import {
  ChevronDown,
  Cog,
  type LucideIcon,
  Monitor,
  Smartphone,
  Tablet,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { viewportPresets } from "../lib/presets.ts";
import {
  behaviourNotesOf,
  openComment,
  useComments,
} from "../state/comments.ts";
import { useBreakpoints } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { ownFrameOf } from "../state/frame-ref.ts";
import { addView } from "../state/page-layout.ts";
import { useProject } from "../state/project.ts";
import { selectPage } from "../state/selection.ts";
import { Row, Section } from "./inspector-fields.tsx";

const DEVICE_ICON: Record<string, LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

/** The devices a view can be drawn at. */
const DEVICES = viewportPresets.flatMap((p) =>
  p.value === "custom" ? [] : [{ ...p, size: presetSize[p.value] }]
);

/**
 * How many views the page is drawn in beside its frame (ADR 0036), and a menu that adds one: at a
 * device's width, or where a breakpoint of the design system starts. The view added is selected,
 * so what is edited next lands at its breakpoint.
 */
export const ViewsRow = ({ pageId }: { pageId: string }) => {
  const count = useEditor((s) => s.frames[pageId]?.views?.length ?? 0);
  const breakpoints = useBreakpoints();
  const add = (width: number, height?: number) => {
    const view = addView(pageId, width, height);
    if (view) {
      selectPage(view);
    }
  };
  return (
    <Row label="Views">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md bg-muted px-2 text-left font-body outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/25 data-popup-open:bg-accent"
              type="button"
            />
          }
        >
          <span className="min-w-0 flex-1 truncate">
            {count === 0 ? "None" : `${count} view${count === 1 ? "" : "s"}`}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Add a view</DropdownMenuLabel>
            {DEVICES.map((d) => {
              const Icon = DEVICE_ICON[d.value] ?? Monitor;
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
          {breakpoints.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>At a breakpoint</DropdownMenuLabel>
                {breakpoints.map((b) => (
                  <DropdownMenuItem key={b.name} onClick={() => add(b.min)}>
                    <span className="flex-1 font-code">{b.name}</span>
                    <span className="font-body-small text-muted-foreground tabular-nums">
                      {b.min}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </Row>
  );
};

/**
 * The open behaviour notes on what is selected (ADR 0030): on the page as a whole when it is the
 * page, on the element otherwise. Pressed, a note opens its card on the canvas. None, no section.
 */
export const BehaviourSection = ({
  frame,
  node,
}: {
  frame: string;
  node: DesignNode;
}) => {
  const pageId = ownFrameOf(frame);
  const path = useProject((s) => s.pages.find((p) => p.id === pageId)?.path);
  const comments = useComments((s) => s.comments);
  if (path === undefined) {
    return null;
  }
  const notes = behaviourNotesOf(
    comments,
    path,
    node.type === "page" ? { rootId: node.id } : { nodeId: node.id }
  );
  if (notes.length === 0) {
    return null;
  }
  return (
    <Section title="Behaviour">
      <div className="-mx-1 flex flex-col gap-0.5">
        {notes.map((note) => (
          <button
            className="flex w-full min-w-0 items-start gap-2 rounded-md px-1 py-1 text-left outline-none transition-colors duration-100 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/25"
            key={note.id}
            onClick={() => openComment(note.id)}
            type="button"
          >
            <Cog className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="line-clamp-2 min-w-0 font-body">{note.text}</span>
          </button>
        ))}
      </div>
    </Section>
  );
};
