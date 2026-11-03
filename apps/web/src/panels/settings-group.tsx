/** A group of the settings and a row of it: the layout every section is written in. */
import { cn } from "cn";
import type * as React from "react";
import { Label } from "@/components/ui/label";

/**
 * Rows on one quiet surface, split by hairlines. The group's name, when the rows do not say it
 * themselves, is a small muted label above; a note that holds for every row sits under it.
 */
export const Group = ({
  children,
  note,
  title,
}: {
  children: React.ReactNode;
  /** What holds for every row of the group, said once under it. */
  note?: React.ReactNode;
  title?: string;
}) => (
  <section className="flex flex-col gap-2">
    {title ? (
      <h3 className="px-1 font-small text-muted-foreground">{title}</h3>
    ) : null}
    <div className="divide-y rounded-lg border bg-card">{children}</div>
    {note ? (
      <p className="text-pretty px-1 font-small text-muted-foreground">
        {note}
      </p>
    ) : null}
  </section>
);

/**
 * How a row's control sits. `end`: a switch, a select or a button at the row's right edge, the
 * words taking the rest. `field`: a field filling the right part of the row, the words a third
 * of it. `below`: what is too long for the right part (a command, a list of actions) under the
 * words, the row's full width.
 */
type Layout = "below" | "end" | "field";

/**
 * One setting: what it is on the left (its name and at most a muted line), its control on the
 * right. Below the container's width the control drops under the words instead of squeezing
 * them.
 */
export const Row = ({
  children,
  description,
  htmlFor,
  layout = "end",
  title,
}: {
  children?: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  layout?: Layout;
  title: React.ReactNode;
}) => (
  <div
    className={cn(
      "flex flex-col gap-3 px-4 py-3",
      layout === "end" && "@xl:flex-row @xl:items-center @xl:gap-6",
      layout === "field" && "@xl:flex-row @xl:items-start @xl:gap-6"
    )}
  >
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5",
        layout === "end" && "flex-1",
        layout === "field" && "@xl:w-[36%] @xl:shrink-0 @xl:pt-1"
      )}
    >
      <Label className="font-heading-xsmall" htmlFor={htmlFor}>
        {title}
      </Label>
      {description ? (
        <div className="text-pretty font-small text-muted-foreground">
          {description}
        </div>
      ) : null}
    </div>
    {children ? (
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1.5",
          layout === "end" && "@xl:shrink-0 @xl:items-end",
          layout === "field" && "flex-1"
        )}
      >
        {children}
      </div>
    ) : null}
  </div>
);
