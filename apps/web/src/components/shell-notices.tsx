import { TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { platform, type ShellNotice } from "../platform.ts";
import { IconButton } from "./icon-button.tsx";

/**
 * What the shell found missing on this machine (Platform), floating at the top of the canvas:
 * Node.js not installed, say, with how to install it, before the preview fails for want of it.
 * Nothing in a browser. A dismissed notice stays away until the editor is loaded again.
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
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-4">
      {notices.map((notice) => (
        <Alert
          className="floating pointer-events-auto max-w-xl pr-8"
          key={notice.id}
        >
          <TriangleAlert className="text-warning" />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>
            {notice.detail}
            {notice.command ? (
              <code className="ml-1 select-text rounded bg-muted px-1 py-0.5 font-code text-foreground">
                {notice.command}
              </code>
            ) : null}
            {notice.link ? (
              <a
                className="ml-1"
                href={notice.link.url}
                rel="noreferrer"
                target="_blank"
              >
                {notice.link.label}
              </a>
            ) : null}
          </AlertDescription>
          <IconButton
            className="absolute top-1 right-1"
            label="Dismiss"
            onClick={() => dismiss(notice.id)}
            size="icon-xs"
          >
            <X />
          </IconButton>
        </Alert>
      ))}
    </div>
  );
};
