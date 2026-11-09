import { Spinner } from "@/components/ui/spinner";
import { useConnection } from "../state/connection.ts";
import { useShellStatus } from "../state/shell-status.ts";
import { Banner } from "./banner.tsx";

/**
 * Connection problems, just over the tools at the bottom of the canvas, out of the way of what the
 * top says. Nothing shows while the server is reachable: the frames are the editor's own
 * (ADR 0040), with nothing to start.
 */
export const CanvasStatus = () => {
  const connState = useConnection((s) => s.state);
  const shell = useShellStatus();

  // The shell knows more than the socket does: why the server is away, and what it is doing.
  const message =
    shell?.message ??
    (connState === "open" ? null : "Connecting to the server…");
  if (message === null) {
    return null;
  }
  return (
    <Banner
      at="bottom"
      icon={<Spinner className="text-muted-foreground" />}
      label={message}
    >
      <span className="truncate pr-1.5 font-body-small" title={shell?.detail}>
        {message}
      </span>
    </Banner>
  );
};
