import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, useConnection } from "../state/connection.ts";
import { reportError, useProject } from "../state/project.ts";

const startPreview = () =>
  api().request("host.start", undefined).catch(reportError);

const Notice = ({ children }: { children: ReactNode }) => (
  <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center">
    <div className="pointer-events-auto flex h-8 items-center gap-2 rounded-lg border bg-sidebar pr-1 pl-2.5 text-sidebar-foreground shadow-black/30 shadow-lg [&>svg]:size-3.5">
      {children}
    </div>
  </div>
);

/**
 * Connection problems at the top of the canvas. Nothing shows while the backend is reachable and
 * the preview runs.
 */
export const CanvasStatus = () => {
  const connState = useConnection((s) => s.state);
  const configured = useProject((s) => s.info.configured);
  const host = useProject((s) => s.info.host);

  if (connState !== "open") {
    return (
      <Notice>
        <Spinner />
        <span className="pr-1.5">Connecting to the local backend…</span>
      </Notice>
    );
  }
  if (!configured || host.state === "running") {
    return null;
  }
  if (host.state === "starting") {
    return (
      <Notice>
        <Spinner />
        <span className="pr-1.5">Starting the preview…</span>
      </Notice>
    );
  }
  return (
    <Notice>
      {host.state === "error" ? (
        <CircleAlert className="text-destructive" />
      ) : null}
      <span title={host.error}>
        {host.state === "error"
          ? "The preview failed"
          : "The preview is stopped"}
      </span>
      <Button onClick={startPreview} size="sm" variant="outline">
        {host.state === "error" ? "Retry" : "Start preview"}
      </Button>
    </Notice>
  );
};
