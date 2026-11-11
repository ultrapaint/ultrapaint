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
import type { ImageChip } from "../lib/file-chips.ts";

/** A picture sent with the next prompt, as itself, with its × over its corner. */
export const ImageThumb = ({
  chip,
  onRemove,
}: {
  chip: ImageChip;
  onRemove: () => void;
}) => (
  <span className="relative size-14 shrink-0">
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
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={`Remove ${chip.name}`}
            className="group/remove absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full outline-none"
            onClick={onRemove}
            type="button"
          />
        }
      >
        {/* A 20px disc in a 24px target, so the corner stays light and the × easy to hit. */}
        <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background group-focus-visible/remove:ring-2 group-focus-visible/remove:ring-ring [&_svg]:size-3">
          <X />
        </span>
      </TooltipTrigger>
      <TooltipContent>Remove</TooltipContent>
    </Tooltip>
  </span>
);
