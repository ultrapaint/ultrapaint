/**
 * What a frame shows instead of its page when that page stopped the editor the last time it ran
 * (docs/PLAN-preview-sandbox.md, step 4): the editor is not stopped again on its own.
 */
import { Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { drawAnyway, useFrozen } from "./watchdog.ts";

export const FrozenPage = ({ frame }: { frame: string }) => {
  // Where it was stuck, when the desktop app could tell (step 17).
  const at = useFrozen((s) => s.frames.get(frame));
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted p-6 text-center font-body text-muted-foreground">
      <Snowflake className="size-6" />
      <p className="max-w-80">
        This page stopped the editor the last time it ran: its code may loop
        forever. It is not drawn until you ask.
      </p>
      {at ? (
        <p className="max-w-80 break-all font-mono">Stuck at {at}</p>
      ) : null}
      <Button onClick={() => drawAnyway(frame)} size="sm" variant="outline">
        Draw anyway
      </Button>
    </div>
  );
};
