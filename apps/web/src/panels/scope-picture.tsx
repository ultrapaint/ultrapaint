/**
 * The picture of what a thread works on, in its turn's card: the node it was started on, or its
 * page, drawn again a moment after the document changes. A quiet tile while there is none.
 */
import type { Thread } from "@ultrapaint/contracts/threads";
import { MessageSquare } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { useDocuments } from "../state/documents.ts";
import {
  refreshPreviews,
  useThreadPreviews,
} from "../state/thread-previews.ts";

/** Keeps a thread's picture in step with its document, a moment after it settles. */
const usePicture = (thread: Thread) => {
  const docs = useDocuments((s) => s.docs);
  // A document that changed is drawn again: its hash is what the picture is kept by.
  // biome-ignore lint/correctness/useExhaustiveDependencies: docs is what the picture is drawn from.
  useEffect(() => {
    if (!thread.scope) {
      return;
    }
    const timer = setTimeout(() => {
      refreshPreviews([thread]).catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [thread, docs]);
  return useThreadPreviews((s) => s.pictures[thread.id]);
};

export const ScopePicture = ({
  className,
  thread,
}: {
  className?: string;
  thread: Thread;
}) => {
  const picture = usePicture(thread);
  const several = (thread.scope?.count ?? 0) > 1;
  return (
    <span
      className={cn(
        "relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md",
        // A design is drawn on white, as on the canvas; the hairline holds its edge on any theme.
        picture
          ? "bg-white outline outline-black/10 -outline-offset-1 dark:outline-white/10"
          : "bg-muted text-muted-foreground",
        className
      )}
    >
      {picture ? (
        <img
          alt=""
          className="size-full object-cover"
          draggable={false}
          height={44}
          src={picture}
          width={44}
        />
      ) : (
        <MessageSquare className="size-4" />
      )}
      {several ? (
        <span className="absolute right-0.5 bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-sm bg-foreground/85 px-1 font-body-small-medium text-background tabular-nums">
          {thread.scope?.count}
        </span>
      ) : null}
    </span>
  );
};
