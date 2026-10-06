/**
 * How a thread shows its agent at work: a mark that turns while the turn runs, and at the bottom
 * of the chat that it is working and for how long. What it is doing is in the folded work above,
 * for whoever opens it.
 */
import { cn } from "cn";
import { useEffect, useState } from "react";
import { formatDuration } from "../lib/thread-work.ts";

/** Eight rays that light up in turn, the whole mark turning slowly. */
const RAYS = Array.from({ length: 8 }, (_, i) => i * 45);

const WorkingMark = ({ className }: { className?: string }) => (
  <svg
    aria-hidden="true"
    className={cn(
      "size-4 text-brand motion-safe:animate-[spin_8s_linear_infinite]",
      className
    )}
    viewBox="0 0 24 24"
  >
    {RAYS.map((angle, i) => (
      <line
        className="motion-safe:animate-ray"
        key={angle}
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={2.4}
        style={{ animationDelay: `${(i - RAYS.length) * 125}ms` }}
        transform={`rotate(${angle} 12 12)`}
        x1={12}
        x2={12}
        y1={3}
        y2={8}
      />
    ))}
  </svg>
);

const useElapsed = (since: number | undefined) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return since === undefined ? null : formatDuration(now - since);
};

/** The bottom of a running thread: the agent is working, and has been for this long. */
export const WorkingIndicator = ({
  since,
  starting,
}: {
  /** When the prompt that started the turn was sent. */
  since: number | undefined;
  starting: boolean;
}) => {
  const elapsed = useElapsed(since);
  const label = starting ? "Starting the agent" : "Working";
  return (
    <div
      aria-live="polite"
      className="motion-safe:fade-in flex items-center gap-2 py-1 font-body motion-safe:animate-in"
      role="status"
    >
      <WorkingMark />
      <span className="min-w-0 truncate text-shimmer">{label}…</span>
      {elapsed ? (
        <span className="ml-auto shrink-0 font-body text-muted-foreground/70 tabular-nums">
          {elapsed}
        </span>
      ) : null}
    </div>
  );
};
