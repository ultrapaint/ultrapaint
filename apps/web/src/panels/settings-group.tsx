/** A group of the settings and a row of it: the layout every section is written in. */
import { cn } from "cn";
import type * as React from "react";
import { Label } from "@/components/ui/label";

/** A titled card of rows; the rows are separated by hairlines. */
export const Group = ({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  title: string;
}) => (
  <section className="flex flex-col gap-2">
    <div className="flex flex-col gap-0.5 px-1">
      <h3 className="font-heading-xsmall">{title}</h3>
      {description ? (
        <p className="font-body text-muted-foreground">{description}</p>
      ) : null}
    </div>
    <div className="divide-y rounded-lg border bg-card">{children}</div>
  </section>
);

/**
 * One setting: what it is on the left, its control on the right. Below the container's width the
 * control drops under the words instead of squeezing them.
 */
export const Row = ({
  children,
  description,
  htmlFor,
  title,
  wide,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  title: string;
  /** Room for a list or a command rather than a single value. */
  wide?: boolean;
}) => (
  <div className="flex @2xl:flex-row flex-col @2xl:items-start @2xl:justify-between @2xl:gap-8 gap-3 px-4 py-3.5">
    <div className="flex min-w-0 flex-1 flex-col gap-1 @2xl:pt-1">
      <Label className="font-body" htmlFor={htmlFor}>
        {title}
      </Label>
      {description ? (
        <p className="font-body text-muted-foreground">{description}</p>
      ) : null}
    </div>
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1",
        wide ? "@2xl:w-96" : "@2xl:w-72"
      )}
    >
      {children}
    </div>
  </div>
);
