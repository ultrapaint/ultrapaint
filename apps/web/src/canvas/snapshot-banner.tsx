import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CutText } from "../components/cut-text.tsx";
import { closePoint, restorePoint } from "../lib/history-actions.ts";
import { pointTitle } from "../lib/history-words.ts";
import { useSnapshotView } from "../state/snapshot-view.ts";
import { Banner } from "./banner.tsx";

const when = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Says the designs on screen are a point's of the history, to look at, with the two ways out:
 * back to the files as they are, or the files put back as the point kept them.
 */
export const SnapshotBanner = () => {
  const view = useSnapshotView((s) => s.view);
  if (!view) {
    return null;
  }
  const { point } = view;
  const title = pointTitle(point);
  return (
    <Banner
      icon={<History className="text-warning" />}
      label={`${title}, read only`}
    >
      <CutText className="min-w-0 truncate font-body-medium">{title}</CutText>
      <span className="shrink-0 font-body-small text-muted-foreground">
        {when.format(point.at)} · Read only
      </span>
      <span className="flex shrink-0 items-center gap-1 pl-1">
        <Button onClick={() => restorePoint(point)} size="sm" variant="ghost">
          Restore
        </Button>
        <Button onClick={closePoint} size="sm">
          Back to now
        </Button>
      </span>
    </Banner>
  );
};
