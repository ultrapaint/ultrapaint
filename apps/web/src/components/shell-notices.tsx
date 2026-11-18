import { TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { platform, type ShellNotice } from "../platform.ts";
import { useProject } from "../state/project.ts";
import { IconButton } from "./icon-button.tsx";

/**
 * What the shell found missing on this machine (Platform), floating at the top of the canvas:
 * Node.js not installed, say, before the preview fails for want of it. One line each, with
 * Details opening the settings' section that says what was found and how to put it right
 * (ADR 0105). Nothing in a browser. A dismissed notice stays away until the editor is loaded
 * again.
 */
export const ShellNotices = () => {
  const [notices, setNotices] = useState<readonly ShellNotice[]>([]);
  useEffect(() => {
    platform()
      .notices?.()
      .then(setNotices)
      // A shell that cannot say has nothing to show.
      .catch(() => setNotices([]));
  }, []);
  if (notices.length === 0) {
    return null;
  }
  const dismiss = (id: string) =>
    setNotices((all) => all.filter((n) => n.id !== id));
  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-20 flex flex-col items-center gap-2 px-4">
      {notices.map((notice) => (
        <div
          className="floating pointer-events-auto flex w-full max-w-lg items-center gap-2.5 rounded-xl border bg-popover py-1.5 pr-1.5 pl-3"
          key={notice.id}
          role="alert"
        >
          <TriangleAlert className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 truncate font-body-medium">
            {notice.title}
          </span>
          <Button
            onClick={() =>
              useProject.getState().openSettings(true, notice.section)
            }
            size="sm"
            variant="outline"
          >
            Details
          </Button>
          <IconButton
            onClick={() => dismiss(notice.id)}
            size="icon-sm"
            tooltip="Dismiss"
          >
            <X />
          </IconButton>
        </div>
      ))}
    </div>
  );
};
