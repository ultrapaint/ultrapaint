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
import { pagesOfCanvas, useEditor } from "../state/editor.ts";
import { frameRefOf, hasPrototypeLinks } from "../state/frame-ref.ts";

/**
 * Where the element leads in the prototype, from the Vibe toolbar: the inspector's own field in a
 * popover. Only an icon, lit when the element leads somewhere, as the toolbar has to fit inside
 * the frame. Only a page's nodes lead somewhere: its root, a node beside the pages and a board's
 * have no link to set.
 */
export const LinkControl = ({ node }: { node: DesignNode }) => {
  const frame = useEditor((s) => s.selection?.frame ?? null);
  const canvas = useEditor((s) => s.canvas);
  if (
    node.type === "page" ||
    frame === null ||
    !hasPrototypeLinks(frameRefOf(frame))
  ) {
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
                  className="flex h-7 items-center rounded-md px-2 font-body font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-[linked=true]:bg-muted data-[broken=true]:text-destructive data-[linked=true]:text-sky-500"
                  data-broken={described?.broken ?? false}
                  data-linked={described !== null}
                  type="button"
                />
              }
            />
          }
        >
          <Link2 className="size-3.5 shrink-0" />
        </TooltipTrigger>
        <TooltipContent>
          {described
            ? `Leads to ${described.label}${described.broken ? ", which is not there" : ""}`
            : "Link to a page"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64 gap-2 p-2.5">
        <span className="font-heading-xsmall">Goes to</span>
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
