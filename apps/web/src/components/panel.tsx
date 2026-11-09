import type * as React from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

export const Section = ({
  title,
  children,
  actions,
  className,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("border-b px-3 py-2.5", className)}>
    <div className="mb-2 flex items-center justify-between">
      <span className="font-heading-xsmall">{title}</span>
      {actions}
    </div>
    <div className="flex flex-col gap-1.5">{children}</div>
  </div>
);

export const Row = ({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn("grid grid-cols-[80px_1fr] items-center gap-2", className)}
  >
    <Label className="truncate font-body text-muted-foreground" title={label}>
      {label}
    </Label>
    <div className="flex min-w-0 items-center gap-1">{children}</div>
  </div>
);

export const PanelEmpty = ({
  action,
  icon,
  title,
  children,
}: {
  /** The one thing to do about it, under the sentence. */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  /** What is missing, in a few words over the sentence that says what to do. */
  title?: string;
  children: React.ReactNode;
}) => (
  // A muted icon, a one-line title, one muted sentence, one action (DESIGN.md, Components).
  <Empty className="h-full gap-3 p-4">
    <EmptyHeader className="max-w-60">
      {icon ? (
        <EmptyMedia className="mb-1 text-muted-foreground [&_svg:not([class*='size-'])]:size-5">
          {icon}
        </EmptyMedia>
      ) : null}
      {title ? (
        <EmptyTitle className="font-body-medium">{title}</EmptyTitle>
      ) : null}
      <EmptyDescription className="font-body-small">
        {children}
      </EmptyDescription>
    </EmptyHeader>
    {action}
  </Empty>
);
