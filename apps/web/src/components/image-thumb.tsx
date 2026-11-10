/**
 * A picture attached to a prompt, shown as itself: in the chat's composer and the look page's
 * agent box (ADR 0064).
 */
import { X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ImageChip } from "../state/attachments.ts";

/** A picture sent with the next prompt, as itself; its × shows over its corner on hover. */
export const ImageThumb = ({
  chip,
  onRemove,
}: {
  chip: ImageChip;
  onRemove: () => void;
}) => (
  <span className="group/thumb relative size-14 shrink-0">
    <Tooltip>
      <TooltipTrigger
        render={
          <img
            alt={chip.name}
            className="size-full rounded-md object-cover outline outline-black/10 -outline-offset-1 dark:outline-white/10"
            height={56}
            src={chip.dataUrl}
            width={56}
          />
        }
      />
      <TooltipContent>{chip.name}</TooltipContent>
    </Tooltip>
    <button
      aria-label={`Remove ${chip.name}`}
      className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 outline-none transition-opacity duration-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/thumb:opacity-100 [&_svg]:size-3"
      onClick={onRemove}
      type="button"
    >
      <X />
    </button>
  </span>
);
