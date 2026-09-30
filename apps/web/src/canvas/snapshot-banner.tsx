import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { closeSnapshot, restoreSnapshot } from "../lib/snapshot-actions.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";

/**
 * Says the designs on screen are a snapshot's, to look at, with the two ways out: back to the
 * files as they are, or the files put back as the snapshot kept them.
 */
export const SnapshotBanner = () => {
  const view = useSnapshotView((s) => s.view);
  if (!view) {
    return null;
  }
  const { snapshot } = view;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
      <div
        className="pointer-events-auto flex h-9 items-center gap-2 rounded-lg border border-warning/40 bg-sidebar pr-1 pl-2.5 text-[11px] text-sidebar-foreground shadow-black/30 shadow-lg"
        role="status"
      >
        <History className="size-3.5 text-warning" />
        <span className="truncate">
          <span className="font-medium">{snapshot.name}</span>
          <span className="text-muted-foreground">
            {" "}
            · {new Date(snapshot.at).toLocaleString()} · to look at
          </span>
        </span>
        <Button
          onClick={() => restoreSnapshot(snapshot)}
          size="sm"
          variant="outline"
        >
          Restore…
        </Button>
        <Button onClick={closeSnapshot} size="sm">
          Back to now
        </Button>
      </div>
    </div>
  );
};
