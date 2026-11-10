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
import { Row, Section } from "../panels/inspector-fields.tsx";
import { useEditor } from "../state/editor.ts";
import { frameRefOf, hasPrototypeLinks } from "../state/frame-ref.ts";
import { useProject } from "../state/project.ts";

/**
 * Where the element leads in the prototype, from the Vibe toolbar: the inspector's own field in a
 * popover. Only an icon, lit when the element leads somewhere, as the toolbar has to fit inside
 * the frame. Only a page's nodes lead somewhere: its root, a node beside the pages and a board's
 * have no link to set.
 */
export const LinkControl = ({ node }: { node: DesignNode }) => {
  const frame = useEditor((s) => s.selection?.frame ?? null);
  const canvas = useEditor((s) => s.canvas);
  // Subscribed to so the description follows a page renamed or removed.
  const pages = useProject((s) => s.pages);
  if (
    node.type === "page" ||
    frame === null ||
    !hasPrototypeLinks(frameRefOf(frame))
  ) {
    return null;
  }
  const described = node.link
    ? describeLink(
        pages.filter((p) => p.canvas === canvas),
        node.link
      )
    : null;
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25 data-popup-open:bg-accent data-[broken=true]:text-destructive data-[linked=true]:text-foreground"
                  data-broken={described?.broken ?? false}
                  data-linked={described !== null}
                  type="button"
                />
              }
            />
          }
        >
          <Link2 className="size-4 shrink-0" />
        </TooltipTrigger>
        <TooltipContent>
          {described
            ? `Goes to ${described.label}${described.broken ? ", which is not there" : ""}`
            : "Link"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-72 gap-0 p-0">
        <Section title="Prototype">
          <Row label="Goes to">
            <LinkField
              link={node.link}
              onChange={(link) =>
                updateSelection(
                  { link },
                  link === null ? "Remove the link" : "Link"
                )
              }
            />
          </Row>
        </Section>
      </PopoverContent>
    </Popover>
  );
};
