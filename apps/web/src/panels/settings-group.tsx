/** A group of the settings and a row of it: the layout every section is written in. */
import { cn } from "cn";
import { CircleAlert, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { Label } from "@/components/ui/label";

/**
 * Rows on one quiet surface a step above the dialog's ground, split by hairlines: the fill is
 * its only edge. The group's name, when the rows do not say it themselves, is a title above it,
 * and a note that holds for every row sits under the title, at a reading measure. Both start
 * where the rows' words do.
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
    {title || note ? (
      <div className="flex flex-col gap-0.5 px-4">
        {title ? <h3 className="font-heading-xsmall">{title}</h3> : null}
        {note ? (
          <p className="max-w-md text-pretty font-small text-muted-foreground">
            {note}
          </p>
        ) : null}
      </div>
    ) : null}
    {/* A raised surface: its fields fill a step above it in dark (Input, Select). */}
    <div className="divide-y rounded-lg bg-card" data-surface="raised">
      {children}
    </div>
  </section>
);

/**
 * A select in a row: its value and a chevron, filled only under the pointer, at the row's right
 * edge (OptionSelect's `className`).
 */
export const rowSelect = [
  "w-fit max-w-full *:data-[slot=select-value]:flex-none",
  "bg-transparent hover:border-transparent hover:bg-accent",
  "dark:in-data-[surface=raised]:bg-transparent dark:in-data-[surface=raised]:hover:bg-accent",
].join(" ");

/** A field in an `end` row: as wide as the column the selects end on. */
export const rowField = "@xl:w-52";

/**
 * How a row's control sits. `end`: a switch, a select or a button at the row's right edge, the
 * words taking the rest. `field`: a field filling the right part of the row, the words a third
 * of it. `below`: what is too long for the right part (a command, a list of actions) under the
 * words, the row's full width.
 */
type Layout = "below" | "end" | "field";

/**
 * What a row says of itself under its words and its control, the row's full width: an error
 * (why the setting failed and how to fix it) on a red tint, or a notice beside a warning icon.
 */
export const RowMessage = ({
  children,
  id,
  kind,
}: {
  children: React.ReactNode;
  id?: string;
  kind: "error" | "notice";
}) =>
  kind === "error" ? (
    <div
      className="flex gap-2 rounded-md bg-destructive/10 px-3 py-2 font-small text-destructive"
      id={id}
      role="alert"
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex min-w-0 flex-col items-start gap-2">{children}</div>
    </div>
  ) : (
    <div className="flex gap-2 font-small text-muted-foreground" id={id}>
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <div className="min-w-0">{children}</div>
    </div>
  );

/**
 * One setting: what it is on the left (its name and at most a muted line), its control on the
 * right, and what it says of itself (`message`, a RowMessage) under both. Below the container's
 * width the control drops under the words instead of squeezing them.
 */
export const Row = ({
  children,
  description,
  htmlFor,
  layout = "end",
  message,
  title,
}: {
  children?: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  layout?: Layout;
  message?: React.ReactNode;
  title: React.ReactNode;
}) => (
  <div className="flex flex-col gap-3 px-4 py-3">
    <RowLine
      description={description}
      htmlFor={htmlFor}
      layout={layout}
      title={title}
    >
      {children}
    </RowLine>
    {message}
  </div>
);

const RowLine = ({
  children,
  description,
  htmlFor,
  layout,
  title,
}: {
  children?: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  layout: Layout;
  title: React.ReactNode;
}) => (
  <div
    className={cn(
      "flex flex-col gap-3",
      layout === "end" && "@xl:flex-row @xl:items-center @xl:gap-6",
      layout === "field" && "@xl:flex-row @xl:items-start @xl:gap-6"
    )}
  >
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5",
        layout === "end" && "flex-1",
        // The title's line sits on the field's: both 20px lines, the field's 4px in.
        layout === "field" && "@xl:w-[36%] @xl:shrink-0 @xl:pt-1"
      )}
    >
      {/* Label sets its line to the text's size; the title keeps its role's 20px line. */}
      <Label className="font-heading-xsmall leading-5" htmlFor={htmlFor}>
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
