import type { HTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Whether an element's text overflows its box: wider than a `truncate`, taller than a clamp. */
const isCut = (el: HTMLElement) =>
  el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;

/**
 * Text that shows its whole self in the system tooltip when it is cut short, and only then:
 * whether it is cut is read as the pointer comes onto it, so a long list mounts no tooltip until
 * one is wanted. The element is a span that is a box of its own (a flex item, a `block`), or it
 * has no width to be cut to. `tip` is what the tooltip says when it is not the text itself.
 */
export const CutText = ({
  onPointerEnter,
  tip,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tip?: ReactNode }) => {
  const [cut, setCut] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            {...props}
            onPointerEnter={(e) => {
              onPointerEnter?.(e);
              setCut(isCut(e.currentTarget));
            }}
          />
        }
      />
      {cut ? <TooltipContent>{tip ?? props.children}</TooltipContent> : null}
    </Tooltip>
  );
};
