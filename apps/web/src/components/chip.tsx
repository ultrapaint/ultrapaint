/**
 * The tag an attachment of a prompt is shown as: in a chat's composer, and for a text file on the
 * start screen's (ADR 0064).
 */
import { FileText, X } from "lucide-react";
import type { ReactNode } from "react";
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
  "flex h-6 min-w-0 items-center gap-1 rounded-md pl-1.5 font-body-small [&_svg]:size-3.5 [&_svg]:shrink-0";

/** A chip's ×, muted until the pointer is on it, a target as tall as the chip. */
export const ChipRemove = ({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <button
          aria-label={`Remove ${name}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
          onClick={onRemove}
          type="button"
        />
      }
    >
      <X />
    </TooltipTrigger>
    <TooltipContent>Remove</TooltipContent>
  </Tooltip>
);

/**
 * An attachment as a chip: its icon and name, which say in a tooltip what it is in full (`tip`),
 * then its × with a tooltip of its own, so the pointer on the × names only the removal. Raised in
 * the composer's well, or dashed when it is only implied (the selection).
 */
export const ChipTag = ({
  icon,
  implicit = false,
  name,
  onRemove,
  tip,
}: {
  icon: ReactNode;
  implicit?: boolean;
  name: string;
  onRemove: () => void;
  tip: ReactNode;
}) => (
  <span
    className={cn(
      chipClass,
      implicit
        ? "border border-foreground/15 border-dashed text-muted-foreground"
        : "bg-background text-foreground"
    )}
  >
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "flex min-w-0 items-center gap-1",
              !implicit && "[&>svg]:text-muted-foreground"
            )}
          />
        }
      >
        {icon}
        <span className="max-w-48 truncate">{name}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{tip}</TooltipContent>
    </Tooltip>
    <ChipRemove name={name} onRemove={onRemove} />
  </span>
);

/** A text file sent with the prompt as its text: its name, its size on hover. */
export const TextFileChip = ({
  chip,
  onRemove,
}: {
  chip: TextChip;
  onRemove: () => void;
}) => (
  <ChipTag
    icon={<FileText />}
    name={chip.name}
    onRemove={onRemove}
    tip={`${chip.name} · ${sizeLabel(chip.size)}`}
  />
);
