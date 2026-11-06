/**
 * A drop target for files from the desktop (ADR 0064): the chat's composer and the look page's
 * agent box. While files are over it, it rings as a field with focus does and says what a drop
 * does; a layer, a component or text dragged over it is left to its own handlers.
 */

import { cn } from "cn";
import { Paperclip } from "lucide-react";
import { type ComponentProps, type DragEvent, type Ref, useState } from "react";
import { dragsFiles } from "../lib/attach-files.ts";

/** The ring a drop target takes while files are over it, as a field's on focus. */
export const droppingClass =
  "border-ring ring-2 ring-ring/25 hover:border-ring";

/** Whether files are over the target, and the props that take them when dropped. */
const useFileDrop = (onFiles: (files: File[]) => void) => {
  const [dropping, setDropping] = useState(false);
  const onDragOver = (e: DragEvent) => {
    if (!dragsFiles(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  return {
    dropProps: {
      onDragEnter: onDragOver,
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDropping(false);
        }
      },
      onDragOver,
      onDrop: (e: DragEvent) => {
        if (!dragsFiles(e.dataTransfer)) {
          return;
        }
        e.preventDefault();
        setDropping(false);
        onFiles([...e.dataTransfer.files]);
      },
    },
    dropping,
  };
};

/** What the target says while files are over it, over what it holds. */
const DropHint = ({ label }: { label: string }) => (
  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1.5 rounded-[inherit] bg-muted font-small text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground">
    <Paperclip />
    {label}
  </div>
);

/** The system's file picker, opened through `ref`: several files at once, handed on as picked. */
export const FilesInput = ({
  accept,
  onFiles,
  ref,
}: {
  accept?: string;
  onFiles: (files: File[]) => void;
  ref: Ref<HTMLInputElement>;
}) => (
  <input
    accept={accept}
    className="hidden"
    multiple
    onChange={(e) => {
      const picked = [...(e.target.files ?? [])];
      // Cleared, so the same file can be picked again.
      e.target.value = "";
      if (picked.length > 0) {
        onFiles(picked);
      }
    }}
    ref={ref}
    type="file"
  />
);

/**
 * A box that takes files dropped on it, `hint` saying what a drop does while they are over it;
 * the rest of a div's props go to the box.
 */
export const FileDropBox = ({
  children,
  className,
  hint,
  onFiles,
  ...props
}: ComponentProps<"div"> & {
  hint: string;
  onFiles: (files: File[]) => void;
}) => {
  const { dropping, dropProps } = useFileDrop(onFiles);
  return (
    <div
      className={cn(className, "relative", dropping && droppingClass)}
      {...props}
      {...dropProps}
    >
      {dropping ? <DropHint label={hint} /> : null}
      {children}
    </div>
  );
};
