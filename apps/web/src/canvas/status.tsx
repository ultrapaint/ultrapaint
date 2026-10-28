import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useConnection } from "../state/connection.ts";
import { useShellStatus } from "../state/shell-status.ts";

const Notice = ({ children }: { children: ReactNode }) => (
  <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center">
    <div className="pointer-events-auto flex h-8 items-center gap-2 rounded-lg border bg-sidebar pr-1 pl-2.5 text-sidebar-foreground shadow-black/30 shadow-lg [&>svg]:size-3.5">
      {children}
    </div>
  </div>
);

/**
 * Connection problems at the top of the canvas. Nothing shows while the backend is reachable: the
 * frames are the editor's own (ADR 0040), with nothing to start.
 */
export const CanvasStatus = () => {
  const connState = useConnection((s) => s.state);
  const shell = useShellStatus();

  // The shell knows more than the socket does: why the backend is away, and what it is doing.
  if (shell) {
    return (
      <Notice>
        <Spinner />
        <span className="pr-1.5" title={shell.detail}>
          {shell.message}
        </span>
      </Notice>
    );
  }
  if (connState !== "open") {
    return (
      <Notice>
        <Spinner />
        <span className="pr-1.5">Connecting to the local backend…</span>
      </Notice>
    );
  }
  return null;
};
