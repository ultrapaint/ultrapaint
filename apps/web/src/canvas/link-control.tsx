import type { DesignNode } from "@ultrapaint/contracts/document";
import { Link2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LinkField } from "../components/link-field.tsx";
import { describeLink } from "../lib/links.ts";
import { updateSelection } from "../lib/node-actions.ts";
import { isNodeFrame } from "../state/documents.ts";
import { pagesOfCanvas, useEditor } from "../state/editor.ts";

/**
 * Where the element leads in the prototype, from the Vibe toolbar: the inspector's own field in a
 * popover. A page's root and a node beside the pages have no link to set.
 */
export const LinkControl = ({ node }: { node: DesignNode }) => {
  const frame = useEditor((s) => s.selection?.frame ?? null);
  const canvas = useEditor((s) => s.canvas);
  if (node.type === "page" || frame === null || isNodeFrame(frame)) {
    return null;
  }
  const described = node.link
    ? describeLink(pagesOfCanvas(canvas), node.link)
    : null;
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  className="flex h-7 max-w-40 items-center gap-1 rounded-md px-2 font-medium text-[12px] outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-[linked=true]:bg-muted data-[broken=true]:text-destructive"
                  data-broken={described?.broken ?? false}
                  data-linked={described !== null}
                  type="button"
                />
              }
            />
          }
        >
          <Link2 className="size-3.5 shrink-0" />
          {described ? (
            <span className="truncate">{described.label}</span>
          ) : null}
        </TooltipTrigger>
        <TooltipContent>
          {described ? "Where it leads in the prototype" : "Link to a page"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64 gap-2 p-2.5">
        <span className="font-medium text-[11px]">Goes to</span>
        <LinkField
          link={node.link}
          onChange={(link) =>
            updateSelection(
              { link },
              link === null ? "Remove the link" : "Link"
            )
          }
        />
      </PopoverContent>
    </Popover>
  );
};
