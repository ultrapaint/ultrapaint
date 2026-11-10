import type * as React from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

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
