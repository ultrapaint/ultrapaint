import type * as React from "react";
import { Fragment } from "react";
import { cn } from "@/lib/cn";

/**
 * A file of the designs that does not read, said in full where what it holds would be drawn, on
 * the red tint: what it is not (`title`), each thing wrong with it at its place in the file
 * (`parts`), its values in code as the file writes them, and where to fix it (`children`). It has
 * no action: the server reads the file again when it is saved, and what it holds takes this place.
 */
export const FileProblem = ({
  children,
  className,
  parts,
  title,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  /** What is wrong, each with its place in the file when it is known (`problemParts`). */
  parts: readonly {
    readonly at: string | null;
    readonly says: readonly { readonly code: boolean; readonly text: string }[];
  }[];
  title: string;
}) => (
  <div
    className={cn(
      "wrap-anywhere rounded-md bg-destructive/10 p-2 font-body",
      className
    )}
    {...props}
  >
    <p className="text-destructive">{title}</p>
    {parts.map((part, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one message, in its order.
      <p key={i}>
        {part.at === null ? null : (
          <>
            <code className="font-code">{part.at}</code>{" "}
          </>
        )}
        {part.says.map((said, j) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one sentence, in its order.
          <Fragment key={j}>
            {said.code ? (
              <code className="font-code">{said.text}</code>
            ) : (
              said.text
            )}
          </Fragment>
        ))}
      </p>
    ))}
    <p className="text-muted-foreground">{children}</p>
  </div>
);
