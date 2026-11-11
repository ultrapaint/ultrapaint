/**
 * The tag an attachment of a prompt is shown as: in a chat's composer, and for a text file on the
 * start screen's (ADR 0064).
 */
import { FileText, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { sizeLabel } from "../lib/attach-files.ts";
import type { TextChip } from "../lib/file-chips.ts";

/** The chips' look: a raised neutral tag in the composer's well; dashed when only implied. */
export const chipClass =
  "flex h-6 min-w-0 items-center gap-1 rounded-md pr-0.5 pl-1.5 font-body-small [&_svg]:size-3.5 [&_svg]:shrink-0";

/** A chip's ×, muted until the pointer is on it. */
export const ChipRemove = ({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) => (
  <button
    aria-label={`Remove ${name}`}
    className="flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
    onClick={onRemove}
    type="button"
  >
    <X />
  </button>
);

/** A text file sent with the prompt as its text: its name, its size on hover. */
export const TextFileChip = ({
  chip,
  onRemove,
}: {
  chip: TextChip;
  onRemove: () => void;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <span
          className={cn(
            chipClass,
            "bg-background text-foreground [&>svg]:text-muted-foreground"
          )}
        />
      }
    >
      <FileText />
      <span className="max-w-48 truncate">{chip.name}</span>
      <ChipRemove name={chip.name} onRemove={onRemove} />
    </TooltipTrigger>
    <TooltipContent className="max-w-72">
      {chip.name} · {sizeLabel(chip.size)}
    </TooltipContent>
  </Tooltip>
);
