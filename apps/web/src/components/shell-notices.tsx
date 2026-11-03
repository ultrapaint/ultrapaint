import { TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
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
    <div className="pointer-events-none absolute inset-x-0 top-14 z-20 flex flex-col items-center gap-2 px-4">
      {notices.map((notice) => (
        <div
          className="floating pointer-events-auto flex w-full max-w-lg items-start gap-2.5 rounded-xl border bg-popover py-2.5 pr-2 pl-3"
          key={notice.id}
          role="alert"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-label">{notice.title}</span>
            <p className="text-pretty font-small text-muted-foreground">
              {notice.detail}
              {notice.command ? (
                <code className="ml-1 select-all rounded-sm bg-muted px-1 py-0.5 font-code text-foreground">
                  {notice.command}
                </code>
              ) : null}
            </p>
            {notice.link ? (
              <a
                className="mt-1 self-start font-small text-foreground underline decoration-foreground/30 underline-offset-3 hover:decoration-foreground"
                href={notice.link.url}
                rel="noreferrer"
                target="_blank"
              >
                {notice.link.label}
              </a>
            ) : null}
          </div>
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
