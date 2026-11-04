import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { closeSnapshot, restoreSnapshot } from "../lib/snapshot-actions.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";
import { Banner } from "./banner.tsx";

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

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
    <Banner
      icon={<History className="text-warning" />}
      label={`Snapshot ${snapshot.name}, read only`}
    >
      <span className="min-w-0 truncate font-label" title={snapshot.name}>
        {snapshot.name}
      </span>
      <span className="shrink-0 font-small text-muted-foreground">
        {when.format(snapshot.at)} · Read only
      </span>
      <span className="flex shrink-0 items-center gap-1 pl-1">
        <Button
          onClick={() => restoreSnapshot(snapshot)}
          size="sm"
          variant="ghost"
        >
          Restore
        </Button>
        <Button onClick={closeSnapshot} size="sm">
          Back to now
        </Button>
      </span>
    </Banner>
  );
};
