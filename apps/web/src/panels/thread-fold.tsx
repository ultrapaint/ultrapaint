/**
 * A row of a turn's card that opens what is under it (ADR 0095): its line, then a chevron at the
 * right that turns. The review, the steps and the questions asked fold in it.
 */
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export const Fold = ({
  children,
  label,
  lead,
  trail,
}: {
  children: ReactNode;
  label: ReactNode;
  lead?: ReactNode;
  trail?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className="group/fold flex h-9 w-full min-w-0 items-center gap-2 px-3 text-left outline-none transition-colors duration-100 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:size-3.5 [&_svg]:shrink-0">
        {lead}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trail}
        <ChevronRight className="text-muted-foreground transition-transform duration-150 group-data-panel-open/fold:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
};
